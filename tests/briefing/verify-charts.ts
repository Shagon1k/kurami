import assert from "node:assert/strict";
import { runInNewContext, Script } from "node:vm";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { once } from "node:events";
import { createChartEngine, renderTrendChart, renderBarChart, type ChartInput } from "../../src/briefing/ui/charts/index.ts";
import { CHART_CLIENT_SCRIPT } from "../../src/briefing/ui/charts/client.ts";
import { cinemaTrendInput } from "../../src/briefing/cinema/chart-adapter.ts";
import { BRIEFING_STYLES } from "../../src/briefing/ui/styles.ts";
import { renderThemeToggle } from "../../src/briefing/ui/components/theme-toggle.ts";
import { injectRuntime } from "../../src/briefing/server.ts";
import { createBriefingServer, type MailActionExecutor } from "../../src/briefing/server.ts";
import { briefingPaths } from "../../src/briefing/store.ts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

const engine=createChartEngine();
const trend:ChartInput={
 id:"trend-demo",title:"Динамика · TrendChart",description:"Синтетические данные: один общий компонент для разных сценариев",
 xLabel:"Неделя",yLabel:"Сборы, USD",unit:{kind:"currency",currency:"USD"},
 categories:Array.from({length:6},(_,i)=>({key:"week-"+i,label:"Неделя "+(i+1),shortLabel:String(i+1)})),
 series:[
 {id:"alpha",label:"Первый фильм",values:[180e6,80e6,40e6,25e6,18e6,15e6]},
 {id:"beta",label:"Второй фильм",values:[35e6,30e6,25e6,20e6,17e6,12e6]},
 {id:"debut",label:"Новинка без истории",values:[null,null,null,null,null,14e6]},
 ]};
const values=[0,0,2,0,1,3,1,23,37,41,52,16,47];
const bar:ChartInput={
 id:"bar-demo",title:"По периодам · BarChart",description:"Пример на числах из референса; не реальные данные Daily",
 xLabel:"Начало недели",yLabel:"Значение",unit:{kind:"number"},
 categories:values.map((_,i)=>{
   const at=new Date(Date.UTC(2026,4,29+i*7));
   return {key:at.toISOString().slice(0,10),label:at.toLocaleDateString("ru-RU",{timeZone:"UTC",day:"numeric",month:"long"}),
     shortLabel:at.toLocaleDateString("ru-RU",{timeZone:"UTC",day:"2-digit",month:"2-digit"}),partial:i===values.length-1};
 }),series:[{id:"weekly",label:"За 7 дней",values}]};
const spec=engine.parse({...trend,version:1,kind:"trend"});
const baseline=engine.layout(spec);
assert.equal(baseline.series[2]!.points.length,1);
assert.equal(baseline.series[2]!.segments.length,1);
assert.equal(baseline.series[2]!.segments[0]!.length,1);
for(const tick of baseline.ticks) {
 const expected=baseline.plot.bottom-(tick.value-baseline.minimum)/(baseline.maximum-baseline.minimum)*(baseline.plot.bottom-baseline.plot.top);
 assert(Math.abs(tick.y-expected)<1e-8);
}
const browserEngine=runInNewContext("("+createChartEngine.toString()+")()") as ReturnType<typeof createChartEngine>;
assert.equal(JSON.stringify(browserEngine.layout(spec)),JSON.stringify(baseline),"SSR and browser must use identical geometry");
new Script(CHART_CLIENT_SCRIPT);
assert.equal(engine.layout(spec,{visible:[1]}).maximum<baseline.maximum,true);
assert.equal(engine.layout(spec,{windowSize:3}).start,3);
assert.equal(engine.layout(spec,{visible:[]}).empty,true);
const gap=engine.parse({...trend,version:1,kind:"trend",series:[{id:"gap",label:"Разрыв",values:[1,null,3,4,null,6]}]});
assert.deepEqual(engine.layout(gap).series[0]!.segments.map(segment=>segment.length),[1,2,1]);
for(const [name,points] of [["zero",[0,0,0]],["negative",[-3,-1,-2]],["mixed",[-5,0,5]],["flat",[7,7,7]],["missing",[null,null,null]]] as const) {
 const fixture=engine.parse({...bar,version:1,kind:"bar",id:name,categories:bar.categories.slice(0,3),series:[{id:"s",label:name,values:[...points]}]});
 const layout=engine.layout(fixture);
 assert.equal(layout.empty,name==="missing");
 assert(Number.isFinite(layout.baseline));
 assert(layout.minimum<=0 && layout.maximum>=0);
 for(const series of layout.series)for(const point of series.points)assert(Number.isFinite(point.x)&&Number.isFinite(point.y));
 assert(!renderBarChart({...fixture}).includes("NaN"));
}
const single=engine.parse({...trend,version:1,kind:"trend",categories:[trend.categories[0]!],series:[{id:"s",label:"Одна точка",values:[1]}]});
const point=engine.layout(single).series[0]!.points[0]!;
assert.equal(point.x,(baseline.plot.left+baseline.plot.right)/2);
assert.equal(engine.layout(engine.parse({...trend,version:1,kind:"trend",categories:[],series:[]})).empty,true);
const partialHtml=renderBarChart(bar);
assert.match(partialHtml,/chart__point--partial/);
assert.match(partialHtml,/Неполный период/);
assert.match(partialHtml,/>0<\/text>/);
assert.match(partialHtml,/Данные таблицей/);
assert.match(partialHtml,/tabindex="0"/);
assert.equal((partialHtml.match(/tabindex="0"/g)??[]).length,1,"one roving chart focus entry");
assert.match(engine.format(144343678,{kind:"currency",currency:"USD"}),/144.*343.*678/);
assert.match(engine.format(-12.5,{kind:"percent"}),/-12,5%/);
assert.match(engine.format(1e-12,{kind:"number"}),/E-12/);
assert.match(renderBarChart({...bar,state:"unavailable",message:"Источник недоступен"}),/Источник недоступен/);
const escaped=renderTrendChart({...trend,title:'<script>alert("x")</script>',series:[{...trend.series[0]!,label:"<img src=x>"}]});
assert(!escaped.includes("<script>"));
assert(escaped.includes("&lt;script&gt;"));
for(const change of [
 {series:[{id:"s",label:"s",values:[1]}]},
 {unit:{kind:"currency",currency:"DOLLARS"}},
 {categories:[trend.categories[0],trend.categories[0]]},
 {series:[{id:"s",label:"s",values:[1,2,3,4,5,Infinity]}]},
 {series:[{id:"s",label:"s",values:Array(6)}]},
 {series:Array(1)},
])assert.throws(()=>engine.parse({...spec,...change}));
assert.throws(()=>engine.parse({...spec,kind:"bar"}),/one series/);
assert.throws(()=>engine.parse({...spec,kind:"bar",baseline:"auto",series:[spec.series[0]!]}),/zero baseline/);
const adapted=cinemaTrendInput([
 {id:"a",label:"A",currency:"USD",points:[{at:"2026-08-01",label:"01.08",gross:10},{at:"2026-08-15",label:"15.08",gross:5}]},
 {id:"b",label:"B",currency:"USD",points:[{at:"2026-08-08",label:"08.08",gross:3}]},
]);
assert.deepEqual(adapted.series.map(series=>series.values),[[10,null,5],[null,3,null]]);
assert.equal(cinemaTrendInput([
 {id:"a",label:"A",currency:"USD",points:[]},{id:"b",label:"B",currency:"EUR",points:[]},
]).state,"unavailable");

if(process.env.CHARTS_PREVIEW_PORT) {
 // Reuse the real application runtime asset, without any production database.
 const home=await mkdtemp(resolve(tmpdir(),"kurami-charts-"));
 const paths=briefingPaths({KURAMI_HOME:home,BRIEFING_MIGRATIONS_DIR:resolve(import.meta.dirname,"../../migrations/briefing")});
 const app=await createBriefingServer(paths,{mailActionExecutor:null as MailActionExecutor|null});
 app.listen(0,"127.0.0.1");await once(app,"listening");
 const appPort=(app.address() as {port:number}).port;
 const empty=renderTrendChart({...trend,id:"empty-demo",title:"Нет данных",categories:[],series:[]});
 const signed=renderBarChart({...bar,id:"signed-demo",title:"Отрицательные значения",categories:bar.categories.slice(0,3),series:[{id:"delta",label:"Изменение",values:[-5,0,8]}]});
 const html=injectRuntime(`<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Charts · Kurami</title><link href="https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet"><style>${BRIEFING_STYLES}</style></head><body><header class="utility-header"><div class="utility-header__inner page-shell"><strong>Charts · проверка компонентов</strong>${renderThemeToggle()}</div></header><main class="page-shell" style="padding-top:100px"><h1>Графики Kurami</h1><p>Тестовая страница. Все значения демонстрационные.</p>${renderTrendChart(trend)}${renderBarChart(bar)}${signed}${empty}</main></body></html>`);
 const server=createServer(async(req,res)=>{
  if(req.url==="/assets/briefing.js"){const response=await fetch("http://127.0.0.1:"+appPort+req.url);res.setHeader("content-type","text/javascript");res.end(await response.text());return;}
  if(req.url==="/favicon.svg"){res.setHeader("content-type","image/svg+xml");res.end(await readFile(resolve(import.meta.dirname,"../../integrations/hermes/skills/kurami-ui-preview-language/assets/kurami-favicon.svg")));return;}
  res.setHeader("content-type","text/html; charset=utf-8");res.end(html);
 });
 server.listen(Number(process.env.CHARTS_PREVIEW_PORT),"127.0.0.1");await once(server,"listening");
 console.log(JSON.stringify({preview:"http://127.0.0.1:"+process.env.CHARTS_PREVIEW_PORT}));
}
console.log("shared charts: geometry parity, gaps, zeros, signed values, partial periods and safe contracts verified");
