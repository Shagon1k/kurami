import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {kuramiSites} from "../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderButton,renderLinkButton} from "../ui-library/components/button.ts";
import {renderPeriodSwitch} from "../ui-library/components/period-switch.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {renderDialog} from "../ui-library/components/dialog.ts";
import {compactNumber,estimatedUsd} from "./format.ts";
import {API_RATE_DATE,API_RATE_SOURCE,type ModelUsage,type ApiEquivalent} from "../core/api-equivalent.ts";
import {renderTable} from "../ui-library/components/table.ts";
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
  return new Intl.DateTimeFormat(lang==="ru"?"ru-RU":"en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Vilnius"}).format(date);
}

function metric(label:string,amount:number|string,attention=false,full?:string):string {
  return `<article class="metric${attention?" metric--attention":""}"><p class="metric__label">${escapeHtml(label)}</p><strong class="metric__value"${full?` tabindex="0" title="${escapeHtml(full)}" aria-label="${escapeHtml(full)}"`:""}>${escapeHtml(String(amount))}</strong></article>`;
}

function limitLabel(limit:CodexLimit,lang:HubLanguage):string {
  if(limit.windowMinutes===300)return tr(lang,"5 часов","5 hours");
  if(limit.windowMinutes===10080)return tr(lang,"7 дней","7 days");
  if(limit.windowMinutes%1440===0)return `${limit.windowMinutes/1440} ${tr(lang,"дн.","days")}`;
  if(limit.windowMinutes%60===0)return `${limit.windowMinutes/60} ${tr(lang,"ч.","hours")}`;
  return `${limit.windowMinutes} ${tr(lang,"мин.","min")}`;
}

function renderLimit(limit:CodexLimit,lang:HubLanguage):string {
  const used=Math.round(limit.usedPercent);
  const left=Math.round(limit.remainingPercent);
  const label=limitLabel(limit,lang);
  return `<article class="limit"><div class="limit__head"><span>${escapeHtml(label)}</span><strong>${left}% ${tr(lang,"осталось","left")}</strong></div><div class="limit__track" role="progressbar" aria-label="${escapeHtml(label)}: ${tr(lang,"использовано","used")} ${used}%" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="100"><span style="--used:${used}%"></span></div><div class="limit__meta"><span>${used}% ${tr(lang,"использовано","used")}</span><span>${tr(lang,"Сброс","Resets")} ${escapeHtml(formatTime(limit.resetsAt,lang))}</span></div></article>`;
}


type Period=7|30;
const daysLabel=(days:Period,lang:HubLanguage)=>`${days} ${tr(lang,"дней","days")}`;
const periodPanel=(key:string,days:Period,body:string)=>`<div data-period-panel="${key}" data-period-days="${days}"${days===7?" hidden":""}>${body}</div>`;
const periods=(key:string,body:(days:Period)=>string)=>([7,30] as const).map(days=>periodPanel(key,days,body(days))).join("");
const periodSwitch=(key:string,lang:HubLanguage,label:string)=>renderPeriodSwitch({key,lang,label:`${label} · ${tr(lang,"период","period")}`});


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
    return `<div class="token-totals">${metric(daysLabel(days,lang),compactNumber(selected.tokens),false,value(selected.tokens,lang))}</div><dl class="stat-list api-equivalent"><div><dt>${priceLabel}</dt><dd title="${escapeHtml(description+" "+quality)}" tabindex="0">${estimatedUsd(equivalent?.usd)}</dd></div></dl>${renderDisclosure({summary:tr(lang,"Разбивка","Breakdown"),className:"token-breakdown",body:`<dl class="stat-list"><div><dt>${tr(lang,"Кэшированный вход","Cached input")}</dt><dd title="${escapeHtml(value(selected.cached,lang))}">${compactNumber(selected.cached)}</dd></div><div><dt>${tr(lang,"Сгенерировано","Output")}</dt><dd title="${escapeHtml(value(selected.output,lang))}">${compactNumber(selected.output)}</dd></div></dl>`})}`;
  });
  const models=periods("models",days=>{
    const selected=stats(days);
    const usage=codex.periods?.[days].modelUsage;
    if(usage?.length){
      const numberCell=(amount:number|null)=>({html:`<span title="${escapeHtml(value(amount,lang))}" tabindex="0">${compactNumber(amount)}</span>`});
      const costCell=(equivalent:ApiEquivalent)=>({html:`<span title="${escapeHtml(tr(lang,"Токены без тарифа","Unpriced tokens"))}: ${value(equivalent.unpricedTokens,lang)}; ${escapeHtml(tr(lang,"Нет параметров кэша/контекста","Missing cache/context parameters"))}: ${value(equivalent.uncertainTokens,lang)}" tabindex="0">${estimatedUsd(equivalent.usd)}${equivalent.unpricedTokens?" *":""}</span>`});
      const modelName=(model:ModelUsage)=>model.name==="unknown"?tr(lang,"Неизвестна","Unknown"):model.name;
      const primaryRows=(items:ModelUsage[])=>items.map(model=>[modelName(model),numberCell(model.tokens),costCell(model.equivalent)]);
      const primary=renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Токены","Tokens"),"API eq"],rows:primaryRows(usage.slice(0,4)),rowHeaders:true,numeric:true,className:"model-table"});
      const rest=usage.length>4?renderDisclosure({summary:tr(lang,`Ещё ${usage.length-4}`,`${usage.length-4} more`),body:renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Токены","Tokens"),"API eq"],rows:primaryRows(usage.slice(4)),rowHeaders:true,numeric:true,className:"model-table"})}):"";
      const detail=renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Сессии","Sessions"),tr(lang,"Вход","Input"),tr(lang,"Кэш · чтение","Cache · read"),tr(lang,"Кэш · запись","Cache · write"),tr(lang,"Выход","Output")],rows:usage.map(model=>[modelName(model),value(model.sessions,lang),numberCell(model.input),numberCell(model.cached),numberCell(model.cacheWrite),numberCell(model.output)]),rowHeaders:true,numeric:true,className:"model-detail-table"});
      const source=`<p class="api-rates"><a href="${API_RATE_SOURCE}" target="_blank" rel="noopener noreferrer">Standard · ${API_RATE_DATE}</a></p>`;
      return primary+rest+renderDisclosure({summary:tr(lang,"Разбивка по моделям","Model breakdown"),className:"model-breakdown",body:detail+source});
    }
    return selected.models.length?renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Сессий","Sessions")],rows:selected.models.map(model=>[model.name,value(model.sessions,lang)]),rowHeaders:true,numeric:true,className:"model-table"}):`<p class="empty-value">${tr(lang,"Модели","Models")} —</p>`;
  });
  const timestamp=codex.account?.observedAt??codex.limits[0]?.observedAt??codex.updatedAt;
  const coverage=codex.coverage==="partial"?tr(lang,"Частичные логи","Partial logs"):tr(lang,"Локальные логи","Local logs");
  return `<section class="section" aria-labelledby="codex-title"><div class="section-heading"><h2 id="codex-title">Codex</h2><span>${coverage} · ${escapeHtml(formatTime(timestamp,lang))}</span></div>
    <div class="codex-grid"><div class="hub-panel tokens"><div class="panel-heading"><h3>${tr(lang,"Токены","Tokens")}</h3>${periodSwitch("tokens",lang,tr(lang,"Токены","Tokens"))}</div>${tokens}</div>
    <div class="hub-panel limits"><h3>${tr(lang,"Лимиты","Limits")} <span class="panel-status">${codex.account?.state==="live"?"Live":tr(lang,"Локальный снимок","Local snapshot")}</span></h3>${limits}<div class="reset-control"><span>${tr(lang,"Доступные сбросы","Available resets")} <strong>${value(codex.account?.resetCredits,lang)}</strong></span>${renderButton({label:tr(lang,"Сбросить","Reset"),variant:"subtle",size:"compact",disabled:codex.account?.state!=="live"||!(codex.account.resetCredits!>0),attributes:{"data-hub-control":"codex-reset"}})}</div></div>
    <div class="hub-panel models"><div class="panel-heading"><h3>${tr(lang,"Модели","Models")}</h3>${periodSwitch("models",lang,tr(lang,"Модели","Models"))}</div>${models}</div></div></section>`;
}
const alertLabels:Record<string,[string,string]>={health_stale:["Данные устарели","Stale data"],health_unavailable:["Нет данных","Unavailable"],health_issue:["System Health","System Health"],run_attention:["Сбой задачи","Task failure"],owner_input:["Нужен ответ","Input needed"],ci_unrepaired:["CI без ремонта","CI needs repair"],review_unrepaired:["Review без ремонта","Review needs repair"],poll_stale:["Снимок устарел","Stale snapshot"],orchestrator_unavailable:["Нет данных","Unavailable"]};
const eventLabels:Record<string,[string,string]>={session_started:["Новая сессия","Session started"],starting:["Запуск задачи","Task starting"],running:["В работе","Running"],waiting_human:["Ожидает ответа","Waiting for input"],needs_attention:["Требует внимания","Needs attention"],parked_review:["Human Review","Human Review"],handoff_pending:["Передача","Handoff"],remote_owned:["Remote","Remote"],cancelled:["Отменено","Cancelled"],archived:["Архивировано","Archived"],passed:["Успешно","Passed"],failed:["Сбой","Failed"],pending:["Проверяется","Pending"],ready:["Готово","Ready"],created:["Начат сбор","Collection started"],"live-collected":["Источники собраны","Sources collected"],editorialized:["Текст подготовлен","Editorial ready"],published:["Опубликовано","Published"],notified:["Доставлено","Delivered"]};
Object.assign(eventLabels,{task_started:["Начат ход","Turn started"],task_complete:["Ход завершён","Turn completed"],turn_aborted:["Ход прерван","Turn interrupted"],collect_started:["Сбор источников","Collecting sources"],collect_completed:["Источники собраны","Sources collected"],collect_failed:["Сбой сбора","Collection failed"],compose_started:["Подготовка выпуска","Composing edition"],compose_completed:["Выпуск подготовлен","Edition composed"],compose_failed:["Сбой подготовки","Composition failed"],promote_started:["Публикация","Publishing"],promote_completed:["Опубликовано","Published"],promote_failed:["Сбой публикации","Publication failed"],prepare_started:["Подготовка превью","Preparing preview"],prepare_completed:["Превью готово","Preview ready"]});
function label(map:Record<string,[string,string]>,code:string,lang:HubLanguage):string {const pair=map[code];return pair?tr(lang,...pair):code.replaceAll("_"," ").replaceAll("-"," ");}

function renderAlerts(snapshot:HubSnapshot,lang:HubLanguage):string {
  const alerts=snapshot.operations?.alerts??[];if(!alerts.length)return "";
  const rows=alerts.map(alert=>`<li class="alert-item" data-severity="${alert.severity}"><span>${escapeHtml(label(alertLabels,alert.code,lang))}</span>${alert.href?`<a href="${escapeHtml(alert.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(alert.subject)} ↗</a>`:`<strong>${escapeHtml(alert.subject)}</strong>`}</li>`);
  return `<section class="hub-alerts" aria-labelledby="alerts-title"><div class="section-heading"><h2 id="alerts-title">${tr(lang,"Требует внимания","Alerts")}</h2><span>${alerts.length}</span></div><ul class="alert-list list-reset">${rows.slice(0,4).join("")}</ul>${rows.length>4?renderDisclosure({summary:tr(lang,`Ещё ${rows.length-4}`,`${rows.length-4} more`),body:`<ul class="alert-list list-reset">${rows.slice(4).join("")}</ul>`}):""}</section>`;
}
function renderHealth(snapshot:HubSnapshot,lang:HubLanguage):string {
  const health=snapshot.operations?.health;
  const systemHeading=`<div class="section-heading"><h2 id="health-title">System Health</h2><span>${health?escapeHtml(formatTime(health.checkedAt,lang)):"—"}${snapshot.operations?.healthStale?` · ${tr(lang,"устарело","stale")}`:""}</span></div>`;
  if(!health)return `<section class="section" aria-labelledby="health-title">${systemHeading}<div class="metric-grid">${["CPU","RAM",tr(lang,"Сеть","Network"),tr(lang,"Диск","Disk")].map(name=>metric(name,"—")).join("")}</div><div class="hub-panel orchestrator-state"><h3>${tr(lang,"Project Orchestrator · состояние","Project Orchestrator · state")}</h3><p class="empty-value">—</p></div></section>`;
  const server=health.server;const state=health.orchestrator;
  const network=health.network.status==="offline"?tr(lang,"Нет связи","Offline"):health.network.latencyMs==null?"—":health.network.latencyMs+" ms";
  const stats=[[tr(lang,"База данных","State DB"),state.database],["Docker",`${state.containers.running} ↑ · ${state.containers.unhealthy} ${tr(lang,"сбоев","unhealthy")}`],
    [tr(lang,"Превью","Previews"),value(state.previews,lang)],["Worktrees",`${state.worktrees}/${state.worktreeLimit}`],
    [tr(lang,"Карантин","Quarantine"),value(state.quarantined,lang)],["Backup",state.backupAgeHours==null?"—":`${state.backupAgeHours}h / ${state.backupMaxAgeHours}h`]];
  const details=[`${server.cpuCores} cores · avg ${health.cpuStatistics.averagePercent??"—"}% · peak ${health.cpuStatistics.peakPercent??"—"}%`,
    `${server.memoryUsedGiB}/${server.memoryTotalGiB} GiB`,health.speed?`${Math.round(health.speed.downloadMbps)}↓ / ${Math.round(health.speed.uploadMbps)}↑ Mbps · ${formatTime(health.speed.checkedAt,lang)}`:health.network.status,
    `${health.disk.availableGiB} GiB ${tr(lang,"свободно","free")}`];
  return `<section class="section" aria-labelledby="health-title">${systemHeading}<div class="metric-grid health-metrics">${[["CPU",`${server.cpuUsedPercent}%`],["RAM",`${server.memoryUsedPercent}%`],[tr(lang,"Сеть","Network"),network],[tr(lang,"Диск","Disk"),`${health.disk.usedPercent}%`]].map(([name,amount],index)=>`<div class="health-cell">${metric(name!,amount!)}<p class="health-detail">${escapeHtml(details[index]!)}</p></div>`).join("")}</div>
    <div class="hub-panel orchestrator-state"><h3>${tr(lang,"Project Orchestrator · состояние","Project Orchestrator · state")}</h3><dl class="stat-list stat-list--wide">${stats.map(([key,amount])=>`<div><dt>${escapeHtml(key!)}</dt><dd>${escapeHtml(amount!)}</dd></div>`).join("")}</dl></div></section>`;
}
function renderActivity(snapshot:HubSnapshot,lang:HubLanguage):string {
  const activity=snapshot.operations?.activity??[];
  if(!activity.length)return "";
  const row=(item:typeof activity[number])=>`<li><time datetime="${escapeHtml(item.at)}">${escapeHtml(formatTime(item.at,lang))}</time><span class="activity-source">${escapeHtml(item.source)}</span><span>${escapeHtml(label(eventLabels,item.event,lang))}</span><span class="activity-subject">${item.href?`<a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.subject)}</a>`:escapeHtml(item.subject)}</span></li>`;
  return `<section class="section">${renderDisclosure({summary:tr(lang,"Активность","Live Activity"),boxed:true,className:"activity",body:`<ol class="activity-list list-reset">${activity.slice(0,5).map(row).join("")}</ol>${activity.length>5?renderDisclosure({summary:tr(lang,`Ещё ${activity.length-5}`,`${activity.length-5} more`),body:`<ol class="activity-list list-reset">${activity.slice(5).map(row).join("")}</ol>`}):""}`})}</section>`;
}
function renderControls(lang:HubLanguage):string {
  const buttons:[[string,string,string],...[string,string,string][]]=[["models","Модели","Models"],["settings","Настройки","Settings"],["composio-check","Composio","Composio"],["restart","Перезапуск","Restart"]];
  return `<section class="section controls" aria-label="${tr(lang,"Управление","Controls")}"><span>${tr(lang,"Управление","Controls")}</span><div class="control-buttons">${buttons.map(([action,ru,en])=>renderButton({label:tr(lang,ru,en),variant:"secondary",attributes:{"data-hub-control":action}})).join("")}</div></section>`;
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
  return `<div class="usage-block">${renderDisclosure({summary:tr(lang,"Расход","Usage"),boxed:true,className:"usage",body:
    `<div class="usage-heading">${periodSwitch("usage",lang,tr(lang,"Расход","Usage"))}</div>`+periods("usage",days=>{
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
    const selected=snapshot.commitDays.slice(-days),max=Math.max(1,...selected.map(day=>day.count));
    const bars=selected.map(day=>{
      const height=Math.round(100*day.count/max),date=day.start.slice(5,10).replace("-",".");
      return `<li aria-label="${escapeHtml(day.start)}: ${day.count} ${tr(lang,"коммитов","commits")}"><span class="trend__count" aria-hidden="true">${day.count}</span><span class="trend__bar" style="--bar-height:${height}%" aria-hidden="true"></span><span class="trend__date" aria-hidden="true">${escapeHtml(date)}</span></li>`;
    }).join("");
    return `<div class="trend"><ol class="trend__chart" style="--trend-columns:${days}" aria-label="${tr(lang,"Коммиты","Commits")} · ${daysLabel(days,lang)}">${bars}</ol></div>`;
  });
  return `<section class="section" aria-labelledby="trend-title"><div class="section-heading section-heading--period"><h2 id="trend-title">${tr(lang,"Коммиты","Commits")}</h2><div class="heading-actions"><span>${coverage}</span>${periodSwitch("commits",lang,tr(lang,"Коммиты","Commits"))}</div></div>${charts}</section>`;
}

export function renderHubDashboard(snapshot:HubSnapshot,lang:HubLanguage="en"):string {
  const orchestratorAvailable=snapshot.sources.orchestrator==="available";
  return `<div class="hub__topline"><h1 class="sr-only">Kurami Hub</h1><p class="hub__live">${escapeHtml(formatTime(snapshot.generatedAt,lang))}</p></div>${renderAlerts(snapshot,lang)}
    <section class="metric-grid" aria-label="${tr(lang,"Показатели системы","System metrics")}">
      ${metric(tr(lang,"В работе","In progress"),orchestratorAvailable?value(snapshot.totals.working,lang):"—")}
      ${metric("Human Review",orchestratorAvailable?value(snapshot.totals.review,lang):"—",snapshot.totals.review>0)}
      ${metric(tr(lang,"Нужен владелец","Needs owner"),orchestratorAvailable?value(snapshot.totals.attention,lang):"—",snapshot.totals.attention>0)}
      <div class="period-metric">${periods("commits",days=>metric(`${tr(lang,"Коммиты","Commits")} · ${daysLabel(days,lang)}${snapshot.sources.git==="partial"?tr(lang," · частично"," · partial"):""}`,snapshot.sources.git==="unavailable"?"—":value(snapshot.projects.reduce((sum,project)=>sum+(days===7?project.git.commits7:project.git.commits30),0),lang)))}</div>
    </section>
    ${renderCodex(snapshot.codex,lang)}
    ${renderHealth(snapshot,lang)}
    <section class="section" aria-labelledby="projects-title"><div class="section-heading section-heading--period"><h2 id="projects-title">${tr(lang,"Проекты","Projects")}</h2>${periodSwitch("commits",lang,tr(lang,"Коммиты","Commits"))}</div>${periods("commits",days=>projectRows(snapshot.projects,lang,days))}${renderUsage(snapshot,lang)}</section>
    ${renderTrend(snapshot,lang)}${renderActivity(snapshot,lang)}${renderControls(lang)}`;
}

function hubHeader(lang:HubLanguage):string {
  const other:HubLanguage=lang==="ru"?"en":"ru";
  return renderSiteHeader({brand:{href:`/${lang}/`,ariaLabel:tr(lang,"Kurami Hub — главная","Kurami Hub — home"),foxSrc:"/assets/fox.webp",suffix:"hub"},nav:{label:tr(lang,"Разделы Hub","Hub sections"),links:[],hideWhenEmpty:true},sites:kuramiSites("hub",lang),actions:renderLinkButton({label:other.toUpperCase(),href:`/${other}/`,variant:"icon",ariaLabel:tr(lang,"Переключить на английский","Switch to Russian"),attributes:{hreflang:other}})+renderThemeSwitch(lang)});
}

export function renderHubPage(snapshot:HubSnapshot,lang:HubLanguage="en",csrfToken=""):string {
  return renderDocument({lang,title:"Hub · Kurami",description:tr(lang,"Личный дашборд Kurami.","Kurami personal dashboard."),favicon:"/assets/favicon.svg",styles:{href:"/assets/hub.css"},themeScript:true,skipLabel:tr(lang,"К содержимому","Skip to content"),
    head:`<meta name="hub-control-token" content="${escapeHtml(csrfToken)}"><link rel="manifest" href="/${lang}/manifest.webmanifest"><script src="/assets/hub.js" defer></script>`,
    header:hubHeader(lang),
    main:`<div id="hub-dashboard" class="hub" aria-live="off">${renderHubDashboard(snapshot,lang)}</div>${renderDialog({id:"hub-control-dialog",title:tr(lang,"Управление","Controls"),closeLabel:tr(lang,"Закрыть","Close"),body:`<div id="hub-control-content"></div><div id="hub-control-confirm" hidden><p id="hub-confirm-message" class="control-summary"></p><div class="control-actions">${renderButton({label:tr(lang,"Подтвердить","Confirm"),variant:"primary",attributes:{"data-hub-confirm":true}})}${renderButton({label:tr(lang,"Отмена","Cancel"),variant:"secondary",attributes:{"data-hub-cancel":true}})}</div></div><p id="hub-control-result" role="status"></p>`})}`,
    footer:'<footer class="hub-footer container">Kurami Hub · Europe/Vilnius</footer>'});
}

export function renderHubOffline(lang:HubLanguage="en"):string {
  return renderDocument({lang,title:`${tr(lang,"Нет связи","Offline")} · Kurami Hub`,favicon:"/assets/favicon.svg",styles:{href:"/assets/hub.css"},themeScript:true,skipLabel:tr(lang,"К содержимому","Skip to content"),
    header:hubHeader(lang),
    main:`<div class="hub"><div class="hub__topline"><h1>${tr(lang,"Нет связи","Offline")}</h1></div></div>`,
    footer:'<footer class="hub-footer container">Kurami Hub</footer>'});
}
