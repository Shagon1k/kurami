import assert from "node:assert/strict";
import {mkdtemp,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {once} from "node:events";
import {createServer} from "node:http";
import {briefingPaths,initializeBriefingStore,openBriefingDatabase,upsertAddonSnapshot} from "../../src/briefing/store.ts";
import {publishedSiteLinks} from "../../src/briefing/site-navigation.ts";
import {renderSiteHeader,renderSiteNavigation,injectSiteNavigation,type SiteSection} from "../../src/briefing/ui/components/site-header.ts";
import {renderPageShell} from "../../src/briefing/ui/page-shell.ts";
import {createBriefingServer,injectRuntime} from "../../src/briefing/server.ts";
import {buildWeeklyReview} from "../../src/briefing/weekly/build.ts";
import type {BriefingAddonEnvelope} from "../../src/briefing/model.ts";

const root=resolve(import.meta.dirname,"../.."),home=await mkdtemp(resolve(tmpdir(),"kurami-header-"));
const paths=briefingPaths({KURAMI_HOME:home,BRIEFING_MIGRATIONS_DIR:resolve(root,"migrations/briefing")});
await initializeBriefingStore(paths);
const database=openBriefingDatabase(paths),at="2026-09-17T12:00:00Z";
assert.deepEqual(publishedSiteLinks(database,true,at),[]);
const insert=database.prepare(`INSERT INTO editions(id,edition_type,local_date,timezone,state,payload_json,html_path,content_digest,preview_enabled,is_current,prepared_at,published_at,retention_until,updated_at)
 VALUES(?,?,?,'Europe/Vilnius',?,'{}','pages/preview/test.html','test',1,1,?,?,?,?)`);
insert.run("daily:2026-09-17","daily","2026-09-17","complete",at,at,"2026-09-24T00:00:00Z",at);
insert.run("cinema:2026-09-12","cinema","2026-09-12","prepared",at,null,"2099-01-01T00:00:00Z",at);
assert.deepEqual(publishedSiteLinks(database,true,at).map(x=>x.section),["daily"]);
database.prepare("UPDATE editions SET state='partial' WHERE edition_type='cinema'").run();
assert.deepEqual(publishedSiteLinks(database,true,at).map(x=>x.section),["daily","cinema"]);
const review=buildWeeklyReview(database,"2026-09-20","Europe/Vilnius",at);
upsertAddonSnapshot(database,"weekly",review as unknown as BriefingAddonEnvelope);
assert.deepEqual(publishedSiteLinks(database,true,at).map(x=>x.section),["daily","cinema"],"empty preview is not a published review");
review.state="partial";review.data.coverage.news=1;review.data.days[0]!.stories=3;
upsertAddonSnapshot(database,"weekly",review as unknown as BriefingAddonEnvelope);
assert.deepEqual(publishedSiteLinks(database,true,at).map(x=>x.section),["daily","cinema","weekly"]);
assert.deepEqual(publishedSiteLinks(database,false,at).map(x=>x.section),["daily","cinema"]);
assert.deepEqual(publishedSiteLinks(database,true,"2026-10-01T00:00:00Z").map(x=>x.section),["cinema","weekly"]);
const input={section:"cinema" as const,date:"2026-09-12",dateLabel:"12 сентября 2026",links:publishedSiteLinks(database,true,at)};
const header=renderSiteHeader(input);
assert.match(header,/kurami-fox.webp/);assert(!header.includes(">K</span>"));
assert.match(header,/href="\/cinema" aria-current="location"/);
assert.match(header,/aria-label="Разделы Kurami"/);
assert.match(header,/class="site-switcher"/);
assert.match(header,/href="https:\/\/hub\.shagon1k\.win\/"[^>]*>Hub<\/a>/);
assert.match(renderSiteHeader({...input,dateLabel:'<script>"test"</script>'}),/&lt;script&gt;/);
assert.throws(()=>renderSiteNavigation([{section:"__proto__" as SiteSection}],"daily"));
assert.throws(()=>renderSiteNavigation([{section:"daily"},{section:"daily"}],"daily"));
const original=renderPageShell({title:"Тест",brand:"Kurami",section:"daily",date:"2026-09-17",dateLabel:"четверг, 17 сентября 2026 г.",generated:"09:00",timezone:"Europe/Vilnius",content:"<h1>Содержание не меняется</h1>"});
const updated=injectSiteNavigation(original,input.links,"daily");
assert.match(updated,/href="\/weekly"/);
assert(updated.includes("<h1>Содержание не меняется</h1>"));
assert.equal(injectSiteNavigation(updated,input.links,"daily"),updated);
const frozen=original.replace(/<details class="site-switcher">[\s\S]*?<\/details>/,"")
  .replace('/assets/kurami-fox.webp','/assets/kurami-fox.png');
const refreshed=injectSiteNavigation(frozen,input.links,"daily");
assert.match(refreshed,/class="site-switcher"/);
assert.match(refreshed,/Projects<small class="site-nav__hint">скоро<\/small><\/span>/);
assert.match(refreshed,/src="\/assets\/kurami-fox.webp"/);
assert.match(refreshed,/<style>\s*\.site-header \{/);
assert.equal(injectSiteNavigation(refreshed,input.links,"daily"),refreshed);
const asset=await readFile(resolve(root,"src/ui-library/assets/brand/kurami-fox-transparent.png"));
assert.equal(asset.subarray(1,4).toString(),"PNG");assert.equal(asset[25],6,"RGBA PNG required");
assert.equal(asset.readUInt32BE(16),512);assert.equal(asset.readUInt32BE(20),512);
const headerAsset=await readFile(resolve(root,"src/ui-library/assets/brand/kurami-fox-header.webp"));
assert.equal(headerAsset.subarray(0,4).toString(),"RIFF");assert.equal(headerAsset.subarray(8,12).toString(),"WEBP");
const app=await createBriefingServer(paths,{mailActionExecutor:null});
app.listen(0,"127.0.0.1");await once(app,"listening");
const appBase="http://127.0.0.1:"+(app.address() as {port:number}).port;
const logo=await fetch(appBase+"/assets/kurami-fox.png");
assert.equal(logo.status,200);assert.equal(logo.headers.get("content-type"),"image/png");
assert.deepEqual(Buffer.from(await logo.arrayBuffer()),asset);
assert.equal((await fetch(appBase+"/assets/kurami-fox.png",{method:"HEAD"})).status,200);
const headerLogo=await fetch(appBase+"/assets/kurami-fox.webp");
assert.equal(headerLogo.status,200);assert.equal(headerLogo.headers.get("content-type"),"image/webp");
assert.deepEqual(Buffer.from(await headerLogo.arrayBuffer()),headerAsset);
assert.equal((await fetch(appBase+"/assets/kurami-fox.webp",{method:"HEAD"})).status,200);
const font=await fetch(appBase+"/assets/onest-cyrillic.woff2");
assert.equal(font.status,200);assert.equal(font.headers.get("content-type"),"font/woff2");
assert.deepEqual(Buffer.from(await font.arrayBuffer()),await readFile(resolve(root,"src/ui-library/assets/fonts/onest-cyrillic.woff2")));
assert.equal((await fetch(appBase+"/assets/unknown.woff2")).status,404);
assert.match(String((await fetch(appBase+"/")).headers.get("content-security-policy")),/font-src 'self' data:;/);
console.log("Site header: published-only navigation, empty/disabled states, immutable content, accessible active section and transparent asset and self-hosted fonts verified.");
if(process.env.HEADER_PREVIEW_PORT) {
  const server=createServer(async(request,response)=>{
    const path=new URL(request.url??"/","http://localhost").pathname;
    if(path.startsWith("/assets/")||path==="/favicon.svg"){
      const upstream=await fetch(appBase+path);
      response.writeHead(upstream.status,{"content-type":upstream.headers.get("content-type")??"application/octet-stream"});
      response.end(Buffer.from(await upstream.arrayBuffer()));return;
    }
    const current:SiteSection=path==="/cinema"?"cinema":path==="/weekly"?"weekly":"daily";
    const html=renderPageShell({title:"Header · проверка",brand:"Kurami",section:current,date:"2026-09-17",dateLabel:current==="weekly"?"13 сент. — 19 сент.":"четверг, 17 сентября 2026 г.",generated:"09:00",timezone:"Europe/Vilnius",
      content:'<section class="hero"><div><p class="hero__eyebrow">Демонстрационная страница</p><h1>Всё важное — рядом.</h1><p class="hero__subtitle">Проверка новой общей шапки. Ссылки переключают локальные примеры.</p></div></section><section style="min-height:140vh"><h2>Пример секции</h2><p>Прокрутите страницу, чтобы проверить фиксированную шапку и её тень.</p></section>'});
    response.writeHead(200,{"content-type":"text/html; charset=utf-8"});
    response.end(injectRuntime(injectSiteNavigation(html,input.links,current)));
  });
  server.listen(Number(process.env.HEADER_PREVIEW_PORT),"127.0.0.1");await once(server,"listening");
  console.log("Header preview: http://127.0.0.1:"+process.env.HEADER_PREVIEW_PORT);
} else {
  await new Promise<void>((resolve,reject)=>app.close(error=>error?reject(error):resolve()));
  database.close();
}
