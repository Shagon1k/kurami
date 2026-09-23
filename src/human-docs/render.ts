import type {Change,Language} from "./changelog.ts";
import {pages,type HumanDocsPage} from "./content.ts";

const escape = (s:string) => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const labels = {
  en: {start:"Start",understand:"Understand",digest:"Digest",projects:"Projects",operations:"Operations",changelog:"Changelog",home:"Home",skip:"Skip to content",theme:"Toggle light and dark theme",choose:"Switch to Russian",latest:"Changes verified for deployed revision",unpublished:"No deployment revision was supplied. Changes are not claimed as live.",awaiting:"Docs are published; no verified application deployment revision has been supplied. Changes are not claimed as live.",source:"Commit",next:"Explore",flow:"How it moves",bounded:"Actions remain bounded by their own rules",current:"Current state"},
  ru: {start:"Начать",understand:"Устройство",digest:"Digest",projects:"Проекты",operations:"Эксплуатация",changelog:"Изменения",home:"Главная",skip:"К содержанию",theme:"Переключить светлую и тёмную темы",choose:"Переключить на английский",latest:"Изменения подтверждены для развёрнутой версии",unpublished:"Версия развёртывания не указана. Изменения не объявлены опубликованными.",awaiting:"Документация опубликована, но подтверждённая версия приложения не передана. Изменения не объявлены опубликованными.",source:"Коммит",next:"Разделы",flow:"Как это движется",bounded:"Для каждого действия действуют свои границы",current:"Текущее состояние"}
} as const;
type Section = HumanDocsPage["section"];
const sections: Section[] = ["start","understand","digest","projects","operations"];
const url = (lang:Language, slug:string) => `/${lang}/${slug ? slug+"/" : ""}`;
function shell(lang:Language, title:string, description:string, body:string, active?:string, alternateSlug="") {
  const t=labels[lang], other:Language=lang==="en"?"ru":"en";
  const alternate=url(other,alternateSlug);
  const links=(["start","digest","projects","operations","changelog"] as const).map(s=>{
    const destination=s==="changelog"?url(lang,"changelog"):s==="start"?url(lang,""):url(lang,pages.find(p=>p.section===s)?.slug??"");
    return `<a href="${destination}"${active===s?' aria-current="page"':''}>${t[s]}</a>`;
  }).join("");
  return `<!doctype html><html lang="${lang}" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#fbfbf8"><title>${escape(title)} · Kurami docs</title><meta name="description" content="${escape(description)}"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/docs.css"><script src="/assets/theme.js"></script></head><body><a class="skip" href="#main">${t.skip}</a><header class="site-header"><div class="frame site-header__inner"><a class="brand" href="${url(lang,"")}"><img src="/assets/fox.png" alt=""><b>Kurami<span>.</span> docs</b></a><nav class="topnav" aria-label="${t.next}">${links}</nav><details class="mobile-menu"><summary aria-label="${lang==="ru"?"Разделы":"Sections"}"><span class="menu-icon" aria-hidden="true"></span></summary><nav aria-label="${t.next}">${links}</nav></details><div class="actions"><a href="${alternate}" hreflang="${other}" aria-label="${t.choose}">${other.toUpperCase()}</a><button type="button" data-theme-toggle aria-label="${t.theme}">◐</button></div></div></header><main class="frame page" id="main">${body}</main><footer class="footer"><div class="frame">Kurami · ${t.current}</div></footer></body></html>`;
}
function steps(items:[string,string][],lang:Language) {return `<div class="visual"><span class="visual__label">${labels[lang].flow}</span><div class="flow">${items.map(([title,detail],index)=>`<div class="flow__step"><span class="folio">${String(index+1).padStart(2,"0")}</span><strong>${escape(title)}</strong><small>${escape(detail)}</small></div>`).join("")}</div></div>`;}
function visual(kind:string,lang:Language):string {
  if(kind==="home-map") return systemMap(lang);
  const data:Record<string,Record<Language,[string,string][]>>={
    "daily-flow":{en:[["Captured","Source batch is fixed"],["Prepared","Copy and layout are assembled"],["Validated","Guards check publication"],["Published","Edition becomes visible"]],ru:[["Собрано","Пакет источников зафиксирован"],["Подготовлено","Текст и страница собраны"],["Проверено","Проверки допускают публикацию"],["Опубликовано","Выпуск доступен"]]},
    "project-flow":{en:[["Intent","Explicit status change"],["Admission","Readiness and capacity"],["Run","Isolated worktree"],["Evidence","PR, checks and review"],["Owner","Decision and safe release"]],ru:[["Намерение","Явное изменение статуса"],["Допуск","Готовность и ресурсы"],["Работа","Отдельный worktree"],["Свидетельства","PR, проверки и review"],["Владелец","Решение и безопасное завершение"]]},
    "boundary":{en:[["Input","Sources and explicit requests"],["Rules","Validate and limit actions"],["Output","Visible state and evidence"]],ru:[["Вход","Источники и явные запросы"],["Правила","Проверка и ограничение действий"],["Результат","Состояние и свидетельства"]]},
    "comparison":{en:[["Fixed","Edition news and source batch"],["Refreshable","Live weather, calendar and mail"]],ru:[["Зафиксировано","Новости выпуска и пакет источников"],["Обновляется","Погода, календарь и почта"]]},
    "weekly-contrast":{en:[["Weekly","Seven completed local days; missing data stays missing"],["Cinema","Scheduled weekly edition; last good page remains on failure"]],ru:[["Weekly","Семь завершённых дней; пробелы остаются пробелами"],["Cinema","Еженедельный выпуск по расписанию; при сбое остаётся прежний"]]},
    "stocks-boundary":{en:[["Stocks","Cached market data, no holdings"],["Investment Review","Private research, no orders"]],ru:[["Stocks","Рыночные данные, без позиций"],["Investment Review","Закрытый анализ, без заявок"]]},
    "engineering-evidence":{en:[["CI","Checks for exact PR head"],["Review","Owner-triggered analysis"],["Preview","Temporary view, not deployment"]],ru:[["CI","Проверки точного коммита PR"],["Review","Анализ по запросу владельца"],["Preview","Временный просмотр, не deploy"]]},
    "recovery-scope":{en:[["Versioned code","Private repository"],["Selected state","Verified backup or optional encrypted bundle"],["Not included","Worktrees, Codex sessions and Docker data"]],ru:[["Код","Закрытый репозиторий"],["Часть состояния","Проверенная копия или зашифрованный архив"],["Не входит","Worktrees, сеансы Codex и данные Docker"]]}
  };
  if(!data[kind])throw new Error(`Unknown docs visual: ${kind}`);
  return steps(data[kind][lang],lang);
}
function systemMap(lang:Language) {
  const ru=lang==="ru";
  return `<div class="system-map" role="group" aria-label="${ru?"Два пути работы Курами":"Two paths through Kurami"}"><span class="visual__label">${ru?"Два пути, разные процессы":"Two paths, distinct workflows"}</span><div class="system-map__branches"><div class="system-map__cell"><strong>${ru?"Диалог и решения":"Conversation and decisions"}</strong><p>${ru?"Управление идёт через Discord. Hermes даёт агентный runtime для работы с инструментами.":"Control flows through Discord. Hermes provides the agent runtime and tools."}</p></div><div class="system-map__cell"><strong>${ru?"Фоновые процессы":"Background processes"}</strong><p>${ru?"Сбор, проверки и обновления могут работать по расписанию без нового сообщения.":"Collection, validation and refresh can run on a schedule without a new message."}</p></div></div><div class="system-map__cell system-map__result"><strong>${ru?"Продукты и наблюдаемый результат":"Products and observable result"}</strong><p>${ru?"Digest показывает выпуски. Project Orchestrator ведёт инженерные задачи. Operations отслеживает здоровье и восстановление. У каждого — свои состояния и ограничения.":"Digest presents editions. Project Orchestrator runs engineering work. Operations tracks health and recovery. Each has its own states and boundaries."}</p></div></div>`;
}
function side(lang:Language,active:string) {
  const items=sections.map(section=>`<div><h2>${labels[lang][section]}</h2><ul>${pages.filter(p=>p.section===section).map(p=>`<li><a href="${url(lang,p.slug)}"${active===p.slug?' aria-current="page"':''}>${escape(p.navTitle[lang])}</a></li>`).join("")}</ul></div>`).join("");
  return `<nav class="side" aria-label="${labels[lang].next}">${items}</nav><details class="side-mobile"><summary>${labels[lang].next}</summary><nav aria-label="${labels[lang].next}">${items}</nav></details>`;
}
function safeBlocks(page:HumanDocsPage,lang:Language) {
  return page.blocks.map(block=>{
    const raw=block[lang];
    if (/<\s*(?:script|iframe|object|embed|form|input|button)\b|\bon[a-z]+\s*=|javascript:|data:text\/html/i.test(raw)) throw new Error(`Unsafe markup in ${page.slug}/${lang}`);
    return `<section class="block">${raw.replace(/<div data-visual=['"]([a-z-]+)['"]\s*><\/div>/g,(_match,kind:string)=>visual(kind,lang))}</section>`;
  }).join("");
}
export function renderArticle(page:HumanDocsPage,lang:Language) {
  const active=page.section;
  const body=`<div class="layout">${side(lang,page.slug)}<article class="article"><header class="intro"><p class="eyebrow">${labels[lang][active]}</p><h1>${escape(page.title[lang])}</h1><p class="lede">${escape(page.summary[lang])}</p></header>${safeBlocks(page,lang)}</article></div>`;
  return shell(lang,page.title[lang],page.summary[lang],body,active,page.slug);
}
export function renderHome(lang:Language) {
  const ru=lang==="ru", title=ru?"Курами — личная агентная система":"Kurami — a private agent system";
  const description=ru?"Разговоры и явные решения превращаются в ограниченные по правилам действия. Видно, что сделано и что ждёт твоего решения.":"Conversations and explicit decisions become bounded actions. See what ran and what awaits your decision.";
  const routes=(["understand","digest","projects","operations"] as const).map(section=>{
    const page=pages.find(p=>p.section===section)!;
    return `<a class="route" href="${url(lang,page.slug)}"><div><p class="folio">${escape(labels[lang][section])}</p><h2>${escape(page.title[lang])}</h2><p>${escape(page.summary[lang])}</p></div><span class="arrow" aria-hidden="true">↗</span></a>`;
  }).join("");
  return shell(lang,title,description,`<div class="intro"><p class="eyebrow">${ru?"Система, не один сайт":"A system, not a single site"}</p><h1>${title}</h1><p class="lede">${description}</p>${systemMap(lang)}</div><section aria-label="${labels[lang].next}" class="sections">${routes}</section>`,"start");
}
export function renderChangelog(lang:Language,changes:Change[],revision?:string,published=false) {
  const ru=lang==="ru";
  const t=labels[lang], title=t.changelog;
  const groups=new Map<string,Change[]>();
  for(const change of changes) groups.set(change.date,[...(groups.get(change.date)??[]),change]);
  const categories={en:{new:"New",improved:"Improved",fixed:"Fixed",operations:"Operations"},ru:{new:"Новое",improved:"Улучшено",fixed:"Исправлено",operations:"Эксплуатация"}};
  const cards=[...groups].map(([date,items])=>`<section class="change-day"><h2>${escape(date)}</h2>${items.map(c=>`<div class="change"><span class="change__category">${categories[lang][c.category]}</span><a href="https://github.com/Shagon1k/kurami/commit/${c.sha}" rel="noopener noreferrer">${t.source} ${c.sha.slice(0,7)}</a><p>${escape(c.copy)}</p>${c.page?`<a href="${url(lang,c.page)}">${ru?"Открыть страницу":"Read the page"} ↗</a>`:""}</div>`).join("")}</section>`).join("");
  const status=revision?t.latest:published?t.awaiting:t.unpublished;
  const body=`<div class="layout">${side(lang,"")}<article class="article"><header class="intro"><p class="eyebrow">${revision?escape(revision.slice(0,7)):published?ru?"Ожидает подтверждения":"Awaiting verification":ru?"Локальный просмотр":"Local preview"}</p><h1>${title}</h1><p class="lede">${status}</p></header><div class="changes">${cards||`<p>${revision?ru?"После начальной точки пока нет опубликованных изменений.":"No published changes since the baseline.":status}</p>`}</div></article></div>`;
  return shell(lang,title,status,body,"changelog","changelog");
}
