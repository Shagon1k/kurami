import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { briefingPaths, initializeBriefingStore, openBriefingDatabase } from "../../src/briefing/store.ts";
import { digestPreparation } from "../../src/briefing/preparation.ts";
import { withDigestLanguage } from "../../src/briefing/i18n.ts";
import { injectDigestPreparation, renderDigestPreparation } from "../../src/briefing/ui/components/preparation.ts";
import { createBriefingServer } from "../../src/briefing/server.ts";
import { localDate } from "../../src/briefing/weekly/model.ts";

const home = await mkdtemp(join(tmpdir(), "kurami-preparation-"));
const paths = briefingPaths({ KURAMI_HOME: home, BRIEFING_MIGRATIONS_DIR: resolve(import.meta.dirname, "../../migrations/briefing") });
await initializeBriefingStore(paths);
const db = openBriefingDatabase(paths);
const now = new Date("2026-10-13T06:19:00Z"), zone = "Europe/Vilnius", date = "2026-10-13";
const insert = db.prepare(`INSERT INTO briefing_run_attempts(attempt_id,edition_id,mode,state,run_directory,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`);
function attempt(date: string, mode: string, suffix: string, stamp: string) {
  const id = `daily-${date}--${mode}-${suffix}`;
  insert.run(id, `daily:${date}`, mode, "editorialized", join(home,id), stamp, stamp);
  return id;
}
let server: Awaited<ReturnType<typeof createBriefingServer>> | undefined;
try {
  assert.equal(digestPreparation(db,"ru",zone,now),null);
  attempt("2026-10-12","scheduled","oldrun","2026-10-12T06:00:00Z");
  assert.equal(digestPreparation(db,"ru",zone,now),null,"yesterday's unfinished run is not today's preparation");
  const id = attempt(date,"scheduled","actual","2026-10-13T06:00:00Z");
  attempt(date,"dry-run","dryrun","2026-10-13T06:30:00Z");
  const progress = digestPreparation(db,"ru",zone,now)!;
  assert.equal(progress.step,5);assert.equal(progress.activity,"Рисую картинки…");
  assert.equal(digestPreparation(db,"en",zone,now)!.activity,"Drawing pictures…");
  assert.equal(digestPreparation(db,"ru",zone,new Date("2026-10-13T21:30:00Z")),null,"the edition day follows the configured time zone");
  const ru = withDigestLanguage("ru",()=>renderDigestPreparation(progress));
  assert.match(ru,/13 октября/);assert.match(ru,/Обновлено <time[^>]*>09:00/);assert.match(ru,/5\/10/);
  assert.match(ru,/data-ui-surface="panel"/);assert.match(ru,/data-ui-live/);
  const en = withDigestLanguage("en",()=>renderDigestPreparation(digestPreparation(db,"en",zone,now)!));
  assert.match(en,/13 October/);assert.match(en,/Drawing pictures…/);assert.match(en,/Updated/);assert.doesNotMatch(en,/Рисую/);
  assert.match(injectDigestPreparation('<head></head><main class="page">story</main>',progress),/<main class="page"><div data-digest-preparation/);
  db.prepare("UPDATE briefing_run_attempts SET state='failed' WHERE attempt_id=?").run(id);
  assert.equal(digestPreparation(db,"ru",zone,now),null,"a failed build is not advertised as preparing");
  const recovery = attempt(date,"recovery","resume","2026-10-13T07:00:00Z");
  assert.equal(digestPreparation(db,"ru",zone,now)!.status,"preparing");
  db.prepare("UPDATE briefing_run_attempts SET state='published' WHERE attempt_id=?").run(recovery);
  assert.equal(digestPreparation(db,"ru",zone,now),null,"do not offer a link before the edition is actually published");
  db.prepare(`INSERT INTO editions(id,edition_type,local_date,timezone,state,payload_json,html_path,content_digest,prepared_at,published_at,retention_until,updated_at)
    VALUES(?,'daily',?,?,'partial','{}','unused','fixture',?,?,?,?)`).run(`daily:${date}`,date,zone,now.toISOString(),now.toISOString(),"2099-01-01T00:00:00Z",now.toISOString());
  const ready = digestPreparation(db,"en",zone,now)!;
  assert.equal(ready.status,"ready");
  assert.match(withDigestLanguage("en",()=>renderDigestPreparation(ready)),/href="\/en\/daily\/2026-10-13"/);
  assert.doesNotMatch(injectDigestPreparation('<head></head><main>story</main>',ready),/Open new edition/);
  db.prepare("UPDATE briefing_run_attempts SET state='skipped' WHERE attempt_id=?").run(recovery);
  assert.equal(digestPreparation(db,"ru",zone,now),null);
  // The API uses the same production state, not a separately maintained progress counter.
  db.prepare("DELETE FROM briefing_run_attempts").run();
  db.prepare("DELETE FROM editions").run();
  const today = localDate(new Date().toISOString(),zone);
  const active = attempt(today,"manual","apirow",new Date().toISOString());
  server = await createBriefingServer(paths,{mailActionExecutor:null});
  server.listen(0,"127.0.0.1");await once(server,"listening");
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const result = await fetch(base+"/api/preparation?lang=en");
  assert.match(result.headers.get("cache-control")!,/no-store/);
  const body = await result.json() as {status:string;html:string};
  assert.equal(body.status,"preparing");assert.match(body.html,/Drawing pictures…/);
  assert.match(await (await fetch(base+"/ru/")).text(),/Рисую картинки…/);
  db.prepare("UPDATE briefing_run_attempts SET state='media-ready' WHERE attempt_id=?").run(active);
  assert.match((await (await fetch(base+"/api/preparation?lang=ru")).json() as {html:string}).html,/7\/10/);
  db.prepare("UPDATE briefing_run_attempts SET state='failed' WHERE attempt_id=?").run(active);
  assert.deepEqual(await (await fetch(base+"/api/preparation?lang=en")).json(),{editionId:null,status:null,html:""});
} finally {
  if(server){server.close();server.closeAllConnections();await once(server,"close");}
  db.close();await rm(home,{recursive:true,force:true});
}
console.log("Digest preparation: production states, local date, EN/RU, ready link and live API verified");
