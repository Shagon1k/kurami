import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {kuramiSites} from "../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderLinkButton} from "../ui-library/components/button.ts";
import {renderTable} from "../ui-library/components/table.ts";
import type {CodexLimit,CodexSnapshot} from "./codex.ts";
import type {HubProject,HubSnapshot} from "./snapshot.ts";

export type HubLanguage="ru"|"en";
const tr=(lang:HubLanguage,ru:string,en:string)=>lang==="ru"?ru:en;
const value=(amount:number|null|undefined,lang:HubLanguage)=>amount==null?"—":new Intl.NumberFormat(lang==="ru"?"ru-RU":"en-US").format(amount);

function formatTime(iso:string|null,lang:HubLanguage):string {
  if(!iso)return "—";
  const date=new Date(iso);
  if(!Number.isFinite(date.getTime()))return "—";
  return new Intl.DateTimeFormat(lang==="ru"?"ru-RU":"en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Vilnius"}).format(date);
}

function metric(label:string,amount:number|string,attention=false):string {
  return `<article class="metric${attention?" metric--attention":""}"><p class="metric__label">${escapeHtml(label)}</p><strong class="metric__value">${escapeHtml(String(amount))}</strong></article>`;
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

function renderCodex(codex:CodexSnapshot,lang:HubLanguage):string {
  const limits=codex.limits.length?codex.limits.map(limit=>renderLimit(limit,lang)).join(""):`<p class="empty-value">${tr(lang,"Лимиты","Limits")} —</p>`;
  const modelTable=codex.models.length?renderTable({columns:[tr(lang,"Модель","Model"),tr(lang,"Сессий · 30 дн.","Sessions · 30 days")],rows:codex.models.map(model=>[model.name,value(model.sessions,lang)]),rowHeaders:true,numeric:true,className:"model-table"}):`<p class="empty-value">${tr(lang,"Модели","Models")} —</p>`;
  const timestamp=codex.limits[0]?.observedAt??codex.updatedAt;
  const coverage=codex.coverage==="partial"?tr(lang,"Частичные логи","Partial logs"):tr(lang,"Локальные логи","Local logs");
  return `<section class="section" aria-labelledby="codex-title"><div class="section-heading"><h2 id="codex-title">Codex</h2><span>${coverage} · ${escapeHtml(formatTime(timestamp,lang))}</span></div>
    <div class="codex-grid"><div class="codex-main"><div class="codex-metrics">
      ${metric(tr(lang,"Токены · 7 дн.","Tokens · 7 days"),value(codex.tokens7,lang))}
      ${metric(tr(lang,"Токены · 30 дн.","Tokens · 30 days"),value(codex.tokens30,lang))}
      ${metric(tr(lang,"Кэш · 30 дн.","Cached · 30 days"),value(codex.cached30,lang))}
      ${metric(tr(lang,"Вывод · 30 дн.","Output · 30 days"),value(codex.output30,lang))}
    </div><div class="limits"><h3>${tr(lang,"Лимиты","Limits")}</h3>${limits}</div></div>
    <div class="models"><h3>${tr(lang,"Модели","Models")}</h3>${modelTable}</div></div></section>`;
}

function projectStatus(project:HubProject,lang:HubLanguage):string {
  if(!project.managed)return project.git.state==="available"?tr(lang,"Git · локально","Git · local"):tr(lang,"Git · нет данных","Git · unavailable");
  if(project.poll.state==="unavailable")return tr(lang,"Project · нет данных","Project · unavailable");
  return `Project · ${project.poll.state==="fresh"?tr(lang,"актуально","current"):tr(lang,"устарело","stale")} · ${formatTime(project.poll.capturedAt,lang)}`;
}

function projectRows(projects:HubProject[],lang:HubLanguage):string {
  return renderTable({columns:[tr(lang,"Проект","Project"),tr(lang,"В работе","In progress"),"Review",tr(lang,"Коммиты · 7 дн.","Commits · 7 days"),tr(lang,"Коммиты · 30 дн.","Commits · 30 days"),tr(lang,"Источник","Source")],
    rows:projects.map(project=>[
      {html:`<a href="${escapeHtml(project.boardUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.name)} ↗</a>`},
      value(project.board?.active,lang),value(project.board?.review,lang),
      value(project.git.state==="available"?project.git.commits7:null,lang),
      value(project.git.state==="available"?project.git.commits30:null,lang),
      projectStatus(project,lang),
    ]),rowHeaders:true,className:"project-table"});
}

function renderTrend(snapshot:HubSnapshot,lang:HubLanguage):string {
  if(snapshot.sources.git==="unavailable")return `<section class="section" aria-labelledby="trend-title"><div class="section-heading"><h2 id="trend-title">${tr(lang,"Коммиты по неделям","Commits by week")}</h2><span>${tr(lang,"Git · нет данных","Git · unavailable")}</span></div></section>`;
  const max=Math.max(1,...snapshot.weeks.map(week=>week.count));
  const bars=snapshot.weeks.map(week=>{
    const height=Math.round(100*week.count/max);
    const date=week.start.slice(5).replace("-",".");
    return `<li aria-label="${tr(lang,"Неделя","Week")} ${escapeHtml(week.start)}: ${week.count} ${tr(lang,"коммитов","commits")}"><span class="trend__count" aria-hidden="true">${week.count}</span><span class="trend__bar" style="--bar-height:${height}%" aria-hidden="true"></span><span class="trend__date" aria-hidden="true">${escapeHtml(date)}</span></li>`;
  }).join("");
  const coverage=snapshot.sources.git==="partial"?tr(lang,"Git · частичные данные","Git · partial data"):tr(lang,"Git · 4 репозитория","Git · 4 repositories");
  return `<section class="section" aria-labelledby="trend-title"><div class="section-heading"><h2 id="trend-title">${tr(lang,"Коммиты по неделям","Commits by week")}</h2><span>${coverage}</span></div><div class="trend"><ol class="trend__chart" aria-label="${tr(lang,"Коммиты за последние 12 недель","Commits over the last 12 weeks")}">${bars}</ol></div></section>`;
}

export function renderHubDashboard(snapshot:HubSnapshot,lang:HubLanguage="ru"):string {
  const orchestratorAvailable=snapshot.sources.orchestrator==="available";
  const commitsLabel=snapshot.sources.git==="partial"?tr(lang,"Коммиты · 30 дн. · частично","Commits · 30 days · partial"):tr(lang,"Коммиты · 30 дн.","Commits · 30 days");
  return `<div class="hub__topline"><h1>${tr(lang,"Обзор","Overview")}</h1><p class="hub__live">${escapeHtml(formatTime(snapshot.generatedAt,lang))}</p></div>
    <section class="metric-grid" aria-label="${tr(lang,"Показатели системы","System metrics")}">
      ${metric(tr(lang,"В работе","In progress"),orchestratorAvailable?value(snapshot.totals.working,lang):"—")}
      ${metric("Human Review",orchestratorAvailable?value(snapshot.totals.review,lang):"—",snapshot.totals.review>0)}
      ${metric(tr(lang,"Нужен владелец","Needs owner"),orchestratorAvailable?value(snapshot.totals.attention,lang):"—",snapshot.totals.attention>0)}
      ${metric(commitsLabel,snapshot.sources.git==="unavailable"?"—":value(snapshot.totals.commits30,lang))}
    </section>
    ${renderCodex(snapshot.codex,lang)}
    <section class="section" aria-labelledby="projects-title"><div class="section-heading"><h2 id="projects-title">${tr(lang,"Проекты","Projects")}</h2><span>3 Project + Kurami</span></div>${projectRows(snapshot.projects,lang)}</section>
    ${renderTrend(snapshot,lang)}
    <nav class="section links" aria-label="${tr(lang,"Ресурсы","Resources")}"><a href="https://digest.shagon1k.win/">Digest ↗</a><a href="https://docs.shagon1k.win/${lang}/">Docs ↗</a></nav>`;
}

function hubHeader(lang:HubLanguage):string {
  const other:HubLanguage=lang==="ru"?"en":"ru";
  return renderSiteHeader({brand:{href:`/${lang}/`,ariaLabel:tr(lang,"Kurami Hub — главная","Kurami Hub — home"),foxSrc:"/assets/fox.webp",suffix:"hub"},nav:{label:tr(lang,"Разделы Hub","Hub sections"),links:[],hideWhenEmpty:true},sites:kuramiSites("hub",lang),actions:renderLinkButton({label:other.toUpperCase(),href:`/${other}/`,variant:"icon",ariaLabel:tr(lang,"Переключить на английский","Switch to Russian"),attributes:{hreflang:other}})+renderThemeSwitch(lang)});
}

export function renderHubPage(snapshot:HubSnapshot,lang:HubLanguage="ru"):string {
  return renderDocument({lang,title:"Hub · Kurami",description:tr(lang,"Личный дашборд Kurami.","Kurami personal dashboard."),favicon:"/assets/favicon.svg",styles:{href:"/assets/hub.css"},themeScript:true,skipLabel:tr(lang,"К содержимому","Skip to content"),
    head:`<link rel="manifest" href="${lang==="en"?"/en/manifest.webmanifest":"/manifest.webmanifest"}"><script src="/assets/hub.js" defer></script>`,
    header:hubHeader(lang),
    main:`<div id="hub-dashboard" class="hub" aria-live="off">${renderHubDashboard(snapshot,lang)}</div>`,
    footer:'<footer class="hub-footer container">Kurami Hub · Europe/Vilnius</footer>'});
}

export function renderHubOffline(lang:HubLanguage="ru"):string {
  return renderDocument({lang,title:`${tr(lang,"Нет связи","Offline")} · Kurami Hub`,favicon:"/assets/favicon.svg",styles:{href:"/assets/hub.css"},themeScript:true,skipLabel:tr(lang,"К содержимому","Skip to content"),
    header:hubHeader(lang),
    main:`<div class="hub"><div class="hub__topline"><h1>${tr(lang,"Нет связи","Offline")}</h1></div></div>`,
    footer:'<footer class="hub-footer container">Kurami Hub</footer>'});
}
