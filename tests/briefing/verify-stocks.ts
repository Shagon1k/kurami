import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {once} from "node:events";
import {parse as yaml} from "yaml";
import {parseStocksConfig,type StocksConfig} from "../../src/briefing/stocks/config.ts";
import {parseStockPoints,parseStocksSnapshot,stockQuote,dayShift,type StocksSnapshot} from "../../src/briefing/stocks/model.ts";
import {refreshStocksSafely,loadStocksCache} from "../../src/briefing/stocks/collector.ts";
import {attachStocksBrief} from "../../src/briefing/stocks/lifecycle.ts";
import {renderStocksPage,renderStocksTeaser} from "../../src/briefing/stocks/render.ts";
import {stocksChart,stockSelection} from "../../src/briefing/stocks/view.ts";
import {createChartEngine} from "../../src/briefing/ui/charts/engine.ts";
import {briefingPaths,initializeBriefingStore,openBriefingDatabase,loadEdition,refreshPublishedEdition} from "../../src/briefing/store.ts";
import {parseBriefingPayload,preparePreview} from "./payload-fixtures.ts";
import {renderBriefingPage} from "../../src/briefing/ui/render-page.ts";
import {createBriefingServer} from "../../src/briefing/server.ts";
import {publishedSiteLinks} from "../../src/briefing/site-navigation.ts";
import {importStocksProbe} from "../../src/briefing/stocks/import-probe.ts";
import type {FetchLike} from "../../src/briefing/providers/common.ts";
import {STOCKS_CLIENT_SCRIPT} from "../../src/briefing/stocks/client.ts";
import {renderStockDetails} from "../../src/briefing/stocks/components.ts";
import {renderSparkline} from "../../src/briefing/ui/charts/sparkline.ts";
import {stockInsights} from "../../src/briefing/stocks/insights.ts";
import {Script} from "node:vm";
import {verifyStockClient} from "./stocks-client-harness.ts";
import {acceptReview} from "../../src/briefing/investment-review/store.ts";
import {inputDigest,type ReviewInput,type ReviewDraft} from "../../src/briefing/investment-review/model.ts";

const root=resolve(import.meta.dirname,"../..");
const config=parseStocksConfig(yaml(await readFile(resolve(root,"deploy/config/briefing.yaml"),"utf8")).stocks);
assert(config.enabled);assert.equal(config.assets.length,12);
assert.equal(config.assets.find(a=>a.id==="SPCX")!.isin,"US84615Q1031");
assert.equal(config.assets.find(a=>a.id==="VUAA")!.currency,"EUR");
assert.equal(parseStocksConfig({...config,assets:[...config.assets,config.assets[0]]}).enabled,false);
new Script(STOCKS_CLIENT_SCRIPT);
await verifyStockClient();
const home=await mkdtemp(resolve(tmpdir(),"kurami-stocks-")),paths=briefingPaths({KURAMI_HOME:home,BRIEFING_MIGRATIONS_DIR:resolve(root,"migrations/briefing")});
await initializeBriefingStore(paths);
await mkdir(resolve(home,"config"),{recursive:true});
await writeFile(resolve(home,"config/stocks.env"),"EODHD_API_TOKEN=secret-test-not-for-output\n",{mode:0o600});
let requests:URL[]=[];
const points=(from:string,to:string)=>Array.from({length:365},(_,i)=>dayShift(from,i)).filter(date=>date<=to&&![0,6].includes(new Date(date+"T12:00:00Z").getUTCDay()))
  .map((date,i)=>({date,open:100+i,high:102+i,low:98+i,close:100+i,adjusted_close:100+i,volume:1000}));
const metadata=config.assets.map(a=>({Code:a.id,Currency:a.currency,Isin:a.isin,Exchange:a.exchange,Name:a.name}));
let failure="",used=0,plan="free",active=0,maxActive=0;
const fake:FetchLike=async(input)=>{
  const url=new URL(String(input));requests.push(url);
  assert.equal(url.hostname,"eodhd.com");assert.equal(url.searchParams.get("api_token"),"secret-test-not-for-output");
  if(url.pathname==="/api/user")return Response.json({subscriptionType:plan,dailyRateLimit:20,apiRequests:used,apiRequestsDate:"2026-09-18",extraLimit:500});
  if(url.pathname.includes("exchange-symbol-list"))return Response.json(metadata.filter(a=>a.Exchange==="US"));
  if(url.pathname.includes("/search/"))return Response.json(metadata.filter(a=>a.Exchange!=="US"));
  active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setTimeout(resolve,3));active--;
  if(failure && url.pathname.endsWith(failure))return new Response("not available",{status:403});
  return Response.json(points(url.searchParams.get("from")!,url.searchParams.get("to")!));
};
assert.equal((await refreshStocksSafely({...config,enabled:false},paths,{at:new Date("2026-09-17T06:00:00Z"),fetchImpl:fake})).state,"disabled");
assert.equal(requests.length,0);
assert.equal((await refreshStocksSafely(config,paths,{at:new Date("2026-09-17T04:00:00Z"),fetchImpl:fake})).state,"not_due");
const first=await refreshStocksSafely(config,paths,{at:new Date("2026-09-17T06:00:00Z"),fetchImpl:fake});
assert.equal(first.state,"ready");assert.equal(requests.length,15);assert(maxActive<=3);
assert.equal((await refreshStocksSafely(config,paths,{at:new Date("2026-09-17T07:00:00Z"),fetchImpl:fake})).state,"already_attempted");
assert.equal(requests.length,15,"reload must not spend the free quota again");
const database=openBriefingDatabase(paths);
const initial=loadStocksCache(database)!;
assert.equal(initial.data.series.length,12);
assert(initial.data.series.find(s=>s.asset.id==="SPCX")!.points.every(p=>p.date>="2026-06-12"));
assert(requests.filter(u=>u.pathname.includes("/eod/")).every(u=>u.searchParams.get("to")==="2026-09-16"));
const oldNvidia=initial.data.series.find(s=>s.asset.id==="NVDA")!.points;
failure="NVDA.US";requests=[];
const second=await refreshStocksSafely(config,paths,{at:new Date("2026-09-18T06:00:00Z"),fetchImpl:fake});
assert.equal(second.state,"partial");
const snapshot=loadStocksCache(database)!;
assert.deepEqual(snapshot.data.series.find(s=>s.asset.id==="NVDA")!.points,oldNvidia);
assert.equal(snapshot.data.series.find(s=>s.asset.id==="NVDA")!.state,"stale");
used=14;requests=[];
await refreshStocksSafely(config,paths,{at:new Date("2026-09-18T07:00:00Z"),fetchImpl:fake});
assert.equal(requests.length,0);
// A new test home isolates base-quota checks from the successful day ledger.
const budgetHome=await mkdtemp(resolve(tmpdir(),"kurami-stocks-budget-")),budgetPaths=briefingPaths({KURAMI_HOME:budgetHome,BRIEFING_MIGRATIONS_DIR:paths.migrationsDirectory});
await initializeBriefingStore(budgetPaths);await mkdir(resolve(budgetHome,"config"));
await writeFile(resolve(budgetHome,"config/stocks.env"),"EODHD_API_TOKEN=secret-test-not-for-output\n",{mode:0o600});
const limited=await refreshStocksSafely(config,budgetPaths,{at:new Date("2026-09-18T06:00:00Z"),fetchImpl:fake});
assert.equal(limited.state,"failed");assert.equal(requests.length,1,"welcome credits cannot authorize extra calls");
assert(!JSON.stringify(limited).includes("secret-test"));

plan="paid";requests=[];
const paid=await refreshStocksSafely(config,budgetPaths,{at:new Date("2026-09-19T06:00:00Z"),fetchImpl:fake});
assert.equal(paid.state,"failed");assert.equal(requests.length,1);
plan="free";
const seedHome=await mkdtemp(resolve(tmpdir(),"kurami-stocks-seed-"));
const seedPaths=briefingPaths({KURAMI_HOME:seedHome,BRIEFING_MIGRATIONS_DIR:paths.migrationsDirectory});
await initializeBriefingStore(seedPaths);
const probe={checkedAt:initial.capturedAt,catalog:{items:metadata},vuaa:{items:metadata},
  finalQuota:{subscriptionType:"free",dailyRateLimit:20,apiRequests:14,apiRequestsDate:"2026-09-17"},
  history:initial.data.series.map(s=>({symbol:s.asset.symbol,currency:s.asset.currency,ok:true,status:200,
    data:s.points.map(p=>({date:p.date,close:p.close,adjusted_close:p.adjusted}))}))};
const probePath=resolve(seedHome,"probe.json");await writeFile(probePath,JSON.stringify(probe));
assert.equal((await importStocksProbe(probePath,config,seedPaths,new Date("2026-09-17T07:00:00Z"))).imported,12);
await assert.rejects(importStocksProbe(probePath,config,seedPaths,new Date("2026-09-17T07:00:00Z")),/already exists/);
requests=[];
assert.equal((await refreshStocksSafely(config,seedPaths,{at:new Date("2026-09-17T08:00:00Z"),fetchImpl:fake})).state,"already_attempted");
assert.equal(requests.length,0);

const split={asset:config.assets[0]!,points:[{date:"2026-09-14",close:100,adjusted:50},{date:"2026-09-15",close:51,adjusted:51}],state:"ready" as const,fetchedAt:"2026-09-16T06:00:00Z"};
assert(Math.abs(stockQuote(split,"2026-09-16T07:00:00Z").day!-2)<1e-8,"split must not become a fake 49% crash");
assert.equal(stockQuote({...split,points:split.points.slice(0,1)},"2026-09-16T07:00:00Z").day,null);
assert.throws(()=>parseStockPoints([{date:"2026-09-17",close:1,adjusted_close:1}],"2026-09-01","2026-09-16"));
assert.throws(()=>parseStockPoints([{date:"2026-09-16",close:0,adjusted_close:1}],"2026-09-01","2026-09-16"));
for(const period of ["1m","3m","1y"] as const) {
  const chart=stocksChart(initial,{ids:["VUAA","SPCX","MSFT"],period});
  assert(chart.categories.length<=120);
  assert(chart.categories[0]!.key>="2026-06-12");
  assert(chart.series.every(series=>Math.abs(series.values[0]??99)<1e-8));
  assert.equal(createChartEngine().parse({...chart,version:1,kind:"trend"}).series.length,3);
}
assert.throws(()=>stockSelection(initial,new URLSearchParams("symbols=UNKNOWN")));
assert.throws(()=>stockSelection(initial,new URLSearchParams("symbols=VUAA,VUAA")));
assert.throws(()=>stockSelection(initial,new URLSearchParams("period=10y")));
assert.throws(()=>stockSelection(initial,new URLSearchParams("symbols=VUAA,SPCX,NVDA,MSFT,MRK,AMZN")));
const html=renderStocksPage(initial,new URLSearchParams("symbols=VUAA,MSFT&period=1y"),"2026-09-17T07:00:00Z");
assert.match(html,/Мои акции/);assert.match(html,/data-stock-row/);assert.match(html,/data-chart-spec/);
assert.match(html,/data-stock-sort/);
for(const copy of ["Мини-графики показывают месяц", "Котировки могут отличаться от Revolut", "Факты из истории скорректированных закрытий", "Для VUAA — знак управляющей компании"])assert(!html.includes(copy));
assert(!html.includes("data-stock-select"));assert(!html.includes("data-stock-compare"));
assert.equal((html.match(/data-stock-row=/g)??[]).length,12);
assert.equal((html.match(/name="stocks-watchlist"[^>]* open/g)??[]).length,1);
assert.equal((html.match(/data-chart-spec=/g)??[]).length,1,"Only selected chart is sent, not twelve hidden graphs");
const closed=renderStocksPage(initial,new URLSearchParams(),"2026-09-17T07:00:00Z");
assert(!closed.includes("data-chart-spec="));assert.equal((closed.match(/class="sparkline"/g)??[]).length,12);
for(const period of ["1m","3m","1y"]){
  const details=renderStockDetails(initial,new URLSearchParams({symbols:"NVDA",period}),"2026-09-17T07:00:00Z");
  assert.match(details,/stock-chart-NVDA-title/);assert(details.includes('data-period="'+period+'"'));
  assert(details.includes('aria-current="true"'));assert(!details.includes("secret-test"));
}
assert.throws(()=>renderStockDetails(initial,new URLSearchParams("symbols=NVDA,MSFT")));
const findings=stockInsights(initial,"2026-09-17T07:00:00Z");
assert(findings.length<=3);assert.equal(new Set(findings.map(f=>f.symbol)).size,findings.length);
assert.equal(stockInsights(initial,"2026-10-17T07:00:00Z").length,0,"Stale values cannot create new insights");
assert.equal(stockInsights({...initial,data:{...initial.data,series:initial.data.series.map(s=>({...s,points:s.points.map(p=>({...p,close:100,adjusted:100}))}))}},"2026-09-17T07:00:00Z").length,0,"Flat prices are not a new high");
assert(!renderSparkline([1,null,2],"gap").includes("<polyline"));
assert(renderSparkline([0,0,0],"flat").includes("22.00"));
assert(!renderSparkline([1,2],'<script>').includes('<script>'));
assert.throws(()=>renderSparkline([NaN],"bad"));
assert(!html.includes("secret-test"));assert(!html.includes("api_token"));
assert(publishedSiteLinks(database,false,"2026-09-18T06:00:00Z",true).some(l=>l.section==="stocks"));
assert(!publishedSiteLinks(database,false,"2026-09-18T06:00:00Z",false).some(l=>l.section==="stocks"));
const payload=parseBriefingPayload({schemaVersion:2,edition:{id:"daily:2026-09-17",type:"daily",localDate:"2026-09-17",timezone:"Europe/Vilnius",generatedAt:"2026-09-17T06:00:00Z",status:"complete",retentionUntil:"2026-09-24T00:00:00Z"},
  hero:{title:"Утренний обзор"},notes:[{id:"note-1",target:"hero",text:"день начинается",role:"context",tone:"signal",rotation:"none"}],
  news:{state:"empty",items:[]},sourceBatches:[],mail:{state:"empty",items:[]},calendar:{state:"empty",events:[],allDayEvents:[]},weather:{state:"failed"},dataQuality:{state:"partial"}});
attachStocksBrief(database,payload,config,"2026-09-17T06:00:00Z");
const frozen=JSON.stringify(payload.addons.stocks);
attachStocksBrief(database,payload,config,"2026-09-18T06:00:00Z");
assert.equal(JSON.stringify(payload.addons.stocks),frozen);
assert.match(renderStocksTeaser(payload),/Открыть обзор/);
await preparePreview(payload,renderBriefingPage(payload),paths);
database.prepare("UPDATE editions SET state='complete' WHERE id=?").run(payload.edition.id);
const edition=loadEdition(database,{id:payload.edition.id})!;
const altered=structuredClone(payload);altered.addons.stocks!.capturedAt="2026-09-18T06:00:00Z";
await assert.rejects(refreshPublishedEdition(altered,renderBriefingPage(altered),edition.content_digest,paths),/frozen stocks/);

const server=await createBriefingServer(paths,{mailActionExecutor:null,stocks:true});
server.listen(Number(process.env.STOCKS_PREVIEW_PORT??0),"127.0.0.1");await once(server,"listening");
const base="http://127.0.0.1:"+(server.address() as {port:number}).port;
assert.equal((await fetch(base+"/stocks")).status,200);
const reviewAsset=initial.data.series[0]!.asset;
const reviewInput:ReviewInput={version:1,mode:"weekly",asOfDate:"2026-09-18",
  baseline:{version:1,asOfLocalDate:"2026-09-18",timezone:"Europe/Vilnius",positions:[{symbol:reviewAsset.id,isin:reviewAsset.isin,quantity:"1"}],unknowns:{currentMonthExecutedTrades:null,currentMonthNewContributionsEUR:null}},
  market:initial,fx:{date:"2026-09-16",usdPerEUR:1.1,sourceId:"test-source"},
  sources:[{id:"test-source",title:"Synthetic source",url:"https://issuer.example/report",asOfDate:"2026-09-16",retrievedAt:"2026-09-18T06:00:00Z"}],
  facts:[{id:"test-fact",symbol:reviewAsset.id,sourceId:"test-source",statement:"Synthetic fact"}]};
const reviewDraft:ReviewDraft={version:3,inputDigest:inputDigest(reviewInput),headline:"Private review sentinel",summary:["Private review sentinel"],positions:[{
  symbol:reviewAsset.id,action:"maintain",adviceReason:"Synthetic reason",blockingInfo:null,factIds:["test-fact"],rationale:"Synthetic conclusion",portfolioMeaning:"Synthetic fit",
  counterargument:"Synthetic risk",revisitWhen:"Next report",learningIds:[]}],learningNotes:[],nextSteps:[],proposedOrders:[]};
await acceptReview(resolve(paths.stateDirectory,"portfolio/reviews"),reviewInput,reviewDraft);
assert(!(await(await fetch(base+"/stocks")).text()).includes("Private review sentinel"),"Reader is opt-in even with accepted files");
const reviewServer=await createBriefingServer(paths,{mailActionExecutor:null,stocks:true,investmentReview:true});
reviewServer.listen(0,"127.0.0.1");await once(reviewServer,"listening");
const reviewBase="http://127.0.0.1:"+(reviewServer.address() as {port:number}).port;
assert((await(await fetch(reviewBase+"/ru/stocks")).text()).includes("Private review sentinel"));
const englishReview=await(await fetch(reviewBase+"/en/stocks")).text();
assert(englishReview.includes("Portfolio reviews are currently available in Russian"));
assert(!englishReview.includes("Private review sentinel"));
assert(!(await(await fetch(reviewBase+"/")).text()).includes("Private review sentinel"),"Never add to Daily");
assert.equal((await fetch(reviewBase+"/portfolio/reviews/latest-weekly.json")).status,404);
await writeFile(resolve(paths.stateDirectory,"portfolio/reviews/latest-monthly.json"),'{"id":"bad"}',{mode:0o600});
assert((await(await fetch(reviewBase+"/ru/stocks")).text()).includes("Private review sentinel"),"Bad monthly slot does not break weekly or quotes");
await new Promise<void>(resolve=>reviewServer.close(()=>resolve()));
assert.equal((await fetch(base+"/stocks?symbols=SPCX&period=1y")).status,200);
assert.equal((await fetch(base+"/stocks?symbols=UNKNOWN")).status,400);
assert.equal((await fetch(base+"/stocks/2026-09-17")).status,404);
assert.equal((await fetch(base+"/api/stocks/details?symbols=NVDA&period=3m")).status,200);
assert.equal((await fetch(base+"/api/stocks/details?symbols=UNKNOWN")).status,400);
assert.equal((await fetch(base+"/api/stocks/details?symbols=NVDA,MSFT")).status,400);
assert.equal((await fetch(base+"/api/stocks/details?symbols=NVDA&period=oops")).status,400);
const disabledServer=await createBriefingServer(paths,{mailActionExecutor:null,stocks:false});
disabledServer.listen(0,"127.0.0.1");await once(disabledServer,"listening");
assert.equal((await fetch("http://127.0.0.1:"+(disabledServer.address() as {port:number}).port+"/stocks")).status,404);
assert.equal((await fetch("http://127.0.0.1:"+(disabledServer.address() as {port:number}).port+"/api/stocks/details?symbols=NVDA")).status,404);
await new Promise<void>(resolve=>disabledServer.close(()=>resolve()));
console.log("Stocks: quota, idempotency, free-only access, identity, IPO cutoff, failure fallback, corrected returns, chart periods, cache-only routes and frozen Daily verified.");
if(process.env.STOCKS_PREVIEW_PORT)console.log("Synthetic Stocks preview: "+base+"/stocks");
else {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));database.close();}
