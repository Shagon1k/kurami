import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {kuramiSites} from "../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderTable} from "../ui-library/components/table.ts";
import type {CodexLimit,CodexSnapshot} from "./codex.ts";
import type {HubProject,HubSnapshot} from "./snapshot.ts";

const number=new Intl.NumberFormat("ru-RU");
const value=(amount:number|null|undefined)=>amount==null?"—":number.format(amount);

function formatTime(iso:string|null):string {
  if(!iso)return "—";
  const date=new Date(iso);
  if(!Number.isFinite(date.getTime()))return "—";
  return new Intl.DateTimeFormat("ru-RU",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Vilnius"}).format(date);
}

function metric(label:string,amount:number|string,attention=false):string {
  return `<article class="metric${attention?" metric--attention":""}"><p class="metric__label">${escapeHtml(label)}</p><strong class="metric__value">${escapeHtml(String(amount))}</strong></article>`;
}

function limitLabel(limit:CodexLimit):string {
  if(limit.windowMinutes===300)return "5 часов";
  if(limit.windowMinutes===10080)return "7 дней";
  if(limit.windowMinutes%1440===0)return `${limit.windowMinutes/1440} дн.`;
  if(limit.windowMinutes%60===0)return `${limit.windowMinutes/60} ч.`;
  return `${limit.windowMinutes} мин.`;
}

function renderLimit(limit:CodexLimit):string {
  const used=Math.round(limit.usedPercent);
  const left=Math.round(limit.remainingPercent);
  return `<article class="limit"><div class="limit__head"><span>${escapeHtml(limitLabel(limit))}</span><strong>${left}% осталось</strong></div><div class="limit__track" role="progressbar" aria-label="${escapeHtml(limitLabel(limit))}: использовано ${used}%" aria-valuenow="${used}" aria-valuemin="0" aria-valuemax="100"><span style="--used:${used}%"></span></div><div class="limit__meta"><span>${used}% использовано</span><span>Сброс ${escapeHtml(formatTime(limit.resetsAt))}</span></div></article>`;
}

function renderCodex(codex:CodexSnapshot):string {
  const limits=codex.limits.length?codex.limits.map(renderLimit).join(""):'<p class="empty-value">Лимиты —</p>';
  const modelTable=codex.models.length?renderTable({columns:["Модель","Сессий · 30 дн."],rows:codex.models.map(model=>[model.name,value(model.sessions)]),rowHeaders:true,numeric:true,className:"model-table"}):'<p class="empty-value">Модели —</p>';
  const timestamp=codex.limits[0]?.observedAt??codex.updatedAt;
  const coverage=codex.coverage==="partial"?"Частичные логи":"Локальные логи";
  return `<section class="section" aria-labelledby="codex-title"><div class="section-heading"><h2 id="codex-title">Codex</h2><span>${coverage} · ${escapeHtml(formatTime(timestamp))}</span></div>
    <div class="codex-grid"><div class="codex-main"><div class="codex-metrics">
      ${metric("Токены · 7 дн.",value(codex.tokens7))}
      ${metric("Токены · 30 дн.",value(codex.tokens30))}
      ${metric("Кэш · 30 дн.",value(codex.cached30))}
      ${metric("Вывод · 30 дн.",value(codex.output30))}
    </div><div class="limits"><h3>Лимиты</h3>${limits}</div></div>
    <div class="models"><h3>Модели</h3>${modelTable}</div></div></section>`;
}

function projectStatus(project:HubProject):string {
  if(!project.managed)return project.git.state==="available"?"Git · локально":"Git · нет данных";
  if(project.poll.state==="unavailable")return "Project · нет данных";
  return `Project · ${project.poll.state==="fresh"?"актуально":"устарело"} · ${formatTime(project.poll.capturedAt)}`;
}

function projectRows(projects:HubProject[]):string {
  return renderTable({columns:["Проект","В работе","Review","Коммиты · 7 дн.","Коммиты · 30 дн.","Источник"],
    rows:projects.map(project=>[
      {html:`<a href="${escapeHtml(project.boardUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(project.name)} ↗</a>`},
      value(project.board?.active),value(project.board?.review),
      value(project.git.state==="available"?project.git.commits7:null),
      value(project.git.state==="available"?project.git.commits30:null),
      projectStatus(project),
    ]),rowHeaders:true,className:"project-table"});
}

function renderTrend(snapshot:HubSnapshot):string {
  if(snapshot.sources.git==="unavailable")return `<section class="section" aria-labelledby="trend-title"><div class="section-heading"><h2 id="trend-title">Коммиты по неделям</h2><span>Git · нет данных</span></div></section>`;
  const max=Math.max(1,...snapshot.weeks.map(week=>week.count));
  const bars=snapshot.weeks.map(week=>{
    const height=Math.round(100*week.count/max);
    const date=week.start.slice(5).replace("-",".");
    return `<li aria-label="Неделя ${escapeHtml(week.start)}: ${week.count} коммитов"><span class="trend__count" aria-hidden="true">${week.count}</span><span class="trend__bar" style="--bar-height:${height}%" aria-hidden="true"></span><span class="trend__date" aria-hidden="true">${escapeHtml(date)}</span></li>`;
  }).join("");
  const coverage=snapshot.sources.git==="partial"?"Git · частичные данные":"Git · 4 репозитория";
  return `<section class="section" aria-labelledby="trend-title"><div class="section-heading"><h2 id="trend-title">Коммиты по неделям</h2><span>${coverage}</span></div><div class="trend"><ol class="trend__chart" aria-label="Коммиты за последние 12 недель">${bars}</ol></div></section>`;
}

export function renderHubDashboard(snapshot:HubSnapshot):string {
  const orchestratorAvailable=snapshot.sources.orchestrator==="available";
  const commitsLabel=snapshot.sources.git==="partial"?"Коммиты · 30 дн. · частично":"Коммиты · 30 дн.";
  return `<div class="hub__topline"><h1>Обзор</h1><p class="hub__live">${escapeHtml(formatTime(snapshot.generatedAt))}</p></div>
    <section class="metric-grid" aria-label="Показатели системы">
      ${metric("В работе",orchestratorAvailable?value(snapshot.totals.working):"—")}
      ${metric("Human Review",orchestratorAvailable?value(snapshot.totals.review):"—",snapshot.totals.review>0)}
      ${metric("Нужен владелец",orchestratorAvailable?value(snapshot.totals.attention):"—",snapshot.totals.attention>0)}
      ${metric(commitsLabel,snapshot.sources.git==="unavailable"?"—":value(snapshot.totals.commits30))}
    </section>
    ${renderCodex(snapshot.codex)}
    <section class="section" aria-labelledby="projects-title"><div class="section-heading"><h2 id="projects-title">Проекты</h2><span>3 Project + Kurami</span></div>${projectRows(snapshot.projects)}</section>
    ${renderTrend(snapshot)}
    <nav class="section links" aria-label="Ресурсы"><a href="https://digest.shagon1k.win/">Digest ↗</a><a href="https://docs.shagon1k.win/ru/">Docs ↗</a></nav>`;
}

export function renderHubPage(snapshot:HubSnapshot):string {
  return renderDocument({lang:"ru",title:"Hub · Kurami",description:"Личный дашборд Kurami.",favicon:"/assets/favicon.svg",styles:{href:"/assets/hub.css"},themeScript:true,skipLabel:"К содержимому",
    head:'<link rel="manifest" href="/manifest.webmanifest"><script src="/assets/hub.js" defer></script>',
    header:renderSiteHeader({brand:{href:"/",ariaLabel:"Kurami Hub — главная",foxSrc:"/assets/fox.webp",suffix:"hub"},nav:{label:"Разделы Hub",links:[],hideWhenEmpty:true},sites:kuramiSites("hub"),actions:renderThemeSwitch("ru")}),
    main:`<div id="hub-dashboard" class="hub" aria-live="off">${renderHubDashboard(snapshot)}</div>`,
    footer:'<footer class="hub-footer container">Kurami Hub · Europe/Vilnius</footer>'});
}

export function renderHubOffline():string {
  return renderDocument({lang:"ru",title:"Нет связи · Kurami Hub",favicon:"/assets/favicon.svg",styles:{href:"/assets/hub.css"},themeScript:true,skipLabel:"К содержимому",
    header:renderSiteHeader({brand:{href:"/",ariaLabel:"Kurami Hub — главная",foxSrc:"/assets/fox.webp",suffix:"hub"},nav:{label:"Разделы Hub",links:[],hideWhenEmpty:true},sites:kuramiSites("hub"),actions:renderThemeSwitch("ru")}),
    main:'<div class="hub"><div class="hub__topline"><h1>Нет связи</h1></div></div>',
    footer:'<footer class="hub-footer container">Kurami Hub</footer>'});
}
