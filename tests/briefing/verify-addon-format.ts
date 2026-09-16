import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseBriefingPayload } from "../../src/briefing/model.ts";
import { section, setSection, newsBatches } from "../../src/briefing/addons/envelopes.ts";
import { upgradeLegacyPayload } from "../../src/briefing/migrations/addon-format.ts";
import { migrateStoredAddonFormat } from "../../src/briefing/migrations/migrate-addon-format.ts";
import { briefingPaths, initializeBriefingStore, openBriefingDatabase } from "../../src/briefing/store.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";

const home = await mkdtemp(resolve(tmpdir(), "kurami-addon-format-"));
const paths = briefingPaths({ KURAMI_HOME: home, BRIEFING_MIGRATIONS_DIR: resolve(import.meta.dirname, "../../migrations/briefing") });
await initializeBriefingStore(paths);
const raw = {
 schemaVersion: 1,
 edition: { id: "daily:2026-09-16", type: "daily", localDate: "2026-09-16", timezone: "Europe/Vilnius", generatedAt: "2026-09-16T06:00:00Z", status: "complete", retentionUntil: "2026-09-21T06:00:00Z" },
 hero: { title: "Обзор" }, mail: { state: "empty", items: [] }, calendar: { state: "empty", events: [] },
 weather: { state: "ready", temperatureC: 18 },
 news: { state: "ready", items: [{ id: "story-1", fingerprint: "fp-1", headline: "Сохранённый сюжет", summary: "Содержимое утреннего сюжета.", details: ["Подробности."], topics: [{id:"science",label:"Science"},{id:"space",label:"Space"}],
   media: [{id:"image-1",kind:"image",src:"/media/daily/2026-09-16/story-1/01.jpg",mimeType:"image/jpeg",alt:"Снимок"}] }] },
 dataQuality: { state: "ready" },
};
assert.throws(() => parseBriefingPayload(raw), /formatVersion must equal 3/);
const canonical = upgradeLegacyPayload(raw);
for (const key of ["mail","calendar","weather","news","sourceBatches"]) assert(!Object.hasOwn(canonical,key));
assert.throws(() => parseBriefingPayload({...canonical,news:raw.news}), /root.news is forbidden/);
assert.throws(() => parseBriefingPayload({...canonical,formatVersion:4}), /formatVersion must equal 3/);
assert.throws(() => parseBriefingPayload({...canonical,addons:undefined}), /addons is required/);
const malformed = structuredClone(canonical);
malformed.addons.news.data.section = null;
assert.throws(() => parseBriefingPayload(malformed), /data.section must be an object/);
assert.deepEqual(section(canonical,"news").items[0]!.media, raw.news.items[0]!.media);
assert.deepEqual(upgradeLegacyPayload(canonical),canonical);
setSection(canonical,"weather",{state:"ready",temperatureC:20});
assert.equal(section(canonical,"weather").temperatureC,20);
assert.equal((JSON.stringify(canonical).match(/"temperatureC"/g) ?? []).length,1);
const absent = parseBriefingPayload({...canonical,addons:{}});
assert.equal(section(absent,"news").items.length,0);
assert.deepEqual(newsBatches(absent),[]);
assert.deepEqual(absent.addons,{});

const db = openBriefingDatabase(paths);
const html = renderBriefingPage(upgradeLegacyPayload(raw));
await mkdir(paths.previewDirectory,{recursive:true});
const htmlPath = resolve(paths.previewDirectory,"daily-2026-09-16.html");
await writeFile(htmlPath,html);
const insert=db.prepare(`INSERT INTO editions(id,edition_type,local_date,timezone,state,payload_json,html_path,content_digest,preview_enabled,is_current,prepared_at,published_at,retention_until,updated_at)
VALUES(?, 'daily', ?, 'Europe/Vilnius','complete',?,'pages/preview/daily-2026-09-16.html','old-digest',1,0,'2026-09-16T06:00:00Z','2026-09-16T06:00:00Z','2026-09-21T06:00:00Z','2026-09-16T06:00:00Z')`);
insert.run(raw.edition.id,raw.edition.localDate,JSON.stringify(raw));
const other={...raw,edition:{...raw.edition,id:"daily:2026-09-17",localDate:"2026-09-17"}};
insert.run(other.edition.id,other.edition.localDate,JSON.stringify(other));
db.prepare(`INSERT INTO edition_items(edition_id,item_id,item_type,story_fingerprint,topic_ids_json,read_at,reaction,updated_at)
VALUES(?,'story-1','story','fp-1','["science","space"]','2026-09-16T08:00:00Z','like','2026-09-16T08:00:00Z')`).run(raw.edition.id);
const beforeItems=JSON.stringify(db.prepare("SELECT * FROM edition_items").all());
const beforeRows=JSON.stringify(db.prepare("SELECT * FROM editions ORDER BY id").all());
try {
 const dry=await migrateStoredAddonFormat(paths);
 assert.equal(dry.converted,2);
 assert.equal(dry.applied,false);
 assert.equal(JSON.stringify(db.prepare("SELECT * FROM editions ORDER BY id").all()),beforeRows);
 db.exec(`CREATE TRIGGER fail_second_format_update BEFORE UPDATE ON editions WHEN OLD.id='daily:2026-09-17' BEGIN SELECT RAISE(ABORT,'synthetic migration failure'); END`);
 await assert.rejects(migrateStoredAddonFormat(paths,true),/synthetic migration failure/);
 assert.equal(JSON.stringify(db.prepare("SELECT * FROM editions ORDER BY id").all()),beforeRows,"failure must roll back every edition");
 db.exec("DROP TRIGGER fail_second_format_update");
 const applied=await migrateStoredAddonFormat(paths,true);
 assert.equal(applied.applied,true);
 assert("backupPath" in applied);
 assert.equal((await stat(applied.backupPath!)).mode & 0o777,0o600);
 assert.equal(JSON.stringify(db.prepare("SELECT * FROM edition_items").all()),beforeItems);
 assert.equal(await readFile(htmlPath,"utf8"),html);
 for (const row of db.prepare("SELECT payload_json,content_digest FROM editions").all() as Array<{payload_json:string;content_digest:string}>) {
   const migrated=parseBriefingPayload(JSON.parse(row.payload_json));
   assert(!Object.hasOwn(migrated,"news"));
   assert.equal(section(migrated,"news").items[0]!.media?.[0]?.src,raw.news.items[0]!.media[0]!.src);
   assert.notEqual(row.content_digest,"old-digest");
 }
 assert.equal((await migrateStoredAddonFormat(paths,true)).converted,0);
} finally {db.close();}
process.stdout.write("canonical add-on format, strict reader and transactional migration verified\n");
