import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import type { IncomingMessage } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { collectProjectsSnapshot } from "../../src/projects-site/snapshot.ts";
import { ProjectsAccess } from "../../src/projects-site/access.ts";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import {PROJECTS_CLIENT_VERSION,PROJECTS_CLIENT_JS} from "../../src/projects-site/client-version.ts";
import { renderProjectsPage, renderProjectPrControl } from "../../src/projects-site/render.ts";
import { parseFilters, selectItems, projectStageLabel } from "../../src/projects-site/model.ts";
import { syntheticProjectsSnapshot, syntheticCiChecks } from "./fixture.ts";
import {parseCiChecks,ciCheckUrl} from "../../src/projects-site/ci-checks.ts";
import {iconPath,renderIcon as renderIconMarkup} from "../../src/ui-library/components/icon.ts";
import {PROJECTS_STYLES} from "../../src/projects-site/styles.ts";
import {projectColorClass} from "../../src/ui-library/components/project-color.ts";
import type {PrActionView} from "../../src/projects-site/pr-actions.ts";
import {RUN_ACTIONS} from "../../src/projects-site/run-actions.ts";

const home = mkdtempSync(join(tmpdir(), "kurami-projects-"));
const at = "2026-09-30T10:00:00Z";
const checkUrl="https://github.com/Example/Alpha/actions/runs/123/job/456#step:2:1";
for(const lang of ["en","ru"] as const){
  for(const view of [undefined,{action:null,enabled:false,reason:"A status change is still synchronizing.",head:"",fingerprint:"",methods:[],number:null,base:""}] as (PrActionView|undefined)[]){
    const html=renderProjectPrControl(view,lang);
    assert.match(html,/<button[^>]*disabled/,'PR loading and blocked states keep a disabled button');
    assert.match(html,/class="projects-run-action-meta"/,'PR explanations use the shared metadata row');
    assert.doesNotMatch(html,/data-pr-action=/,'an unavailable placeholder cannot start a write');
  }
}
assert.equal(ciCheckUrl(checkUrl,"Example/Alpha"),checkUrl,"the recorded job and step anchor are preserved");
for(const url of ["javascript:alert(1)","https://evil.test/Example/Alpha/actions/runs/123","https://github.com/Example/Other/actions/runs/123","https://user:secret@github.com/Example/Alpha/actions/runs/123","https://github.com/Example/Alpha/issues/12","https://github.com/Example/Alpha/../Other/actions/runs/123"])
  assert.equal(ciCheckUrl(url,"Example/Alpha"),null);
for(const raw of [null,"{bad","{}",'[null,1,{"name":""}]'])assert.deepEqual(parseCiChecks(raw,"Example/Alpha"),[]);
assert.deepEqual(parseCiChecks('[{"name":"CI","state":"invented","detailsUrl":"javascript:alert(1)"}]',"Example/Alpha"),[{name:"CI",state:"unknown",detailsUrl:null}]);
try {
  mkdirSync(join(home, "config")); mkdirSync(join(home, "state"));
  const config = { projects: { alpha: { owner: "Example", project_number: 1, repository: "Example/Alpha", statuses: { backlog: "Todo", active: "Doing", review: "Review", done: "Closed", deferred: "Later" }, discord: { guild_id: "100", channel_id: "101" } } } };
  writeFileSync(join(home, "config/projects.yaml"), JSON.stringify(config));
  const dbPath = join(home, "state/orchestrator.db");
  const missing = collectProjectsSnapshot({ home, now: new Date(at) });
  assert.equal(missing.available, false); assert.equal(missing.projects.length, 1); assert.equal(existsSync(dbPath), false, "read-only snapshot never initializes a missing store");
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys=ON");
  const migrations = resolve(import.meta.dirname, "../../migrations");
  for (const migration of readdirSync(migrations).filter(name => /^\d+_.*\.sql$/.test(name)).sort()) database.exec(readFileSync(join(migrations, migration), "utf8"));
  function item(id: string, status: string, present = 1, project = "alpha", kind = "Issue") {
    database.prepare("INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(project, id, kind, "Example/Alpha", kind === "DraftIssue" ? null : 12, `Task ${id}`, "https://github.com/Example/Alpha/issues/12", status, present, at, at);
  }
  item("review", "Review"); item("backlog", "Todo"); item("absent", "Doing", 0); item("private", "Doing", 1, "other"); item("draft", "Todo", 1, "alpha", "DraftIssue");
  function run(id: string, state: string) {
    database.prepare("INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,payload_json) VALUES(?,?,?,?,?,?,?)").run(`e_${id}`, at, "alpha", "review", "issue12", "Issue", "{}");
    database.prepare("INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state) VALUES(?,?,?,?,?,?,?,?,?)").run(id, `e_${id}`, "alpha", "review", "issue12", "Example/Alpha", 12, "autonomous", state);
  }
  run("r_old", "cancelled"); run("r_current", "parked_review");
  database.prepare("INSERT INTO run_progress_cards(run_id,stage,detail,content_digest) VALUES(?,?,?,?)").run("r_current", "review_ready", "Ready for owner", "digest");
  database.prepare("INSERT INTO run_ci_snapshots(run_id,repository,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run("r_current", "Example/Alpha", "https://github.com/Example/Alpha/pull/20", "current-head", "passed", "[]", "digest", at, at, at);
  database.prepare("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES(?,?,?,?,?,?)").run("q_review", "r_current", "ai_review", "discord", "review1", "applied");
  database.prepare("INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_state,repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,tmux_session_name,important_count,github_review_url) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("ar_1", "r_current", "q_review", 1, "ready", "Example/Alpha", 20, "https://github.com/Example/Alpha/pull/20", "main", "base-head", "old-head", "test-review", 2, "https://github.com/Example/Alpha/pull/20#pullrequestreview-1");
  database.prepare("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES(?,?,?,?,?)").run("alpha", at, at, 3, "succeeded");
  database.prepare("INSERT INTO run_discord_surfaces(run_id,guild_id,parent_channel_id,thread_id) VALUES(?,?,?,?)").run("r_current", "100", "101", "200");
  database.prepare("INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name,expires_at,verified_head_sha) VALUES(?,?,?,?,?,?,?)")
    .run("pl_1", "r_current", 1, "running", "fixture-preview", "2026-10-01T10:00:00Z", "current-head");
  const factualHash="a".repeat(64);
  database.prepare("INSERT INTO project_triage_state(project,factual_hash,facts_json,stats_json,change_sequence,first_observed_at,last_changed_at,last_checked_at) VALUES(?,?,?, ?,1,?,?,?)").run("alpha",factualHash,"{}","{}",at,at,at);
  database.prepare("INSERT INTO project_triage_rankings(project,factual_hash,policy_version,ranking_json,selected_item_id,selected_issue_number,selected_title,selected_url,explanation,content_digest,suggested_since,ranked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("alpha",factualHash,"deterministic-v2","[]","backlog",12,"Task backlog","https://github.com/Example/Alpha/issues/12","Owner priority P1",factualHash,at,at);
  const before = createHash("sha256").update(readFileSync(dbPath)).digest("hex");
  const snapshot = collectProjectsSnapshot({ home, now: new Date(at) });
  assert.equal(snapshot.available, true, "real deployed migration schema can be read");
  assert.equal(snapshot.items.find(item=>item.id==="backlog")?.suggestedNext?.explanation,"Owner priority P1","same persisted recommendation as Discord digest");
  assert.equal(snapshot.items.length, 3, "absent and unconfigured items are excluded; drafts and unstarted issues remain visible");
  const current = snapshot.items.find(item => item.id === "review")!;
  assert.equal(current.runId, "r_current", "only the latest attempt is joined");
  assert.equal(current.review.state, "outdated"); assert.equal(current.review.important, 2);
  assert.equal(current.attention.length, 0, "findings on an old commit never raise current repair alerts");
  assert.equal(current.links.discord, "https://discord.com/channels/100/200");
  assert.equal(current.links.preview, "https://preview-1.shagon1k.win/");
  assert.equal(current.links.review, "https://github.com/Example/Alpha/pull/20#pullrequestreview-1");
  assert.equal(snapshot.projects[0]!.freshness, "fresh");
  assert.equal(collectProjectsSnapshot({ home, now: new Date("2026-09-30T10:02:00Z") }).projects[0]!.freshness, "stale");
  assert.equal(collectProjectsSnapshot({ home, now: new Date("2026-10-01T10:01:00Z") }).items.find(item => item.id === "review")!.links.preview, null, "expired previews never produce navigation");
  assert.equal(createHash("sha256").update(readFileSync(dbPath)).digest("hex"), before, "snapshot does not mutate the Run Store");
  database.prepare("UPDATE run_ci_snapshots SET checks_json=?").run(JSON.stringify(syntheticCiChecks()));
  const ciItem=collectProjectsSnapshot({home,now:new Date(at)}).items.find(item=>item.id==="review")!;
  assert.deepEqual(ciItem.ci.checks,syntheticCiChecks());
  assert.equal(ciItem.ci.observedAt,at);
  database.prepare("UPDATE run_ci_snapshots SET checks_json=?").run("{}");
  assert.deepEqual(collectProjectsSnapshot({home,now:new Date(at)}).items.find(item=>item.id==="review")!.ci.checks,[],"bad check payload does not make the entire dashboard unavailable");
  database.prepare("UPDATE run_ci_snapshots SET checks_json=?").run("[]");
  database.prepare("UPDATE project_triage_state SET factual_hash=?").run("b".repeat(64));
  assert.equal(collectProjectsSnapshot({home,now:new Date(at)}).items.find(item=>item.id==="backlog")?.suggestedNext,undefined,"obsolete ranking disappears when digest facts change");
  database.prepare("UPDATE project_triage_state SET factual_hash=?").run(factualHash);
  database.exec("UPDATE preview_leases SET verified_head_sha='previous-head'");
  assert.equal(collectProjectsSnapshot({ home, now: new Date(at) }).items[0]!.preview.state, "outdated", "old preview evidence cannot appear current");
  database.exec("UPDATE run_ci_snapshots SET head_sha=NULL; UPDATE run_ai_reviews SET head_sha='current-head'");
  assert.equal(collectProjectsSnapshot({ home, now: new Date(at) }).items[0]!.review.state, "unverified", "a result without a known current head is not marked valid");
  database.prepare("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES(?,?,?,?,?)").run("q_new", "r_current", "ai_review", "discord", "review2");
  assert.equal(collectProjectsSnapshot({ home, now: new Date(at) }).items[0]!.review.state, "queued", "a new request takes precedence over an older result");
  database.exec("UPDATE project_poll_state SET last_attempt_state='failed'; UPDATE run_discord_surfaces SET parent_channel_id='999'; UPDATE project_items SET url='javascript:alert(1)',title='<script>alert(1)</script>' WHERE item_id='review'");
  const changed = collectProjectsSnapshot({ home, now: new Date(at) });
  assert.equal(changed.projects[0]!.freshness, "stale");
  assert.equal(changed.items[0]!.links.discord, null); assert.equal(changed.items[0]!.links.issue, null);
  const html = renderProjectsPage(changed);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/); assert.doesNotMatch(html, /javascript:|<script>alert/);
  assert.doesNotMatch(html, /orchestrator\.db|compose_project_name|worktree/);
  database.close();
  writeFileSync(dbPath, "not sqlite");
  assert.equal(collectProjectsSnapshot({ home }).available, false, "corrupt store produces unavailable state, never fake zero tasks");
} finally { rmSync(home, { recursive: true, force: true }); }

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const key = { ...pair.publicKey.export({ format: "jwk" }), kid: "fixture" };
const now = Date.parse(at);
const claims = { iss: "https://example.cloudflareaccess.com", aud: ["projects-audience"], sub: "owner", type: "app", email: "owner@example.test", exp: now / 1000 + 60, nbf: now / 1000 - 1 };
function token(fields = {}, algorithm = "RS256"): string {
  const unsigned = [JSON.stringify({ alg: algorithm, kid: "fixture" }), JSON.stringify({ ...claims, ...fields })].map(value => Buffer.from(value).toString("base64url")).join(".");
  return unsigned + "." + sign("RSA-SHA256", Buffer.from(unsigned), pair.privateKey).toString("base64url");
}
function request(assertion: string): Pick<IncomingMessage, "headers"> { return { headers: { "cf-access-jwt-assertion": assertion } }; }
let fetches = 0;
const access = new ProjectsAccess({ team: claims.iss, audience: "projects-audience", ownerEmail: "owner@example.test", now: () => now,
  fetchKeys: (async () => { fetches++; return new Response(JSON.stringify({ keys: [key] })); }) as typeof fetch });
assert.equal(await access.authorize(request(token())), "owner");
assert.equal(await access.authorize(request(token())), "owner"); assert.equal(fetches, 1, "public keys are cached");
for (const invalid of [{ email: "other@example.test" }, { aud: ["hub-audience"] }, { iss: "https://evil.example" }, { exp: now / 1000 }, { nbf: now / 1000 + 10 }, { type: "service" }, { sub: "" }])
  assert.equal(await access.authorize(request(token(invalid))), null);
assert.equal(await access.authorize(request(token({}, "none"))), null);
const tampered = token().split("."); tampered[1] = Buffer.from(JSON.stringify({ ...claims, sub: "forged" })).toString("base64url");
assert.equal(await access.authorize(request(tampered.join("."))), null, "unverified forwarded identity is rejected");
assert.equal(await new ProjectsAccess({ team: "", audience: "", ownerEmail: "" }).authorize(request(token())), null);

const fixture = syntheticProjectsSnapshot();
for(const lang of ['en','ru'] as const)for(const state of ['unreviewed','current','outdated','unverified'] as const){
  const snapshot=structuredClone(fixture),item=snapshot.items[0]!;
  item.preview={state:'running',tone:'success',head:state==='unverified'?null:state==='outdated'?'previous':item.ci.head,expiresAt:'2030-01-01T00:00:00Z',reviewed:state!=='unreviewed'};
  const html=renderProjectsPage(snapshot,new URLSearchParams({item:item.id,lang}));
  if(state==='unreviewed')assert.doesNotMatch(html,/data-preview-review=/);
  else {assert.match(html,new RegExp(`data-preview-review="${state}"`));assert.match(html,state==='current'?new RegExp(lang==='ru'?'Превью просмотрено':'Preview reviewed'):new RegExp(lang==='ru'?state==='outdated'?'Просмотрено для предыдущего коммита':'Просмотр превью не подтверждён':state==='outdated'?'Reviewed for an earlier commit':'Preview review not verified'));}
}
for(const lang of ["en","ru"] as const)for(const state of ["pending","processing","failed","rejected"]){
  const snapshot=structuredClone(fixture),item=snapshot.items[0]!;
  item.runActions!.actions=RUN_ACTIONS.map(action=>({action,label:action,enabled:false,state,hint:null,confirmation:null}));
  const html=renderProjectsPage(snapshot,new URLSearchParams(`item=item-12&lang=${lang}`));
  for(const action of RUN_ACTIONS)assert.match(html,new RegExp(`data-run-action-state="${action}" data-request-state="${state}" role="status">${action} · `),'status names its operation, not just Queued below one button');
  assert.doesNotMatch(html,/>Queued<\/p>|>В очереди<\/p>/,'no bare queued labels remain for any run action');
}
for(const lang of ["en","ru"] as const)for(const state of ["queued","running","waiting_ci","resolving","succeeded","needs_attention"]){
  const snapshot=structuredClone(fixture),item=snapshot.items[0]!;
  item.stage="preview_ready";item.reviewFix={state,round:2};item.aiReview={enabled:false,reason:"unstable",head:item.ci.head};
  item.runActions!.actions=[{action:"review_fix",label:"Fix review findings",enabled:false,state:"pending",hint:null,confirmation:null}];
  const html=renderProjectsPage(snapshot,new URLSearchParams(`item=item-12&lang=${lang}`));
  assert.match(html,new RegExp(`data-review-fix-state="${state}"`),'every observed fix phase stays visible');
  assert.match(html,lang==="ru"?/Раунд 2/:/Round 2/);
  if(["queued","running","waiting_ci","resolving"].includes(state)){
    assert.doesNotMatch(html,/data-review-run=/,'active fix does not offer a second review');
    assert.doesNotMatch(html,/>Queued<\/p>|>В очереди<\/p>/,'queued is not stranded below one button');
    assert.notEqual(projectStageLabel(item,lang),lang==="ru"?"Превью готово":"Preview ready",'fix progress replaces stale preview stage');
  }
}
const semantics=structuredClone(fixture);
semantics.items[0]!.review={...semantics.items[0]!.review,state:'ready',critical:1,important:2,suggestions:3};
semantics.items[0]!.preview.state='running';
for(const lang of ['en','ru']){
  for(const [minutes,tone]of [[120,'neutral'],[30,'warning'],[-1,'warning']] as const){
    semantics.items[0]!.preview.expiresAt=new Date(Date.parse(semantics.generatedAt)+minutes*60000).toISOString();
    const html=renderProjectsPage(semantics,new URLSearchParams(`item=item-12&lang=${lang}`));
    assert.match(html,/data-note-tone="failure">1 /);assert.match(html,/data-note-tone="warning">2 /);assert.match(html,/data-note-tone="neutral">3 /);
    assert.match(html,new RegExp(`data-preview-expiry="[^"]+" data-note-tone="${tone}"`));
  }
}
semantics.items[0]!.preview.state='stopped';
assert.doesNotMatch(renderProjectsPage(semantics,new URLSearchParams('item=item-12')),/data-preview-expiry=/,'a retired environment does not warn about an old expiry');
const accented=structuredClone(fixture);
const actionTones={ci_repair:"secondary",review_fix:"secondary",preview_stop:"warning",preview_reviewed:"success",stop:"danger",discard_local:"danger",discard_published:"danger",take_control:"subtle",preview_start:"subtle",recover_managed_task:"subtle"};
accented.items[0]!.runActions!.actions=(Object.keys(actionTones) as (keyof typeof actionTones)[]).map(action=>({action,label:action,enabled:true,confirmation:null,hint:null,state:null}));
for(const lang of ["en","ru"]){
  const html=renderProjectsPage(accented,new URLSearchParams(`item=item-12&lang=${lang}`));
  for(const [action,tone]of Object.entries(actionTones))assert.match(html,new RegExp(`class="button button--${tone}[^"\\n]*"[^>]*data-run-action="${action}"`),`semantic action accent: ${action}`);
  const saveButton=html.match(/<button[^>]*data-status-submit[^>]*>/)?.[0];
  assert.ok(saveButton,"status Save is present");
  assert.match(saveButton,/class="button button--info/);
  assert.match(saveButton,/\sdisabled(?:\s|>)/,"unchanged status Save remains disabled");
}
const iconFixture=structuredClone(fixture);
// Icons come from the registry's `icon` field (src/core/projects-registry.ts), not from the name.
iconFixture.projects=([["PickFlick","panda"],["TailorTales","fox"],["AHurynovich-CV","profile"]] as const).map(([name,icon],index)=>({...fixture.projects[0]!,key:`project-${index}`,name,icon}));
const iconPage=renderProjectsPage(iconFixture),mobileProjectNav=iconPage.split('id="mobile-menu-sections"')[1]!.split('</nav>')[0]!;
for(const icon of ["projects","panda","fox","profile"] as const)assert.ok(mobileProjectNav.includes(iconPath(icon)),`mobile project navigation: ${icon}`);
assert.doesNotMatch(iconPage.split('<div class="site-header__inner container">')[1]!.split('</a>\n')[1]!.split('class="site-actions"')[0]!,/<svg/,'desktop project navigation remains text-only');
// Project colours are carried by the icon and name; attention keeps its own tint.
const colourRows=[...renderProjectsPage(fixture).matchAll(/<tr class="(projects-row[^"]*)"/g)].map(match=>match[1]!);
assert.ok(colourRows.some(row=>row.includes("project-color--teal"))&&colourRows.some(row=>row.includes("project-color--violet")),"rows carry their project's hue");
assert.ok(colourRows.every(row=>/project-color--(teal|violet)/.test(row)),"every row has a hue");
const pandaFixture=structuredClone(fixture);pandaFixture.projects[0]!.icon="panda";
assert.ok(renderProjectsPage(pandaFixture).includes(`<div class="projects-task-meta"><span class="project-identity">${renderIconMarkup("panda")}`),"the row shows the project's own icon");
assert.doesNotMatch(PROJECTS_STYLES,/\.projects-row(?: > th)? \{ box-shadow: var\(--project-edge/);
assert.match(PROJECTS_STYLES,/\.project-color--gold \{ --project-color: var\(--project-gold\); \}/);
assert.match(PROJECTS_STYLES,/html\[data-kurami-theme="neon"\] \[class\*="project-color--"\] \{ --project-edge: inset 3px 0 0 var\(--project-color\), inset 14px/,"Neon lights the bar");
assert.throws(()=>projectColorClass("red" as never),/Unknown project color/);
const runlessDone=structuredClone(fixture);runlessDone.items=[{...fixture.items[3]!,status:"Done"}];
assert.match(renderProjectsPage(runlessDone),/>No agent run<\/span>/,"no observed agent run is distinct from GitHub completion");
assert.match(renderProjectsPage(runlessDone,new URLSearchParams("lang=ru")),/>Нет запуска<\/span>/);
assert.doesNotMatch(renderProjectsPage(runlessDone),/>Not started<\/span>/);
assert.match(renderProjectsPage(fixture),/projects-sync-indicator--delayed/);
const freshOnly=structuredClone(fixture);freshOnly.projects.forEach(project=>project.freshness="fresh");
assert.match(renderProjectsPage(freshOnly),/projects-sync-indicator--fresh/);
assert.match(renderProjectsPage(freshOnly),/title="Sync · Up to date"/);
freshOnly.available=false;
assert.match(renderProjectsPage(freshOnly),/projects-sync-indicator--delayed/,"unavailable snapshots cannot show a fresh indicator");
const composed=structuredClone(fixture);
const composedItem=composed.items[0]!;
composedItem.aiReview={enabled:false,reason:"ready",head:composedItem.ci.head};
composedItem.review={...composedItem.review,state:"ready",head:composedItem.ci.head};
composedItem.preview={...composedItem.preview,state:"running",head:composedItem.ci.head};
composedItem.preview.expiresAt="2026-10-04T10:00:00Z";
composedItem.links.preview="https://example.test/preview";
const detailHtml=renderProjectsPage(composed,new URLSearchParams("item=item-12")).split('<aside class="projects-detail"')[1]!;
assert.match(detailHtml,/data-disclosure-key="ci:item-12:abcdef0123456789"[^>]*><summary>[\s\S]*?Checks · 6/);
assert.match(detailHtml,/href="https:\/\/github.com\/Example\/Alpha\/actions\/runs\/100\/job\/201#step:2:1"/);
const ciMarkup=detailHtml.split('<ul class="projects-ci-checks">')[1]!.split('</ul>')[0]!;
assert.doesNotMatch(ciMarkup,/projects-ci-result|class="button__svg"/,"CI rows have no repeated status text or external-link arrows");
assert.match(ciMarkup,/button__label--truncate/);
assert.match(ciMarkup,/<li[^>]+><div class="projects-ci-check-content">[\s\S]*?<\/div><span class="projects-ci-mark/,"result icon follows the check name");
assert.match(ciMarkup,/aria-label="Secret scan · Passed · Open check in GitHub"/);
assert.doesNotMatch(renderProjectsPage(fixture),/projects-ci-checks|Secret scan/,"check breakdown stays out of the task table");
const failedCi=renderProjectsPage(fixture,new URLSearchParams("item=item-13")).split('<aside class="projects-detail"')[1]!;
assert.match(failedCi,/data-disclosure-key="ci:item-13:[^"]+" open>/,"failed checks are visible without an extra click");
assert.equal((failedCi.match(/projects-ci-mark--failure/g)??[]).length,2);
const unreported=structuredClone(composed);unreported.items[0]!.ci.checks=[{name:"<script>CI</script>",state:"missing",detailsUrl:"javascript:alert(1)"},{name:"Waiting",state:"pending",detailsUrl:null},{name:"Unknown",state:"unknown",detailsUrl:null}];
const unreportedHtml=renderProjectsPage(unreported,new URLSearchParams("item=item-12&lang=ru")).split('<aside class="projects-detail"')[1]!;
assert.match(unreportedHtml,/Проверки · 3/);assert.match(unreportedHtml,/Результат ещё не получен/);assert.match(unreportedHtml,/&lt;script&gt;CI&lt;\/script&gt;/);assert.doesNotMatch(unreportedHtml,/javascript:|<script>CI/);
unreported.items[0]!.ci.checks=[];
assert.match(renderProjectsPage(unreported,new URLSearchParams("item=item-12")),/Check details unavailable/);
assert.equal((detailHtml.match(/example.test\/preview/g)??[]).length,1,"Preview has one link beside its evidence");
assert.equal((detailHtml.match(/abcdef012345<\/code>/g)??[]).length,1,"matching evidence heads are shown once");
assert.doesNotMatch(detailHtml,/data-review-run=/,"already-reviewed commits do not receive a duplicate disabled review button");
assert.match(detailHtml,/🔎 General/);
assert.match(detailHtml,/projects-review-profile/);
assert.match(detailHtml,/projects-status-editor/);
assert.doesNotMatch(detailHtml,/<details[^>]*projects-status-editor/);
assert.match(detailHtml,/class="button button--subtle button--compact" href="https:\/\/example.test\/preview"/);
assert.match(detailHtml,/projects-info/);
assert.match(detailHtml,/projects-evidence-row[\s\S]*data-run-action="preview_start"/);
assert.doesNotMatch(detailHtml,/<h3>[\s\S]*?>(?:Work|Cleanup)<\/h3>|<h3>[^<]*Preview|<h3>[^<]*Fixes/);
composedItem.preview.head=null;
const mixed=renderProjectsPage(composed,new URLSearchParams("item=item-12")).split('<aside class="projects-detail"')[1]!;
assert.match(mixed,/Unverified<\/code>/,"unknown evidence heads remain explicit rather than borrowing a shared commit");
assert.deepEqual(selectItems(fixture,parseFilters(new URLSearchParams("attention=1"))).map(item=>item.id),["item-12","item-24"],"attention view includes review and waiting owner input, not agent work");
for(const lang of ["en","ru"]){
  const attentionPage=renderProjectsPage(fixture,new URLSearchParams(`attention=1&lang=${lang}`));
  assert.match(attentionPage,/data-kurami-presence="[a-f0-9]{64}"/);
  assert.match(attentionPage,/href="\/\?attention=1&amp;lang=(?:en|ru)&amp;item=item-12"[^>]*data-item-link="item-12"/);
}
const reviewOnly=structuredClone(fixture);reviewOnly.items=[fixture.items[0]!,fixture.items[3]!];
const reviewOnlyPage=renderProjectsPage(reviewOnly,new URLSearchParams("active=1"));
assert.match(reviewOnlyPage,/data-task-filter="active"[^>]*>[\s\S]*?<strong class="button__count">1<\/strong> <span[^>]*>active<\/span>/,"active count includes review even when no card is in the working status");
assert.equal(selectItems(reviewOnly,parseFilters(new URLSearchParams("active=1"))).length,1);
assert.equal(parseFilters(new URLSearchParams("active=1&attention=1")).activeOnly,false,"attention view takes precedence for ambiguous links");
assert.deepEqual(selectItems(fixture,parseFilters(new URLSearchParams("active=1"))).map(item=>item.id),["item-12","item-13","item-24"],"active view includes work, review and owner input");
const inactive = structuredClone(fixture);
inactive.items = ["Backlog","Deferred","Done"].map((status,index)=>({...fixture.items[1]!,id:`inactive-${index}`,status,attention:[{code:"run_attention" as const,severity:"critical" as const}]}));
inactive.items.push({...fixture.items[1]!,id:"unclassified-work",status:null},{...fixture.items[2]!,id:"unclassified-attention",status:null},{...fixture.items[3]!,id:"unclassified-idle",status:null});
assert.deepEqual(selectItems(inactive,parseFilters(new URLSearchParams("active=1"))).map(item=>item.id),["unclassified-work","unclassified-attention"],"closed or inactive cards stay hidden despite old run signals; current work and attention remain visible");
const customStatuses=structuredClone(fixture);
customStatuses.projects[1]!.statuses={backlog:"Todo",active:"Working",review:"Needs eyes",done:"Closed",deferred:"Later"};
customStatuses.items[2]!.status="Needs eyes";customStatuses.items[3]!.status="Later";
assert.deepEqual(selectItems(customStatuses,parseFilters(new URLSearchParams("active=1&project=beta"))).map(item=>item.id),["item-24"],"uses each project's configured status roles");
assert.equal(selectItems(fixture, parseFilters(new URLSearchParams("project=beta"))).length, 2);
assert.equal(selectItems(fixture,parseFilters(new URLSearchParams("view=attention&status=Done"))).length,6,"retired filters do not hide tasks");
const ascending=selectItems(fixture,parseFilters(new URLSearchParams("sort=status"))).map(item=>item.status);
assert.deepEqual(ascending,["Backlog","Backlog","Done","Human Review","In progress","In progress"]);
assert.deepEqual(selectItems(fixture,parseFilters(new URLSearchParams("sort=status&dir=desc"))).map(item=>item.status),ascending.toReversed());
assert.match(renderProjectsPage(fixture),/<html[^>]*lang="en"/);
assert.match(renderProjectsPage(fixture,new URLSearchParams("lang=ru")),/Поиск задач/);
let authorized = false; let reads = 0;
const server = createProjectsServer({ snapshot: () => { reads++; return fixture; }, authorize: async () => authorized ? "owner" : null });
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
try {
  for (const path of ["/", "/api/fragment", "/assets/projects.css"]) assert.equal((await fetch(base + path)).status, 403);
  assert.equal(reads, 0, "authorization precedes any private snapshot read");
  assert.equal((await fetch(base + "/health")).status, 200);
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
  authorized = true;
  const page = await fetch(base);
  assert.equal(page.status, 200); assert.match(page.headers.get("cache-control")!, /no-store/);
  assert.equal(page.headers.get("x-kurami-projects-version"),PROJECTS_CLIENT_VERSION);
  assert.match(page.headers.get("content-security-policy")!, /form-action 'self'/);
  assert.match(await page.text(), /Alpha/);
  assert.match(await (await fetch(base + "/api/fragment?project=beta")).text(), /Beta/);
  const fragment=await fetch(base+"/api/fragment?item=item-15");
  assert.equal(fragment.headers.get("x-kurami-projects-version"),PROJECTS_CLIENT_VERSION);
  assert.equal(await(await fetch(base+"/assets/projects.js?v="+PROJECTS_CLIENT_VERSION)).text(),PROJECTS_CLIENT_JS);
  assert.equal((await fetch(base, { method: "HEAD" })).status, 200);
  assert.equal(await (await fetch(base, { method: "HEAD" })).text(), "");
  assert.equal((await fetch(base + "/config/projects.yaml")).status, 404);
  assert.equal((await fetch(base + "/api/actions", { method: "POST" })).status, 405);
} finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
// Without the gateway there is no owner: a direct request gets nothing and never reaches a control adapter.
{
  let actor: string | undefined;
  const runtime = createProjectsServer({ snapshot: () => fixture,
    review: (_input, identity) => { actor = identity; return { requestId: "fixture-request", requestState: "requested", state: "created" }; } });
  await new Promise<void>(done => runtime.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${(runtime.address() as { port: number }).port}`;
  try {
    for (const path of ["/", "/api/fragment"]) assert.equal((await fetch(origin + path)).status, 403);
    const post = (source: string) => fetch(origin + "/api/ai-review", { method: "POST", headers: { "Content-Type": "application/json", Origin: source }, body: "{}" });
    for (const source of ["https://other.example", "https://projects.shagon1k.win", "https://kurami.shagon1k.win"]) assert.equal((await post(source)).status, 403);
    assert.equal(actor, undefined, "requests outside the gateway never enter a control adapter");
  } finally { await new Promise<void>((done, reject) => runtime.close(error => error ? reject(error) : done())); }
}
console.log("Projects: real schema, read-only access, current attempts/SHA, stale data, safe links, signed owner authorization and HTTP boundaries verified");
