import {renderToastRegion} from "../ui-library/components/toast.ts";
import {escapeHtml} from "../ui-library/foundations/html.ts";
import {formatSiteDate} from "../ui-library/foundations/date.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderSiteFooter} from "../ui-library/patterns/site-footer.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {kuramiSites,kuramiEntryHref} from "../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderButton,renderLinkButton} from "../ui-library/components/button.ts";
import {renderPeriodSwitch} from "../ui-library/components/period-switch.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {renderDialog,renderDialogActions} from "../ui-library/components/dialog.ts";
import {renderPopover} from "../ui-library/components/popover.ts";
import {compactNumber,estimatedUsd} from "./format.ts";
import {HUB_CSS_URL,HUB_CLIENT_URL} from "./assets.ts";
import {API_RATE_DATE,API_RATE_SOURCE,type ModelUsage,type ApiEquivalent} from "../core/api-equivalent.ts";
import {renderBarChart} from "../ui-library/components/charts/index.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderStatCard,renderMeter,renderGauge,type StatTone} from "../ui-library/components/stat-card.ts";
import {FIGURE_ATTRIBUTE,surfaceAttributes,LIVE_ATTRIBUTE} from "../ui-library/components/surface.ts";
import {renderIcon,iconPath,type IconName} from "../ui-library/components/icon.ts";
import {renderCheckbox,renderSelectField} from "../ui-library/components/form.ts";
import {problemQueue,workFeed} from "./work-feed.ts";
import type {ProblemNext} from "./operations.ts";
import type {CodexLimit,CodexSnapshot} from "./codex.ts";
import type {HubProject,HubSnapshot} from "./snapshot.ts";
import type {UsagePeriod} from "../orchestrator/projects/usage-read-model.ts";

export type HubLanguage="ru"|"en";
const tr=(lang:HubLanguage,ru:string,en:string)=>lang==="ru"?ru:en;
const value=(amount:number|null|undefined,lang:HubLanguage)=>amount==null?"—":new Intl.NumberFormat(lang==="ru"?"ru-RU":"en-US").format(amount);

function formatTime(iso:string|null,lang:HubLanguage):string {
  if(!iso)return "—";
  const date=new Date(iso);
  if(!Number.isFinite(date.getTime()))return "—";
  return formatSiteDate(iso,lang,true);
}

function metric(label:string,amount:number|string,attention=false,full?:string,options:{tone?:StatTone;icon?:IconName;plain?:boolean}={}):string {
  return renderStatCard({label,value:String(amount),full,tone:options.tone??(attention?"failure":"neutral"),icon:options.icon,plain:options.plain});
}

function limitLabel(limit:CodexLimit,lang:HubLanguage):string {
  if(limit.windowMinutes===300)return tr(lang,"5 часов","5 hours");
  if(limit.windowMinutes===10080)return tr(lang,"7 дней","7 days");
  if(limit.windowMinutes%1440===0)return `${limit.windowMinutes/1440} ${tr(lang,"дн.","days")}`;
  if(limit.windowMinutes%60===0)return `${limit.windowMinutes/60} ${tr(lang,"ч.","hours")}`;
  return `${limit.windowMinutes} ${tr(lang,"мин.","min")}`;
}

/** When the limit runs out at the pace of the current window, if that comes before the reset. Needs a tenth of
 * the window (at least an hour) behind it, so a burst right after a reset does not predict anything. */
export function limitRunsOutAt(limit:CodexLimit):string|null {
  const observed=Date.parse(limit.observedAt),resets=Date.parse(limit.resetsAt),window=limit.windowMinutes*60_000;
  const elapsed=observed-(resets-window);
  if(!Number.isFinite(elapsed)||elapsed<Math.max(window/10,3_600_000)||limit.usedPercent<=0||limit.remainingPercent<=0)return null;
  const runsOut=observed+limit.remainingPercent*elapsed/limit.usedPercent;
  return runsOut<resets?new Date(runsOut).toISOString():null;
}

function renderLimit(limit:CodexLimit,lang:HubLanguage):string {
  const used=Math.round(limit.usedPercent);
  const left=Math.round(limit.remainingPercent);
  const label=limitLabel(limit,lang);
  const tone=limit.remainingPercent<=0?"failure":limit.remainingPercent<=20?"warning":"neutral";
  const note=tone==="failure"?tr(lang,"Лимит исчерпан","Limit exhausted"):tone==="warning"?tr(lang,"Мало остатка","Low remaining quota"):"";
  const runsOut=limitRunsOutAt(limit);
  const forecast=runsOut?`<p class="limit__forecast">${renderIcon("clock")}<span>${tr(lang,`В этом темпе закончится ${escapeHtml(formatTime(runsOut,lang))}, до сброса`,`At this pace it runs out ${escapeHtml(formatTime(runsOut,lang))}, before the reset`)}</span></p>`:"";
  return `<article class="limit" data-tone="${tone}"><div class="limit__head"><span>${escapeHtml(label)}</span><strong${FIGURE_ATTRIBUTE}>${left}% ${tr(lang,"осталось","left")}</strong></div><div class="limit__track" role="progressbar" aria-label="${escapeHtml(label)}: ${tr(lang,"использовано","used")} ${used}%" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="100"><span style="--used:${used}%"></span></div><div class="limit__meta"><span>${used}% ${tr(lang,"использовано","used")}${note?` · ${note}`:""}</span><span>${tr(lang,"Сброс","Resets")} ${escapeHtml(formatTime(limit.resetsAt,lang))}</span></div>${forecast}</article>`;
}


type Period=7|30;
const daysLabel=(days:Period,lang:HubLanguage)=>`${days} ${tr(lang,"дней","days")}`;
const periodPanel=(key:string,days:Period,body:string)=>`<div data-period-panel="${key}" data-period-days="${days}"${days===7?" hidden":""}>${body}</div>`;
const periods=(key:string,body:(days:Period)=>string)=>([7,30] as const).map(days=>periodPanel(key,days,body(days))).join("");
const periodSwitch=(key:string,lang:HubLanguage,label:string)=>renderPeriodSwitch({key,lang,label:`${label} · ${tr(lang,"период","period")}`,floating:true,cycle:true,mobileSettings:true});

function renderLimitHistory(codex:CodexSnapshot,lang:HubLanguage):string {
  const current=codex.account?.state==="live"?codex.account.limits:codex.limits;
  const windows=[...new Set(current.map(limit=>limit.windowMinutes))].sort((a,b)=>a-b);
  const windowLabel=(minutes:number)=>minutes%1440===0?`${minutes/1440}d`:minutes%60===0?`${minutes/60}h`:`${minutes}m`;
  const chart=periods("limits",days=>{
    const selected=codex.limitUsage?.slice(-days)??[];
    if(!selected.some(day=>windows.some(window=>day.windows[window]!==undefined)))return `<p class="empty-value">${tr(lang,"Нет наблюдений","No observations")}</p>`;
    return renderBarChart({id:`hub-limits-${days}`,title:tr(lang,"Наблюдаемый расход лимита за день","Observed daily limit usage")+" · "+daysLabel(days,lang),
      xLabel:tr(lang,"Дата","Date"),yLabel:tr(lang,"Расход / день · %","Daily usage · %"),unit:{kind:"percent"},minimumMaximum:100,
      categories:selected.map(day=>({key:day.date,label:day.date,shortLabel:day.date.slice(5)})),
      series:windows.map((window,index)=>({id:`window-${window}`,label:windowLabel(window),color:index===0?4:3,
        values:selected.map(day=>day.windows[window]??null),partial:selected.map(day=>Boolean(day.partial[window]))})),
      display:{variant:"embedded",density:"compact",header:false,legend:"hidden",zoom:false,values:false,table:"screen-reader"},
    },lang);
  });
  const explanation=tr(lang,"Наблюдаемый прирост использованного лимита за день. После сброса новый расход прибавляется. * — неполные наблюдения: начало дня, пропуски или сброс. Это единица активности, не деньги и не доля токенов.","Observed daily increase in used limit. Usage after a reset is added. * marks partial observations: day boundaries, gaps or resets. This is an activity unit, not spending or token share.");
  return `<div class="limit-history"><div class="panel-heading"><span title="${explanation}" tabindex="0">${tr(lang,"Расход / день · %","Daily usage · %")}</span></div>${chart}<div class="limit-history__legend">${windows.map((window,index)=>`<span data-series="${index%2}">${windowLabel(window)}</span>`).join("")}</div></div>`;
}


function renderCodex(codex:CodexSnapshot,lang:HubLanguage):string {
  const limits=codex.limits.length?codex.limits.map(limit=>renderLimit(limit,lang)).join(""):`<p class="empty-value">${tr(lang,"Лимиты","Limits")} —</p>`;
  const stats=(days:Period)=>codex.periods?.[days]??{tokens:days===7?codex.tokens7:codex.tokens30,cached:days===30?codex.cached30:null,output:days===30?codex.output30:null,sessions:days===30?codex.sessions30:null,models:days===30?codex.models:[]};
  const tokens=periods("tokens",days=>{
    const selected=stats(days);
    const equivalent=codex.periods?.[days].equivalent;
    const partial=equivalent?.unpricedTokens||codex.coverage!=="complete";
    const priceLabel=tr(lang,"API-экв.","API eq")+(partial?tr(lang," · частично"," · partial"):"");
    const description=tr(lang,"Оценка в USD по текущим Standard-тарифам API, не счёт подписки. Без стоимости инструментов и региональных надбавок.","Estimated USD at current Standard API rates, not subscription spending. Excludes tool charges and regional uplifts.");
    const quality=equivalent?`${tr(lang,"Токены с тарифом","Priced tokens")}: ${value(equivalent.pricedTokens,lang)}; ${tr(lang,"неопределённые параметры кэша/контекста","uncertain cache/context parameters")}: ${value(equivalent.uncertainTokens,lang)}`:"";
    return `<div class="token-totals">${metric(daysLabel(days,lang),compactNumber(selected.tokens),false,value(selected.tokens,lang),{tone:"accent",plain:true})}<div class="token-cost" title="${escapeHtml(description+" "+quality)}" tabindex="0"><span>${priceLabel}</span><strong${FIGURE_ATTRIBUTE}>${estimatedUsd(equivalent?.usd)}</strong></div></div><dl class="stat-list token-breakdown"><div><dt>${tr(lang,"Кэшированный вход","Cached input")}</dt><dd title="${escapeHtml(value(selected.cached,lang))}" tabindex="0">${compactNumber(selected.cached)}</dd></div><div><dt>${tr(lang,"Сгенерировано","Output")}</dt><dd title="${escapeHtml(value(selected.output,lang))}" tabindex="0">${compactNumber(selected.output)}</dd></div></dl>`;
  });
  const models=periods("models",days=>{
    const selected=stats(days);
    const usage=codex.periods?.[days].modelUsage?.filter(model=>model.name!=="codex-auto-review");
    if(usage?.length){
      const numberCell=(amount:number|null)=>({html:`<span title="${escapeHtml(value(amount,lang))}" tabindex="0">${compactNumber(amount)}</span>`});
      const costCell=(equivalent:ApiEquivalent)=>({html:`<span title="${escapeHtml(tr(lang,"Токены без тарифа","Unpriced tokens"))}: ${value(equivalent.unpricedTokens,lang)}; ${escapeHtml(tr(lang,"Нет параметров кэша/контекста","Missing cache/context parameters"))}: ${value(equivalent.uncertainTokens,lang)}" tabindex="0">${estimatedUsd(equivalent.usd)}${equivalent.unpricedTokens?" *":""}</span>`});
      const modelName=(model:ModelUsage)=>model.name==="unknown"?tr(lang,"Неизвестна","Unknown"):model.name;
      const total=usage.reduce((sum,model)=>sum+model.tokens,0);
      const primaryRows=(items:ModelUsage[])=>items.map(model=>[{html:`<span class="model-name">${escapeHtml(modelName(model))}</span><span class="model-share" aria-hidden="true"><span style="--share:${total?100*model.tokens/total:0}%"></span></span>`},numberCell(model.tokens),costCell(model.equivalent)]);
      const primary=renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Токены","Tokens"),"API eq"],rows:primaryRows(usage.slice(0,4)),rowHeaders:true,numeric:true,className:"model-table"});
      const rest=usage.length>4?renderDisclosure({summary:tr(lang,`Ещё ${usage.length-4}`,`${usage.length-4} more`),key:`models-more:${days}`,body:renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Токены","Tokens"),"API eq"],rows:primaryRows(usage.slice(4)),rowHeaders:true,numeric:true,className:"model-table"})}):"";
      const detail=renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Сессии","Sessions"),tr(lang,"Вход","Input"),tr(lang,"Кэш · чтение","Cache · read"),tr(lang,"Кэш · запись","Cache · write"),tr(lang,"Выход","Output")],rows:usage.map(model=>[modelName(model),value(model.sessions,lang),numberCell(model.input),numberCell(model.cached),numberCell(model.cacheWrite),numberCell(model.output)]),rowHeaders:true,numeric:true,className:"model-detail-table"});
      const source=`<p class="api-rates"><a href="${API_RATE_SOURCE}" target="_blank" rel="noopener noreferrer">Standard · ${API_RATE_DATE}</a></p>`;
      return primary+rest+renderDisclosure({summary:tr(lang,"Разбивка по моделям","Model breakdown"),key:`models-breakdown:${days}`,className:"model-breakdown",body:detail+source});
    }
    const visible=selected.models.filter(model=>model.name!=="codex-auto-review");
    return visible.length?renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Сессий","Sessions")],rows:visible.map(model=>[model.name,value(model.sessions,lang)]),rowHeaders:true,numeric:true,className:"model-table"}):`<p class="empty-value">${tr(lang,"Модели","Models")} —</p>`;
  });
  const timestamp=codex.account?.observedAt??codex.limits[0]?.observedAt??codex.updatedAt;
  const coverage=codex.coverage==="partial"?tr(lang,"Частичные логи","Partial logs"):tr(lang,"Локальные логи","Local logs");
  return `<section class="section" aria-labelledby="codex-title"><div class="section-heading"><h2 id="codex-title">Codex</h2><span>${coverage} · ${escapeHtml(formatTime(timestamp,lang))}</span></div>
    <div class="codex-grid"><div class="hub-panel tokens"${surfaceAttributes("panel")}><div class="panel-heading"><h3>${renderIcon("tokens")}${tr(lang,"Токены","Tokens")}</h3></div>${tokens}</div>
    <div class="hub-panel limits"${surfaceAttributes("panel")}><h3>${tr(lang,"Лимиты","Limits")} <span class="panel-status">${codex.account?.state==="live"?"Live":tr(lang,"Локальный снимок","Local snapshot")}</span></h3>${limits}<div class="reset-control"><span>${tr(lang,"Доступные сбросы","Available resets")} <strong>${value(codex.account?.resetCredits,lang)}</strong></span>${renderButton({label:tr(lang,"Сбросить","Reset"),variant:"warning",size:"compact",disabled:codex.account?.state!=="live"||!(codex.account.resetCredits!>0),attributes:{"data-hub-control":"codex-reset"}})}</div>${renderLimitHistory(codex,lang)}</div>
    <div class="hub-panel models"${surfaceAttributes("panel")}><div class="panel-heading"><h3>${tr(lang,"Модели","Models")}</h3></div>${models}</div></div></section>`;
}
const alertLabels:Record<string,[string,string]>={health_stale:["Данные устарели","Stale data"],health_unavailable:["Нет данных","Unavailable"],health_issue:["System Health","System Health"],run_attention:["Сбой задачи","Task failure"],owner_input:["Нужен ответ","Input needed"],ci_unrepaired:["CI без ремонта","CI needs repair"],review_unrepaired:["Review без ремонта","Review needs repair"],poll_stale:["Снимок устарел","Stale snapshot"],controller_stuck:["Контроллер застрял","Controller stuck"],release_drift:["Выкладка","Release"],orchestrator_unavailable:["Нет данных","Unavailable"]};
const eventLabels:Record<string,[string,string]>={session_started:["Новая сессия","Session started"],starting:["Запуск задачи","Task starting"],running:["В работе","Running"],waiting_human:["Ожидает ответа","Waiting for input"],needs_attention:["Требует внимания","Needs attention"],parked_review:["Human Review","Human Review"],handoff_pending:["Передача","Handoff"],remote_owned:["Remote","Remote"],cancelled:["Отменено","Cancelled"],archived:["Архивировано","Archived"],passed:["Успешно","Passed"],failed:["Сбой","Failed"],pending:["Проверяется","Pending"],ready:["Готово","Ready"],created:["Начат сбор","Collection started"],"live-collected":["Источники собраны","Sources collected"],editorialized:["Текст подготовлен","Editorial ready"],published:["Опубликовано","Published"],notified:["Доставлено","Delivered"]};
Object.assign(eventLabels,{task_started:["Начат ход","Turn started"],task_complete:["Ход завершён","Turn completed"],turn_aborted:["Ход прерван","Turn interrupted"],collect_started:["Сбор источников","Collecting sources"],collect_completed:["Источники собраны","Sources collected"],collect_failed:["Сбой сбора","Collection failed"],compose_started:["Подготовка выпуска","Composing edition"],compose_completed:["Выпуск подготовлен","Edition composed"],compose_failed:["Сбой подготовки","Composition failed"],promote_started:["Публикация","Publishing"],promote_completed:["Опубликовано","Published"],promote_failed:["Сбой публикации","Publication failed"],prepare_started:["Подготовка превью","Preparing preview"],prepare_completed:["Превью готово","Preview ready"]});
function label(map:Record<string,[string,string]>,code:string,lang:HubLanguage):string {const pair=map[code];return pair?tr(lang,...pair):code.replaceAll("_"," ").replaceAll("-"," ");}

function renderAlerts(snapshot:HubSnapshot,lang:HubLanguage):string {
  const queue=problemQueue(snapshot.operations?.alerts??[]);if(!queue.length)return "";
  const next:Record<ProblemNext,[string,string]>={start_repair:["Запустить исправление через карточку задачи","Start repair from the task card"],wait_repair:["Дождаться текущего исправления","Wait for the current repair"],reply:["Ответить в сессии задачи","Reply in the task session"],inspect_task:["Проверить сбой в карточке задачи","Inspect failure in the task card"],check_collector:["Проверить сборщик System Health","Check the System Health collector"],check_project:["Проверить опрос проекта","Check the project poller"],inspect_health:["Проверить состояние сервера","Inspect server health"],restore_db:["Проверить доступность базы оркестратора","Check the orchestrator database"],release:["Выложить изменения","Release the changes"]};
  const rows=queue.map(problem=>{
    const pr=problem.href?.match(/\/pull\/(\d+)/)?.[1];
    const subject=problem.project?`${projectName(snapshot,problem.project)} · ${pr?`PR #${pr}`:problem.subject.match(/#\d+/)?.[0]??""}`:problem.subject;
    const reasons=problem.issues.map(issue=>`<span>${renderIcon(issue.code==="ci_unrepaired"||issue.code==="controller_stuck"?"controls":issue.code==="review_unrepaired"?"review":"alert",{tile:true})}<span>${escapeHtml(label(alertLabels,issue.code,lang))}${issue.code==="review_unrepaired"&&issue.detail?` · ${escapeHtml(issue.detail)} ${tr(lang,"существенных замечаний","major findings")}`:(issue.code==="ci_unrepaired"||issue.code==="controller_stuck")&&issue.detail?` · ${escapeHtml(issue.detail)}`:issue.code==="health_issue"?` · ${escapeHtml(issue.subject)}`:issue.texts?` · ${escapeHtml(tr(lang,issue.texts.ru,issue.texts.en))}`:""}</span></span>`).join("");
    const actor=problem.actor==="owner"?tr(lang,"Владелец","Owner"):problem.actor==="agent"?"Codex":"Kurami";
    const linkLabel=pr?tr(lang,"Открыть PR","Open PR"):problem.task?tr(lang,"Открыть задачу","Open task"):tr(lang,"Открыть проект","Open project");
    const taskHref=problem.task&&problem.project&&problem.itemId?`${kuramiEntryHref("projects",lang)}?project=${encodeURIComponent(problem.project)}&item=${encodeURIComponent(problem.itemId)}`:undefined;
    const links=(taskHref?renderLinkButton({label:tr(lang,"Открыть задачу","Open task"),href:taskHref,variant:"subtle",size:"compact"}):"")+(problem.href?renderLinkButton({label:taskHref&&pr?`PR #${pr}`:linkLabel,href:problem.href,variant:taskHref?"quiet":"subtle",size:"compact",iconPath:iconPath("arrow")}):"");
    return `<li class="problem" data-severity="${problem.severity}"><div class="problem__main"><strong>${escapeHtml(subject)}${problem.title?` · ${escapeHtml(problem.title)}`:""}</strong><div class="problem__reasons">${reasons}</div><p class="problem__next">${renderIcon(problem.actor==="owner"?"person":problem.actor==="agent"?"bot":"clock")}<span>${actor} · ${escapeHtml(tr(lang,...next[problem.next]))}</span></p></div>${links?`<div class="problem__links">${links}</div>`:""}</li>`;
  });
  const tasks=queue.every(problem=>problem.task);
  const plural=(n:number,forms:[string,string,string])=>forms[n%100>=11&&n%100<=14?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];
  const objects=tr(lang,plural(queue.length,tasks?["задача","задачи","задач"]:["объект","объекта","объектов"]),tasks?(queue.length===1?"task":"tasks"):(queue.length===1?"object":"objects"));
  const issues=queue.reduce((sum,problem)=>sum+problem.issues.length,0);
  return `<section class="hub-alerts"${surfaceAttributes("lead",{attention:true})} aria-labelledby="alerts-title"><div class="section-heading"><h2 id="alerts-title">${renderIcon("alert")}${tr(lang,"Требует внимания","Alerts")}</h2><span>${queue.length} ${objects} · ${issues} ${tr(lang,plural(issues,["проблема","проблемы","проблем"]),issues===1?"issue":"issues")}</span></div><ul class="alert-list list-reset">${rows.slice(0,4).join("")}</ul>${rows.length>4?renderDisclosure({summary:tr(lang,`Ещё ${rows.length-4}`,`${rows.length-4} more`),key:"alerts-more",body:`<ul class="alert-list list-reset">${rows.slice(4).join("")}</ul>`}):""}</section>`;
}
/** Managed projects are named by the registry (via the snapshot); Kurami's own areas have fixed names. */
const projectName=(snapshot:HubSnapshot,key:string)=>snapshot.projects.find(project=>project.key===key)?.name??({kurami:"Kurami",digest:"Digest",other:"—"} as Record<string,string>)[key]??key;
function renderHealth(snapshot:HubSnapshot,lang:HubLanguage):string {
  const health=snapshot.operations?.health;
  const systemHeading=`<div class="section-heading"><h2 id="health-title">System Health</h2><span>${health?escapeHtml(formatTime(health.checkedAt,lang)):"—"}${snapshot.operations?.healthStale?` · ${tr(lang,"устарело","stale")}`:""}</span></div>`;
  if(!health)return `<section class="section" aria-labelledby="health-title">${systemHeading}<div class="metric-grid">${["CPU","RAM",tr(lang,"Сеть","Network"),tr(lang,"Диск","Disk")].map(name=>metric(name,"—")).join("")}</div><div class="hub-panel orchestrator-state"${surfaceAttributes("panel")}><h3>${tr(lang,"Project Orchestrator · состояние","Project Orchestrator · state")}</h3><p class="empty-value">—</p></div></section>`;
  const server=health.server;const state=health.orchestrator;
  const network=health.network.status==="offline"?tr(lang,"Нет связи","Offline"):health.network.latencyMs==null?"—":health.network.latencyMs+" ms";
  const cells:{label:string;amount:string;detail:string;icon:IconName;tone:string}[]=[
    {label:tr(lang,"База данных","State DB"),amount:state.database==="ok"?"OK":state.database,detail:"",icon:"database",tone:state.database==="ok"?"success":"failure"},
    {label:"Docker",amount:value(state.containers.running,lang),detail:`${state.containers.unhealthy} ${tr(lang,"сбоев","unhealthy")} · ${state.containers.total} ${tr(lang,"всего","total")}`,icon:"box",tone:state.containers.unhealthy?"failure":"accent"},
    {label:tr(lang,"Превью","Previews"),amount:value(state.previews,lang),detail:"",icon:"work",tone:"accent"},
    {label:"Worktrees",amount:value(state.worktrees,lang),detail:`${tr(lang,"лимит","limit")} ${state.worktreeLimit}`,icon:"branch",tone:state.worktrees>=state.worktreeLimit?"warning":"accent"},
    {label:tr(lang,"Карантин","Quarantine"),amount:value(state.quarantined,lang),detail:"",icon:"alert",tone:state.quarantined?"warning":"neutral"},
    {label:"Backup",amount:state.backupAgeHours==null?"—":`${state.backupAgeHours}h`,detail:`${tr(lang,"максимум","maximum")} ${state.backupMaxAgeHours}h`,icon:"history",tone:state.backupFresh?"success":"warning"}];
  const details=[`${server.cpuCores} cores · avg ${health.cpuStatistics.averagePercent??"—"}% · peak ${health.cpuStatistics.peakPercent??"—"}%`,
    `${server.memoryUsedGiB}/${server.memoryTotalGiB} GiB`,health.speed?`${Math.round(health.speed.downloadMbps)}↓ / ${Math.round(health.speed.uploadMbps)}↑ Mbps · ${formatTime(health.speed.checkedAt,lang)}`:health.network.status,
    `${health.disk.availableGiB} GiB ${tr(lang,"свободно","free")}${health.diskForecast?` · ${tr(lang,`${health.diskForecast.thresholdPercent}% через ≈${health.diskForecast.days} дн.`,`${health.diskForecast.thresholdPercent}% in ≈${health.diskForecast.days} d`)}`:""}`];
  const keys=["server:cpu","server:memory","network","disk"];
  const icons:IconName[]=["cpu","ram","network","disk"];
  const amounts=[server.cpuUsedPercent,server.memoryUsedPercent,null,health.disk.usedPercent];
  return `<section class="section" aria-labelledby="health-title">${systemHeading}<div class="metric-grid health-metrics">${[["CPU",`${server.cpuUsedPercent}%`],["RAM",`${server.memoryUsedPercent}%`],[tr(lang,"Сеть","Network"),network],[tr(lang,"Диск","Disk"),`${health.disk.usedPercent}%`]].map(([name,amount],index)=>{
    const issue=health.issues.find(issue=>issue.key.includes(keys[index]!));
    const tone:StatTone=issue?.severity==="critical"?"failure":issue?.severity==="warning"?"warning":"accent";
    const stat=metric(name!,amount!,false,undefined,{plain:true,tone,icon:icons[index]});
    return `<div class="health-cell"${surfaceAttributes("panel")}>${amounts[index]!==null?renderGauge({stat,meter:renderMeter({value:Math.min(100,Math.max(0,amounts[index]!)),label:name!,tone})}):`${stat}<div class="network-state">${escapeHtml(health.network.status)}</div>`}<p class="health-detail">${escapeHtml(details[index]!)}</p></div>`;
  }).join("")}</div>
    <div class="hub-panel orchestrator-state"${surfaceAttributes("panel")}><h3>${renderIcon("controls")}Project Orchestrator</h3><dl class="orchestrator-grid">${cells.map(cell=>`<div data-tone="${cell.tone}" data-metric="orchestrator:${escapeHtml(cell.icon)}"><dt>${renderIcon(cell.icon)}${escapeHtml(cell.label)}</dt><dd><strong${FIGURE_ATTRIBUTE}>${escapeHtml(cell.amount)}</strong>${cell.detail?`<span>${escapeHtml(cell.detail)}</span>`:""}</dd></div>`).join("")}</dl></div></section>`;
}
function renderActivity(snapshot:HubSnapshot,lang:HubLanguage):string {
  const activity=workFeed(snapshot.operations?.activity??[]);
  const relative=(at:string)=>{
    const seconds=Math.max(0,Math.floor((Date.parse(snapshot.generatedAt)-Date.parse(at))/1000));
    const [divisor,unit]=seconds>=86400?[86400,"day"]:seconds>=3600?[3600,"hour"]:[60,"minute"];
    return new Intl.RelativeTimeFormat(lang==="ru"?"ru":"en",{numeric:"auto"}).format(-Math.floor(seconds/Number(divisor)),unit as Intl.RelativeTimeFormatUnit);
  };
  const result=(raw:string|undefined)=>{
    if(!raw)return "";
    if(raw.startsWith("CI:"))return "CI · "+label(eventLabels,raw.slice(3),lang);
    if(raw==="Review:outdated")return tr(lang,"Review · другой коммит","Review · different commit");
    if(raw.startsWith("Review:"))return `Review · ${raw.slice(7)} ${tr(lang,"существенных замечаний","major findings")}`;
    return raw;
  };
  const rows=activity.map((item,index)=>{
    const sessionId=item.events.find(event=>event.sessionId)?.sessionId;
    const subject=item.subject.trim()||(sessionId?`${tr(lang,"Сессия без названия","Untitled session")} · ${sessionId.slice(0,8)}`:`${item.agent} · ${label(eventLabels,item.event,lang)}`);
    const eventRow=(event:typeof item.summaryEvents[number])=>`<li><time datetime="${escapeHtml(event.at)}">${escapeHtml(formatTime(event.at,lang))}</time><span>${escapeHtml(event.source)} · ${escapeHtml(label(eventLabels,event.event,lang))}${event.durationSeconds!==undefined?` · ${Math.floor(event.durationSeconds/60)}m ${event.durationSeconds%60}s`:""}${event.result?` · ${escapeHtml(result(event.result))}`:""}${event.head?` · <code>${escapeHtml(event.head.slice(0,12))}</code>`:""}</span></li>`;
    const raw=renderDisclosure({summary:tr(lang,"Все технические события","Raw events"),key:`${item.id}:raw`,variant:"inline",body:`<ol class="work-event-list list-reset">${item.events.map(eventRow).join("")}</ol>`});
    const detail=renderDisclosure({summary:tr(lang,`События · ${item.events.length}`,`Events · ${item.events.length}`),key:item.id,className:"work-events",variant:"row",body:`<div class="work-event-detail"><p class="work-event-subject">${escapeHtml(subject)}</p>${item.limited?`<p class="work-event-coverage">${tr(lang,"Показана часть истории из сохранённых событий.","Partial history from retained events.")}</p>`:""}<ol class="work-event-list list-reset">${item.summaryEvents.map(eventRow).join("")}</ol>${raw}</div>`});
    const state=item.event==="task_started"?tr(lang,"Активна","Active"):item.event==="task_complete"?tr(lang,"Ожидает нового хода","Idle"):item.event==="turn_aborted"?tr(lang,"Ход прерван","Interrupted"):label(eventLabels,item.event,lang);
    const linkLabel=item.href?.includes("/pull/")?tr(lang,"Открыть PR","Open PR"):item.href?.includes("/issues/")?tr(lang,"Открыть задачу","Open task"):item.href?.includes("/codex/threads/")?tr(lang,"Открыть сессию","Open session"):tr(lang,"Открыть результат","Open result");
    const failed=["failed","needs_attention","collect_failed","compose_failed","promote_failed","turn_aborted"].includes(item.event)||item.result==="CI:failed";
    const success=["published","passed","ready","archived","promote_completed"].includes(item.event);
    const icon:IconName=failed?"alert":success?"check":item.event==="parked_review"?"review":item.agent==="Kurami"?"history":"bot";
    return `<li class="work-item" data-tone="${failed?"failure":success?"success":"accent"}" data-work-id="${escapeHtml(item.id)}" data-work-at="${escapeHtml(item.at)}" data-work-project="${escapeHtml(item.project)}" data-work-agent="${escapeHtml(item.agent)}"${index>=5?" hidden":""}><div class="work-item__row"><span class="work-item__icon">${renderIcon(icon)}</span><div class="work-item__body"><strong title="${escapeHtml(subject)}">${item.project!=="other"?`${escapeHtml(projectName(snapshot,item.project))} · `:""}${escapeHtml(subject)}</strong><div class="work-item__meta"><span>${escapeHtml(item.agent)}</span><span>${escapeHtml(state)}</span></div></div><div class="work-item__result">${item.result?`<span>${escapeHtml(result(item.result))}</span>`:""}<time datetime="${escapeHtml(item.at)}" title="${escapeHtml(formatTime(item.at,lang))}">${escapeHtml(relative(item.at))}</time></div><div class="work-item__link">${item.href?renderLinkButton({label:"↗",ariaLabel:linkLabel,attributes:{title:linkLabel},href:item.href,variant:"icon"}):""}</div></div>${detail}</li>`;
  }).join("");
  const options=(key:"project"|"agent")=>[{value:"all",label:tr(lang,"Все","All")},...[...new Set(activity.map(item=>item[key]))].map(value=>({value,label:key==="project"?projectName(snapshot,value):value}))];
  const filters=renderSelectField({name:"activity-project",label:tr(lang,"Проект","Project"),value:"all",options:options("project")})+renderSelectField({name:"activity-agent",label:tr(lang,"Агент","Agent"),value:"all",options:options("agent")});
  const more=renderDisclosure({summary:tr(lang,"Ещё","More"),key:"activity-more",variant:"inline",className:"activity-more",body:'<ol class="activity-more-list list-reset"></ol>'});
  return `<section class="section activity" aria-labelledby="activity-title"><div class="section-heading"><h2 id="activity-title">${renderIcon("history")}${tr(lang,"Активность","Live Activity")}</h2><div class="activity-filters">${filters}</div></div><div class="activity-log"><ol class="activity-list list-reset">${rows}</ol><p class="activity-empty"${activity.length?" hidden":""}>${tr(lang,"Нет событий","No events")}</p>${more}</div></section>`;
}
function renderControls(lang:HubLanguage):string {
  const buttons:[[string,string,string],...[string,string,string][]]=[["models","Модели","Models"],["settings","Настройки","Settings"],["server","Сервер","Server"],["appearance","Оформление","Appearance"],["composio-check","Проверка Composio","Composio check"],["restart","Перезапуск","Restart"]];
  const icons:IconName[]=["bot","controls","cpu","moon","database","clock"];
  return `<div class="controls-menu">${buttons.map(([action,ru,en],index)=>renderButton({label:tr(lang,ru,en),variant:"quiet",iconPath:iconPath(icons[index]!),visibleLabel:true,attributes:{"data-hub-control":action}})).join("")}</div>`;
}

function projectStatus(project:HubProject,lang:HubLanguage):string {
  if(!project.managed)return project.git.state==="available"?tr(lang,"Git · локально","Git · local"):tr(lang,"Git · нет данных","Git · unavailable");
  if(project.poll.state==="unavailable")return tr(lang,"Project · нет данных","Project · unavailable");
  return `Project · ${project.poll.state==="fresh"?tr(lang,"актуально","current"):tr(lang,"устарело","stale")} · ${formatTime(project.poll.capturedAt,lang)}`;
}

function projectRows(projects:HubProject[],lang:HubLanguage,days:Period):string {
  return renderTable({columns:[tr(lang,"Проект","Project"),tr(lang,"В работе","In progress"),"Review",tr(lang,"Коммиты","Commits"),tr(lang,"Источник","Source")],
    rows:projects.map(project=>[
      {html:`<a href="${escapeHtml(project.boardUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.name)} ↗</a>`},
      value(project.board?.active,lang),value(project.board?.review,lang),
      value(project.git.state==="available"?(days===7?project.git.commits7:project.git.commits30):null,lang),
      projectStatus(project,lang),
    ]),rowHeaders:true,className:"project-table"});
}


function renderUsage(snapshot:HubSnapshot,lang:HubLanguage):string {
  const usage=snapshot.usage;
  return `<div class="usage-block">${renderDisclosure({summary:tr(lang,"Расход","Usage"),key:"usage",boxed:true,className:"usage",body:
    periods("usage",days=>{
      const stats=usage?.periods[days];
      const coverage=usage?.available?`${tr(lang,"Логи","Logs")} ${stats!.measured}/${stats!.completed}`:tr(lang,"Нет данных","Unavailable");
      const description=tr(lang,"Полный расход измеренных задач, завершённых в выбранный период; CI и review-fix входят в доработки, первичное AI review — нет.","Lifetime tokens of measured tasks completed in this period; rework includes CI and review fixes, not initial AI review.");
      const rows=(stats:UsagePeriod|undefined)=>[
        value(usage?.available?stats?.completed:null,lang),
        {html:`<span title="${escapeHtml(value(stats?.medianTokens,lang))}">${compactNumber(stats?.medianTokens??null)}</span>`},
        stats?.reworkPercent==null?"—":value(Math.round(stats.reworkPercent*10)/10,lang)+"%",
        usage?.available?`${stats?.measured??0}/${stats?.completed??0}`:"—",
      ];
      return `<div class="usage-coverage"><span title="${escapeHtml(description)}" tabindex="0">${escapeHtml(coverage)}</span></div><div class="usage-metrics">${metric(tr(lang,"Завершено","Completed"),usage?.available?value(stats?.completed,lang):"—")}${metric(tr(lang,"Токены / задача · медиана","Tokens / task · median"),compactNumber(stats?.medianTokens??null),false,value(stats?.medianTokens,lang))}${metric(tr(lang,"Доработки","Rework"),stats?.reworkPercent==null?"—":value(Math.round(stats.reworkPercent*10)/10,lang)+"%")}</div>${renderTable({columns:[tr(lang,"Проект","Project"),tr(lang,"Завершено","Completed"),tr(lang,"Токены / задача","Tokens / task"),tr(lang,"Доработки","Rework"),tr(lang,"Логи","Logs")],rows:snapshot.projects.filter(project=>project.managed).map(project=>[project.name,...rows(usage?.projects[project.key]?.[days])]),rowHeaders:true,className:"usage-table"})}`;
    })})}</div>`;
}

function renderTrend(snapshot:HubSnapshot,lang:HubLanguage):string {
  const coverage=snapshot.sources.git==="partial"?tr(lang,"Git · частичные данные","Git · partial data"):snapshot.sources.git==="unavailable"?tr(lang,"Git · нет данных","Git · unavailable"):tr(lang,"Git · 4 репозитория","Git · 4 repositories");
  const charts=periods("commits",days=>{
    if(!snapshot.commitDays||snapshot.sources.git==="unavailable")return `<p class="empty-value">${coverage}</p>`;
    const selected=snapshot.commitDays.slice(-days);
    const chart=renderBarChart({id:`hub-commits-${days}`,title:tr(lang,"Коммиты","Commits")+" · "+daysLabel(days,lang),
      xLabel:tr(lang,"Дата","Date"),yLabel:tr(lang,"Коммиты","Commits"),unit:{kind:"number"},
      categories:selected.map(day=>({key:day.start,label:day.start,shortLabel:day.start.slice(5,10).replace("-",".")})),
      series:[{id:"commits",label:tr(lang,"Коммиты","Commits"),color:4,values:selected.map(day=>day.count)}],
      state:snapshot.sources.git==="partial"?"partial":"ready",message:coverage,
      display:{variant:"embedded",header:false,legend:"hidden",zoom:false,table:"screen-reader"},
    },lang);
    return `<div class="trend"><strong class="trend-total"><span data-commit-total${FIGURE_ATTRIBUTE}>${selected.reduce((sum,day)=>sum+day.count,0)}</span> ${tr(lang,"коммитов","commits")}</strong>${chart}</div>`;
  });
  const filters=snapshot.projects.map(project=>renderCheckbox({name:"commit-repository",label:project.name,value:project.key,checked:true})).join("");
  return `<section class="section" aria-labelledby="trend-title"><div class="section-heading section-heading--period"><h2 id="trend-title">${tr(lang,"Коммиты","Commits")}</h2><div class="heading-actions"><span data-commit-coverage>${coverage}</span></div></div><div class="repository-filters" role="group" aria-label="${tr(lang,"Репозитории","Repositories")}">${filters}</div><div data-commit-repositories="${escapeHtml(JSON.stringify(snapshot.commitRepositories??{}))}" data-commit-unavailable="${escapeHtml(JSON.stringify(snapshot.projects.filter(project=>project.git.state==="unavailable").map(project=>project.key)))}">${charts}</div></section>`;
}

/** One line on how things are: quiet or how many need attention, what is in progress, what waits for the owner. */
function renderPulse(snapshot:HubSnapshot,lang:HubLanguage):string {
  const problems=problemQueue(snapshot.operations?.alerts??[]).length,known=snapshot.sources.orchestrator==="available";
  const plural=(n:number,forms:[string,string,string])=>forms[n%100>=11&&n%100<=14?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];
  const parts=[problems?tr(lang,`${problems} ${plural(problems,["требует","требуют","требуют"])} внимания`,`${problems} need${problems===1?"s":""} attention`):tr(lang,"Всё спокойно","All quiet")];
  if(known&&snapshot.totals.working>0)parts.push(tr(lang,`${snapshot.totals.working} в работе`,`${snapshot.totals.working} in progress`));
  if(known&&snapshot.totals.attention>0)parts.push(tr(lang,`${snapshot.totals.attention} ${plural(snapshot.totals.attention,["ждёт","ждут","ждут"])} тебя`,`${snapshot.totals.attention} waiting for you`));
  else if(known&&snapshot.totals.review>0)parts.push(tr(lang,`${snapshot.totals.review} на ревью`,`${snapshot.totals.review} in review`));
  return `<p class="hub__pulse" data-state="${problems?"attention":"quiet"}">${parts.map(part=>`<span>${escapeHtml(part)}</span>`).join("")}</p>`;
}

export function renderHubDashboard(snapshot:HubSnapshot,lang:HubLanguage="en"):string {
  const orchestratorAvailable=snapshot.sources.orchestrator==="available";
  return `<div class="hub__topline"><h1 class="sr-only">Kurami Hub</h1>${renderPulse(snapshot,lang)}<p class="hub__live">${escapeHtml(formatTime(snapshot.generatedAt,lang))}</p></div>${renderAlerts(snapshot,lang)}
    <section class="overview-grid" aria-label="${tr(lang,"Показатели системы","System metrics")}">
      <div class="hub-panel task-summary"${surfaceAttributes("panel")}><h2>${tr(lang,"Задачи","Tasks")}</h2><div class="task-summary__metrics">
      <div class="task-summary__cell">${metric(tr(lang,"В работе","In progress"),orchestratorAvailable?value(snapshot.totals.working,lang):"—",false,undefined,{tone:"accent",icon:"work",plain:true})}</div>
      <div class="task-summary__cell">${metric("Human Review",orchestratorAvailable?value(snapshot.totals.review,lang):"—",false,undefined,{tone:snapshot.totals.review>0?"warning":"neutral",icon:"review",plain:true})}</div>
      <div class="task-summary__cell">${metric(tr(lang,"Нужен владелец","Needs owner"),orchestratorAvailable?value(snapshot.totals.attention,lang):"—",snapshot.totals.attention>0,undefined,{icon:"person",plain:true})}</div>
      </div></div>
      <div class="period-metric">${periods("commits",days=>metric(`${tr(lang,"Коммиты","Commits")} · ${daysLabel(days,lang)}${snapshot.sources.git==="partial"?tr(lang," · частично"," · partial"):""}`,snapshot.sources.git==="unavailable"?"—":value(snapshot.projects.reduce((sum,project)=>sum+(days===7?project.git.commits7:project.git.commits30),0),lang),false,undefined,{tone:"accent",icon:"commits"}))}</div>
      <div class="period-cost">${periods("commits",days=>metric(`API eq · ${daysLabel(days,lang)}${snapshot.codex.coverage!=="complete"||snapshot.codex.periods?.[days].equivalent?.unpricedTokens?" *":""}`,estimatedUsd(snapshot.codex.periods?.[days].equivalent?.usd),false,tr(lang,"Оценка по тарифам API, не стоимость подписки. Только локальные логи Codex; неизвестные модели исключены. * — частичные данные.","Estimate at API rates, not subscription spending. Local Codex logs only; unpriced models excluded. * means partial data."),{tone:"accent",icon:"tokens"}))}</div>
    </section>
    ${renderHealth(snapshot,lang)}
    <section class="section" aria-labelledby="projects-title"><div class="section-heading"><h2 id="projects-title">${tr(lang,"Проекты","Projects")}</h2></div>${periods("commits",days=>projectRows(snapshot.projects,lang,days))}${renderUsage(snapshot,lang)}</section>
    ${renderTrend(snapshot,lang)}${renderCodex(snapshot.codex,lang)}${renderActivity(snapshot,lang)}`;
}

function hubHeader(lang:HubLanguage,controls=true):string {
  const other:HubLanguage=lang==="ru"?"en":"ru";
  const menu=renderButton({label:tr(lang,"Управление","Controls"),variant:"icon",iconPath:iconPath("controls"),disabled:!controls,attributes:{"data-hub-control":"menu",popovertarget:"hub-controls-popover","aria-expanded":"false","aria-controls":"hub-controls-popover"}});
  return renderSiteHeader({mobile:{app:"hub",lang},brand:{href:`/${lang}/`,ariaLabel:tr(lang,"Kurami Hub — главная","Kurami Hub — home"),foxSrc:"/assets/fox.webp",suffix:"Hub"},nav:{label:tr(lang,"Разделы Hub","Hub sections"),links:[],hideWhenEmpty:true},sites:kuramiSites("hub",lang),utility:controls?periodSwitch("global",lang,tr(lang,"Вся статистика","All statistics")):undefined,utilityFloating:controls,actions:menu+renderLinkButton({label:other.toUpperCase(),href:`/${other}/`,variant:"icon",ariaLabel:tr(lang,"Переключить на английский","Switch to Russian"),attributes:{hreflang:other}})+renderThemeSwitch(lang)});
}

export function renderHubPage(snapshot:HubSnapshot,lang:HubLanguage="en",csrfToken=""):string {
  return renderDocument({lang,title:"Hub · Kurami",description:tr(lang,"Личный дашборд Kurami.","Kurami personal dashboard."),favicon:"/assets/favicon.svg",styles:{href:HUB_CSS_URL},themeScript:true,skipLabel:tr(lang,"К содержимому","Skip to content"),
    head:`<meta name="hub-control-token" content="${escapeHtml(csrfToken)}"><link rel="manifest" href="/${lang}/manifest.webmanifest" crossorigin="use-credentials"><script src="${HUB_CLIENT_URL}" defer></script>`,
    header:hubHeader(lang),
main:`<div id="hub-dashboard" class="hub" aria-live="off"${LIVE_ATTRIBUTE}>${renderHubDashboard(snapshot,lang)}</div>${renderToastRegion(tr(lang,"Закрыть","Close"))}${renderPopover({id:"hub-controls-popover",label:tr(lang,"Управление","Controls"),body:renderControls(lang)})}${renderDialog({id:"hub-control-dialog",title:tr(lang,"Управление","Controls"),closeLabel:tr(lang,"Закрыть","Close"),body:`<div id="hub-control-content"></div><div id="hub-control-confirm" hidden><p id="hub-confirm-message" class="control-summary"></p><div id="hub-confirm-changes" hidden>${renderTable({columns:[tr(lang,"Поле","Field"),tr(lang,"Было","Before"),tr(lang,"Будет","After")],rows:[],rowHeaders:true,className:"control-changes"})}</div>${renderDialogActions(renderButton({label:tr(lang,"Отмена","Cancel"),variant:"secondary",attributes:{"data-hub-cancel":true}})+renderButton({label:tr(lang,"Подтвердить","Confirm"),variant:"info",attributes:{"data-hub-confirm":true}}))}</div><p id="hub-control-result" role="status"></p>`})}`,
    footer:renderSiteFooter({lang,app:"Hub",updated:formatTime(snapshot.generatedAt,lang)})});
}

export function renderHubOffline(lang:HubLanguage="en"):string {
  return renderDocument({lang,title:`${tr(lang,"Нет связи","Offline")} · Kurami Hub`,favicon:"/assets/favicon.svg",styles:{href:HUB_CSS_URL},themeScript:true,skipLabel:tr(lang,"К содержимому","Skip to content"),
    header:hubHeader(lang,false),
    main:`<div class="hub"><div class="hub__topline"><h1>${tr(lang,"Нет связи","Offline")}</h1></div></div>`,
    footer:renderSiteFooter({lang,app:"Hub"})});
}
