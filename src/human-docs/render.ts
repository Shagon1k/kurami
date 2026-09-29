import type {Change,Language} from "./changelog.ts";
import {pages,type HumanDocsPage} from "./content.ts";
import {navigation,sectionLabels,groupOf} from "./content/navigation.ts";
import {assertSafeMarkup,assertSourcePath,type VisualId} from "./content/schema.ts";
import {renderLinkButton} from "../ui-library/components/button.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderCallout} from "../ui-library/components/callout.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {inlineDiagram} from "../ui-library/foundations/diagram.ts";
import {readFileSync} from "node:fs";

const escape = (s:string) => s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const labels = {
  en: {changelog:"Changelog",home:"Home",skip:"Skip to content",choose:"Switch to Russian",primaryNav:"Primary navigation",articleNav:"Documentation sections",latest:"Changes verified for deployed revision",unpublished:"No deployment revision was supplied. Changes are not claimed as live.",awaiting:"Docs are published; no verified application deployment revision has been supplied. Changes are not claimed as live.",source:"Commit",next:"Explore",flow:"How it moves",bounded:"Actions remain bounded by their own rules",current:"Current state"},
  ru: {changelog:"Изменения",home:"Главная",skip:"К содержанию",choose:"Переключить на английский",primaryNav:"Основная навигация",articleNav:"Разделы документации",latest:"Изменения подтверждены для развёрнутой версии",unpublished:"Версия развёртывания не указана. Изменения не объявлены опубликованными.",awaiting:"Документация опубликована, но подтверждённая версия приложения не передана. Изменения не объявлены опубликованными.",source:"Коммит",next:"Разделы",flow:"Как это движется",bounded:"Для каждого действия действуют свои границы",current:"Текущее состояние"}
} as const;
const diagramAssets=new URL("./assets/",import.meta.url);
// Scenes are inlined so they follow the active theme and page fonts; the static SVGs stay the editable export.
const diagram=(name:string,lang:Language,label:string)=>inlineDiagram(readFileSync(new URL(`${name}-${lang}.svg`,diagramAssets),"utf8"),{id:`${name}-${lang}`,label});
type Section = HumanDocsPage["section"];
const sections=Object.keys(navigation) as Section[];
const firstSlug=(section:Section)=>navigation[section][0]!.slugs[0]!;
const url = (lang:Language, slug:string) => `/${lang}/${slug ? slug+"/" : ""}`;
function shell(lang:Language, title:string, description:string, body:string, active?:string, alternateSlug="") {
  const t=labels[lang], other:Language=lang==="en"?"ru":"en";
  const alternate=url(other,alternateSlug);
  const current=url(lang,alternateSlug);
  const links=[...sections,"changelog" as const].map(s=>{
    const destination=s==="changelog"?url(lang,"changelog"):url(lang,firstSlug(s));
    const label=s==="changelog"?t.changelog:sectionLabels[s][lang];
    return {href:destination,label,current:active===s?destination===current?"page" as const:"location" as const:undefined};
  });
  return renderDocument({
    lang,title:`${title} · Kurami docs`,description,favicon:"/assets/favicon.svg",styles:{href:"/assets/docs.css"},themeScript:true,skipLabel:t.skip,
    header:renderSiteHeader({
      brand:{href:url(lang,""),ariaLabel:lang==="ru"?"Kurami docs — главная":"Kurami docs — home",foxSrc:"/assets/fox.png",suffix:"docs"},
      nav:{label:t.primaryNav,links,collapse:{label:lang==="ru"?"Разделы":"Sections"}},
      actions:renderLinkButton({label:other.toUpperCase(),href:alternate,variant:"icon",ariaLabel:t.choose,attributes:{hreflang:other}})+renderThemeSwitch(lang),
    }),
    main:body,mainClass:"page",
    footer:`<footer class="footer"><div class="container">Kurami · ${t.current}</div></footer>`,
  });
}
function steps(items:[string,string][],lang:Language,label:string=labels[lang].flow) {return `<div class="visual"><span class="visual__label">${escape(label)}</span><div class="flow">${items.map(([title,detail],index)=>`<div class="flow__step"><span class="folio">${String(index+1).padStart(2,"0")}</span><strong>${escape(title)}</strong><small>${escape(detail)}</small></div>`).join("")}</div></div>`;}
type ArchitectureKind="project-architecture";
const architectures:Record<ArchitectureKind,Record<Language,{caption:string;steps:[string,string][];outcomes:[string,string][];source:string}>>={
  "project-architecture":{
    en:{caption:"Project Orchestrator · admission to release",steps:[["Status transition","GitHub Project poller records a real change, not the initial snapshot."],["Admission","Event consumer checks the durable transition against policy and capacity."],["Managed run","Controller provisions an isolated worktree and starts Codex."],["Evidence & decision","Exact PR head, CI and owner review; no automatic merge."]],outcomes:[["Verified release","After merge, verified Git ancestry or an exact matching merged PR gates resource cleanup."],["Safe stop","Unclear ownership, dirty work or unmatched published results stay visible for attention."]],source:"docs/technical-reference.md"},
    ru:{caption:"Project Orchestrator · от допуска до завершения",steps:[["Переход статуса","Опрос GitHub Project сохраняет реальное изменение, не первый снимок."],["Допуск","Обработчик событий сверяет сохранённый переход с правилами допуска и лимитами."],["Управляемый запуск","Контроллер создаёт отдельный worktree и запускает Codex."],["Проверки и решение","Точный коммит PR, CI и ревью владельца; автоматического merge нет."]],outcomes:[["Проверенное завершение","После merge доказанная история Git или точно совпадающий слитый PR допускают очистку ресурсов."],["Безопасная остановка","Неясный владелец, незаписанные изменения и несовпадающий опубликованный результат остаются для разбора."]],source:"docs/technical-reference.md"}
  }
};
function architectureMap(kind:ArchitectureKind,lang:Language):string {
  const data=architectures[kind][lang];
  return `<figure class="architecture-map"><figcaption>${escape(data.caption)}</figcaption><ol class="architecture-map__path">${data.steps.map(([title,detail],index)=>`<li><span class="folio">${String(index+1).padStart(2,"0")}</span><strong>${escape(title)}</strong><p>${escape(detail)}</p></li>`).join("")}</ol><div class="architecture-map__outcomes">${data.outcomes.map(([title,detail])=>`<div><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`).join("")}</div><p class="architecture-map__source">${lang==="ru"?"Подробности реализации":"Implementation reference"}: <code>${escape(data.source)}</code></p></figure>`;
}
function rolesMap(lang:Language) {
  const ru=lang==="ru";
  const roles=ru?[
    ["Hermes","Среда агентов, расписания, разговоры и инструменты.","Не владеет продуктовыми правилами и состоянием Курами."],
    ["Курами","Процессы, детерминированные проверки, состояние и действия владельца.","Не обходит собственные проверки и не принимает решения владельца."],
    ["Codex","Допущенная инженерная работа в управляемой ветке и worktree.","Не получает автоматического права на merge, deploy или очистку."],
  ]:[
    ["Hermes","Agent runtime, schedules, conversations and tools.","Does not own Kurami product policy or durable product state."],
    ["Kurami","Workflows, deterministic guards, state and owner controls.","Does not bypass its gates or take decisions reserved for the owner."],
    ["Codex","Admitted engineering work in a managed branch and worktree.","Receives no automatic merge, deploy or cleanup authority."],
  ];
  return `<figure class="roles-map"><figcaption>${ru?"Разные роли, разные полномочия":"Separate roles, separate authority"}</figcaption><div class="roles-map__grid">${roles.map(([title,owns,limit])=>`<div class="roles-map__card"><strong>${escape(title)}</strong><p>${escape(owns)}</p><small>${escape(limit)}</small></div>`).join("")}</div><p class="roles-map__owner"><strong>${ru?"Владелец":"Owner"}</strong> · ${ru?"задаёт намерение и принимает решения, которые автоматике не делегированы":"sets intent and makes decisions that were not delegated to automation"}</p></figure>`;
}
function stateLegend(lang:Language) {
  const ru=lang==="ru";
  const states=ru?[
    ["Актуально","Последнее принятое значение для показанного времени и источника."],
    ["Устарело","Последнее достоверное значение сохранено; свежая проверка не удалась или просрочена."],
    ["Частично","Независимые полезные части прошли проверку, а пробелы показаны явно."],
    ["Сбой","Новый результат не принят; предыдущий успешный результат может остаться доступным."],
    ["Ждёт владельца","Следующее действие не разрешено автоматически или требует разбора неоднозначности."],
    ["Принято","Проверки конкретного продукта пройдены; это не универсальное разрешение на merge или deploy."],
  ]:[
    ["Current","The latest accepted value for the shown time and source."],
    ["Stale","The last trustworthy value remains; a fresh check failed or expired."],
    ["Partial","Independent useful parts passed validation and the gaps stay visible."],
    ["Failed","No new result was accepted; the previous success may remain available."],
    ["Awaiting owner","The next action lacks automatic authority or needs ambiguity resolved."],
    ["Accepted","This product's checks passed; it is not universal merge or deploy approval."],
  ];
  return `<figure class="state-legend"><figcaption>${ru?"Статус описывает один результат, а не всю систему":"A status describes one result, not the whole system"}</figcaption><dl>${states.map(([term,definition],index)=>`<div><dt><span class="folio">${String(index+1).padStart(2,"0")}</span>${escape(term)}</dt><dd>${escape(definition)}</dd></div>`).join("")}</dl></figure>`;
}
type ComparisonKind="comparison"|"weekly-contrast"|"stocks-boundary";
function comparisonMap(kind:ComparisonKind,lang:Language) {
  const ru=lang==="ru";
  const data:Record<ComparisonKind,{caption:string;cards:[string,string][];note:string}>={
    comparison:ru?{caption:"Один Daily, две границы обновления",cards:[["Зафиксировано","Новости, пакет источников, ID и принадлежность сюжетов."],["Может обновляться","Почта, календарь, погода и время последнего успешного чтения."]],note:"Обновление страницы не пересобирает новости и не запускает новый агентный сеанс."}:{caption:"One Daily, two refresh boundaries",cards:[["Frozen","News, source batch, story IDs and ownership."],["May refresh","Mail, calendar, weather and the last successful read time."]],note:"Reloading the page neither rebuilds news nor starts a new agent session."},
    "weekly-contrast":ru?{caption:"Два еженедельных результата",cards:[["Weekly","Агрегация семи завершённых дней; пропуски остаются видимыми."],["Cinema","Отдельный снимок со своими источниками, проверками и публикацией."]],note:"У каждого результата своя дата и состояние; Daily проверяй отдельно."}:{caption:"Two weekly outcomes",cards:[["Weekly","Aggregation of seven completed days; missing observations stay visible."],["Cinema","A separate snapshot with its own sources, validation and promotion."]],note:"Each result has its own date and state; check Daily separately."},
    "stocks-boundary":ru?{caption:"Разные данные и разные полномочия",cards:[["Stocks","Кэш рыночных данных и список наблюдения; без состава портфеля."],["Investment Review","Закрытый анализ подтверждённого состава и датированных источников."]],note:"Ни один процесс не отправляет брокерские заявки."}:{caption:"Different data and authority",cards:[["Stocks","Cached market data and a watchlist; no portfolio holdings."],["Investment Review","Private research from confirmed holdings and dated evidence."]],note:"Neither flow submits brokerage orders."},
  };
  const item=data[kind];
  return `<figure class="comparison-map"><figcaption>${escape(item.caption)}</figcaption><div class="comparison-map__grid">${item.cards.map(([title,detail])=>`<div class="comparison-map__card"><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`).join("")}</div><p class="comparison-map__note">${escape(item.note)}</p></figure>`;
}
function forMeOrder(lang:Language) {
  const ru=lang==="ru";
  const overview=ru?["Критический сюжет · закреплён","Сюжет A","Сюжет B","Сюжет C"]:["Critical story · fixed","Story A","Story B","Story C"];
  const personal=ru?["Критический сюжет · закреплён","Сюжет C · выше по явным реакциям","Сюжет A","Сюжет B"]:["Critical story · fixed","Story C · raised by explicit reactions","Story A","Story B"];
  const list=(title:string,items:string[])=>`<div class="order-map__column"><strong>${escape(title)}</strong><ol>${items.map(item=>`<li>${escape(item)}</li>`).join("")}</ol></div>`;
  return `<figure class="order-map"><figcaption>${ru?"Те же сюжеты, ограниченно изменённый порядок":"The same stories in a bounded different order"}</figcaption><div class="order-map__grid">${list(ru?"Обзор":"Overview",overview)}${list(ru?"Для меня":"For me",personal)}</div><p>${ru?"Чтение и время на странице не меняют порядок. Только явные реакции становятся evidence.":"Reading and time on page do not change the order. Only explicit reactions become evidence."}</p></figure>`;
}
function admissionMap(lang:Language) {
  const ru=lang==="ru";
  const statuses=ru?[
    ["PASS","Обязательный факт подтверждён и согласован."],
    ["WARN","Подключение возможно, но ограничение нужно понимать."],
    ["FAIL","Подключение заблокировано до исправления контракта."],
  ]:[
    ["PASS","A required fact is present and internally consistent."],
    ["WARN","Compatibility remains possible, with a known limitation."],
    ["FAIL","Onboarding is blocked until the contract is corrected."],
  ];
  const gates=ru?[
    ["Реальный переход","Статус изменился после исходного снимка."],
    ["Подходящая задача","Issue открыта, имеет описание и соответствует правилам."],
    ["Свободная ёмкость","Общие и проектные WIP-лимиты допускают запуск."],
    ["Безопасные ресурсы","Worktree, диск и ownership проходят проверки."],
  ]:[
    ["Real transition","Status changed after the initial observation."],
    ["Eligible issue","The issue is open, described and allowed by policy."],
    ["Available capacity","Global and project WIP limits admit the run."],
    ["Safe resources","Worktree, disk and ownership guards pass."],
  ];
  return `<figure class="admission-map"><figcaption>${ru?"Совместимость проекта не равна допуску задачи":"Project compatibility is not run admission"}</figcaption><div class="admission-map__status">${statuses.map(([title,detail])=>`<div><strong>${title}</strong><p>${escape(detail)}</p></div>`).join("")}</div><ol class="admission-map__gates">${gates.map(([title,detail],index)=>`<li><span class="folio">${String(index+1).padStart(2,"0")}</span><strong>${escape(title)}</strong><p>${escape(detail)}</p></li>`).join("")}</ol><p class="admission-map__note">${ru?"Проверка готовности ничего не меняет. Запуск появляется только после отдельного допуска сохранённого события.":"The readiness check changes nothing. A run exists only after the durable event passes separate admission."}</p></figure>`;
}
function projectDigestMap(lang:Language) {
  const ru=lang==="ru";
  const paths=ru?[
    ["Факты и рекомендация","Снимок Project → детерминированный порядок подходящих Issue → одна текущая карточка.","Без изменения полей и запуска работы."],
    ["Необязательные предложения","Ограниченная AI-оценка → решение владельца → повторная проверка поля перед записью.","Принятие не перезаписывает изменение владельца."],
  ]:[
    ["Facts and suggestion","Project snapshot → deterministic order of eligible Issues → one current card.","No field edit or run start."],
    ["Optional proposals","Bounded AI assessment → owner decision → fresh field check before a write.","Acceptance does not overwrite an owner change."],
  ];
  return `<figure class="project-digest-map"><figcaption>${ru?"Две ветки одной карточки, разные полномочия":"One card, two paths with different authority"}</figcaption><div class="project-digest-map__paths">${paths.map(([title,path,limit])=>`<div><strong>${escape(title)}</strong><p>${escape(path)}</p><small>${escape(limit)}</small></div>`).join("")}</div></figure>`;
}
function evidenceMap(lang:Language) {
  const ru=lang==="ru";
  const cards=ru?[
    ["CI","Точный head SHA управляемого PR","Обязательные проверки известны и пройдены","Не разрешает merge"],
    ["AI review","Явно запрошенный анализ конкретного SHA","Замечания и результат review сохранены","Не принимает работу за владельца"],
    ["Preview","Чистый и проверенный head SHA","Временный результат доступен для просмотра","Не является deploy"],
  ]:[
    ["CI","Exact head SHA of the managed PR","Required checks are known and passing","Does not authorize merge"],
    ["AI review","Explicitly requested analysis of one SHA","Findings and review outcome are recorded","Does not accept work for the owner"],
    ["Preview","Clean, verified head SHA","A temporary result is available to inspect","Is not a deployment"],
  ];
  return `<figure class="project-cards"><figcaption>${ru?"Три независимых вида evidence для одного результата":"Three independent kinds of evidence for one result"}</figcaption><div class="project-cards__grid">${cards.map(([title,subject,meaning,limit])=>`<div class="project-cards__card"><strong>${escape(title)}</strong><dl><dt>${ru?"Предмет":"Subject"}</dt><dd>${escape(subject)}</dd><dt>${ru?"Подтверждает":"Shows"}</dt><dd>${escape(meaning)}</dd></dl><small>${escape(limit)}</small></div>`).join("")}</div></figure>`;
}
function controlsMap(lang:Language) {
  const ru=lang==="ru";
  const facts=ru?[["Этап","Human Review · writer освобождён"],["CI","Failed · вымышленный SHA B"],["AI review","Не запрошен"],["Preview","Не запущен"]]:[["Stage","Human Review · writer released"],["CI","Failed · invented SHA B"],["AI review","Not requested"],["Preview","Not running"]];
  return `<figure class="sample-run-card"><figcaption>${ru?"Вымышленная карточка Discord, не снимок действующего запуска":"Synthetic Discord card, not a live run screenshot"}</figcaption><div class="sample-run-card__window"><div class="sample-run-card__header"><strong>${ru?"Пример задачи · текущая карточка":"Example issue · current dashboard"}</strong><small>${ru?"Последнее сообщение бота в thread":"Latest bot message in the thread"}</small></div><dl>${facts.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("")}</dl><p class="sample-run-card__links">${ru?"Ссылки: Issue · PR · Codex":"Links: Issue · PR · Codex"}</p><div class="sample-run-card__action"><strong>Attempt CI fix</strong><p>${ru?"Возможное действие только при подходящем состоянии ревью и подтверждённом сбое CI.":"A possible action only in an eligible review state with a verified CI failure."}</p></div></div><p class="sample-run-card__note">${ru?"Карточка показывает состояние и допустимое действие. Запрос, выполнение и итог — разные события.":"The card shows state and an eligible action. Request, execution and result are separate events."}</p></figure>`;
}
function healthMap(lang:Language) {
  const ru=lang==="ru";
  const system=ru?[["CPU","86% · 5 сек"],["RAM","52%"],["Сеть","online"],["Диск","41%"]]:[["CPU","86% · 5s"],["RAM","52%"],["Network","online"],["Disk","41%"]];
  const runtime=ru?[["State DB","healthy"],["Previews","1 active"],["Backup","current"]]:[["State DB","healthy"],["Previews","1 active"],["Backup","current"]];
  const rows=(items:string[][])=>items.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join("");
  return `<figure class="health-map"><figcaption>${ru?"Вымышленная карточка System Health — не снимок действующего узла":"Synthetic System Health card — not a live host screenshot"}</figcaption><div class="health-map__card"><div class="health-map__heading"><strong>Kurami System Health</strong><span>${ru?"Одна проверка требует внимания":"One check needs attention"}</span></div><div class="health-map__groups"><section><h3>${ru?"Узел":"System"}</h3><dl>${rows(system)}</dl></section><section><h3>Project Orchestrator</h3><dl>${rows(runtime)}</dl></section></div><p class="health-map__recent">${ru?"Недавние проверки: до 10 снимков · время проверки показано в настоящей карточке":"Recent health runs: up to 10 snapshots · the real card shows the check time"}</p></div><p class="health-map__note">${ru?"Карточка может показать проблему до отправки Alerts. Health не удаляет ресурсы.":"The card can show a problem before Alerts sends a message. Health does not delete resources."}</p></figure>`;
}
function scheduleEvidence(lang:Language){
  const ru=lang==="ru";
  const stages=ru?[["01","Триггер","Hermes вызвал задание или пришло изменение источника."],["02","Попытка","Процесс проверил допустимость и записал собственное состояние."],["03","Результат","Ищи выпуск, карточку, run или проверенную копию."]]:[["01","Trigger","Hermes invoked a job or a source changed."],["02","Attempt","The workflow checked its guards and recorded its state."],["03","Outcome","Look for an edition, card, run or verified backup."]];
  return `<figure class="schedule-evidence"><figcaption>${ru?"Три разных факта, не один статус успеха":"Three different facts, not one success state"}</figcaption><ol>${stages.map(([number,title,detail])=>`<li><span class="folio">${number}</span><strong>${escape(title)}</strong><p>${escape(detail)}</p></li>`).join("")}</ol></figure>`;
}
function maintenanceScope(lang:Language){
  const ru=lang==="ru";
  const permitted=ru?["Старые логи допустимых типов","Неиспользуемые образы Docker","Builder cache сверх лимита"]:["Old logs of allowed types","Unused Docker images","Builder cache above its ceiling"];
  const preserved=ru?["Контейнеры и volumes","Worktrees и preview runtimes","Неясные leases и ресурсы"]:["Containers and volumes","Worktrees and preview runtimes","Ambiguous leases and resources"];
  const column=(title:string,items:string[],kind:string)=>`<div class="maintenance-scope__column maintenance-scope__column--${kind}"><strong>${escape(title)}</strong><ul>${items.map(item=>`<li>${escape(item)}</li>`).join("")}</ul></div>`;
  return `<figure class="maintenance-scope"><figcaption>${ru?"Штатная уборка имеет короткий список целей":"Routine cleanup has a short target list"}</figcaption><div class="maintenance-scope__grid">${column(ru?"Может удалить":"May remove",permitted,"remove")}${column(ru?"Сохраняет":"Preserves",preserved,"keep")}</div><p>${ru?"Проверка Health ничего не удаляет; для неоднозначного запуска требуется отдельное решение.":"Health inspection deletes nothing; an ambiguous run needs a separate decision."}</p></figure>`;
}
function connectorContours(lang:Language){
  const ru=lang==="ru";
  const contours=ru?[["composio-read","Фоновое чтение","Только read-only leaf без одобрения."],["composio-automation","Проверенный эффект","Точные leaf tools и правила аргументов."],["composio","Действие владельца","Запись требует одобрения; не fallback."]]:[["composio-read","Unattended reading","Only read-only leaf tools bypass approval."],["composio-automation","Reviewed side effect","Exact leaf tools plus argument policy."],["composio","Owner-directed work","Write calls need approval; never a fallback."]];
  return `<figure class="connector-contours"><figcaption>${ru?"Три контура — три уровня полномочий":"Three contours, three authority levels"}</figcaption><dl>${contours.map(([name,use,limit])=>`<div><dt><code>${escape(name)}</code></dt><dd><strong>${escape(use)}</strong><span>${escape(limit)}</span></dd></div>`).join("")}</dl></figure>`;
}
function recoveryMatrix(lang:Language) {
  const ru=lang==="ru";
  const rows=ru?[
    ["Версионный код","Закрытый Git","Исходники, миграции, тесты и конфигурация без секретов.","Не содержит runtime state и учётные данные."],
    ["Состояние","Проверенная копия","SQLite, конфигурация и манифесты целостности.","Обычная копия намеренно исключает секреты."],
    ["Минимальный DR","Зашифрованная внешняя копия","Проверенный снимок и выбранные данные восстановления.","Работает только когда включён и подтверждён удалённый объект."],
    ["Временное и внешнее","Пересоздание и сверка","Сервисы, clones и внешние control planes восстанавливает оператор.","Worktrees, Codex sessions, Docker data, логи и временные ID не копируются."],
  ]:[
    ["Versioned code","Private Git","Source, migrations, tests and non-secret deployment configuration.","Does not contain runtime state or credentials."],
    ["Durable state","Verified backup","SQLite, configuration and integrity manifests.","The ordinary backup intentionally excludes secrets."],
    ["Minimal DR","Encrypted off-site copy","A verified snapshot and selected recovery inputs.","Exists only when enabled and the remote object is verified."],
    ["Transient and external","Rebuild and reconcile","Services, clones and external control planes are restored by the operator.","Worktrees, Codex sessions, Docker data, logs and transient IDs are not copied."],
  ];
  return `<figure class="recovery-matrix"><figcaption>${ru?"Что восстанавливается и откуда":"What can be recovered, and from where"}</figcaption><div class="recovery-matrix__rows">${rows.map(([subject,source,includes,limit])=>`<div class="recovery-matrix__row"><strong>${escape(subject)}</strong><dl><div><dt>${ru?"Источник":"Source"}</dt><dd>${escape(source)}</dd></div><div><dt>${ru?"Покрывает":"Covers"}</dt><dd>${escape(includes)}</dd></div><div><dt>${ru?"Граница":"Limit"}</dt><dd>${escape(limit)}</dd></div></dl></div>`).join("")}</div></figure>`;
}
function boundaryMap(lang:Language) {
  const ru=lang==="ru";
  const cards=ru?[
    ["Digest по расписанию","Проверить время и повторы; собрать, проверить и опубликовать собственный результат.","Не получает общего права переписывать выпуск или действовать в другом продукте."],
    ["Project Orchestrator","Допустить подходящую работу в лимитах; вести run и собирать evidence.","Не делает merge, deploy приложения и удаление неоднозначных ресурсов."],
    ["Operations","Наблюдать, сообщать, создавать проверенные копии и записывать quarantine state.","Health и Resource Guard не чинят и не удаляют внешние ресурсы сами."],
  ]:[
    ["Scheduled Digest","Apply time and duplicate gates; collect, validate and promote its own result.","Receives no general right to rewrite an edition or act in another product."],
    ["Project Orchestrator","Admit eligible work within limits; manage a run and collect evidence.","Does not merge, deploy application code or delete ambiguous resources."],
    ["Operations","Observe, notify, create verified backups and record quarantine state.","Health and Resource Guard do not repair or delete external resources."],
  ];
  return `<figure class="boundary-map"><figcaption>${ru?"Триггер запускает один ограниченный процесс":"A trigger starts one bounded workflow"}</figcaption><div class="boundary-map__grid">${cards.map(([title,allowed,denied])=>`<div class="boundary-map__card"><strong>${escape(title)}</strong><dl><dt>${ru?"Можно":"May"}</dt><dd>${escape(allowed)}</dd><dt>${ru?"Не делегировано":"Not delegated"}</dt><dd>${escape(denied)}</dd></dl></div>`).join("")}</div><p>${ru?"Текст задач и данные источников считаются данными, а не командами. Неоднозначность сохраняется для владельца.":"Issue text and provider content are data, not instructions. Ambiguity is preserved for the owner."}</p></figure>`;
}
type DigestMapKind="signals-gates"|"weekly-evidence"|"cinema-states"|"stocks-data"|"discovery-screen"|"review-acceptance";
function digestMap(kind:DigestMapKind,lang:Language):string {
  const ru=lang==="ru";
  const data:Record<DigestMapKind,{caption:string;items:[string,string][];steps?:boolean}>={
    "signals-gates":ru?{caption:"Уведомление появляется только после всех проверок",items:[["Дата","Это Daily за текущий локальный день."],["Источник","Значение принято и ещё свежее."],["Правило","Факт проходит порог, приоритет и срок действия."]]}:{caption:"A notice needs all three checks",items:[["Date","This is the current local-date Daily."],["Source","The value is accepted and still fresh."],["Rule","The fact passes threshold, priority and expiry."]]},
    "weekly-evidence":ru?{caption:"От наблюдения к обзору",steps:true,items:[["Сохранить","Компактные счётчики и даты без содержания писем."],["Собрать","Семь завершённых дней; пропуски не равны нулю."],["Опубликовать","Только проверенный обзор; прежний результат сохраняется при сбое."]]}:{caption:"From observation to review",steps:true,items:[["Observe","Compact counters and dates, not mail content."],["Aggregate","Seven completed dates; missing is not zero."],["Promote","Validated review only; failure keeps the previous result."]]},
    "cinema-states":ru?{caption:"От четырёх блоков к одной странице",steps:true,items:[["Собрать","Прокат, трейлеры, премьеры и новости имеют разные источники и периоды."],["Проверить","Состояние каждого блока и общие данные, даты, источники, медиа."],["Решить","Принять весь снимок или сохранить прошлую успешную страницу."]]}:{caption:"Four sections, one page decision",steps:true,items:[["Collect","Box office, trailers, premieres and news have separate sources and windows."],["Validate","Each section’s state plus shared identity, dates, sources and media."],["Decide","Promote the whole snapshot or keep the last successful page."]]},
    "stocks-data":ru?{caption:"Три разных вопроса к строке Stocks",items:[["Цена","Сырое закрытие и валюта за указанную сессию."],["Изменение","Сравнение скорректированных закрытий; без истории недоступно."],["Свежесть","Принятая дата, устаревшее или отсутствующее значение."]]}:{caption:"Three questions for a Stocks row",items:[["Price","Raw close and currency for a named session."],["Return","Adjusted-close comparison; unavailable without history."],["Freshness","Accepted date, stale value or no trustworthy value."]]},
    "discovery-screen":ru?{caption:"Проверка кандидата",steps:true,items:[["Короткий список","Источник движений; не весь рынок."],["Сверка","Идентичность, дата, цена и объём в независимой истории."],["Карточка","Не больше трёх; без покупки и добавления в watchlist."]]}:{caption:"Candidate screening",steps:true,items:[["Shortlist","Mover source, not the whole market."],["Cross-check","Identity, date, price and volume against independent history."],["Card","At most three; no buy or watchlist mutation."]]},
    "review-acceptance":ru?{caption:"Частный анализ → принятый результат",steps:true,items:[["Вход","Подтверждённый состав и свежие котировки."],["Данные","Датированные источники, расчёты и охват."],["Принятие","Проверенный черновик; отдельные Week и Month."]]}:{caption:"Private research → accepted output",steps:true,items:[["Input","Confirmed holdings and current quotes."],["Evidence","Dated sources, calculations and coverage."],["Acceptance","Validated draft; separate Week and Month slots."]]},
  };
  const item=data[kind];
  const entries=item.items.map(([title,detail],index)=>item.steps?`<li><span class="folio">0${index+1}</span><strong>${escape(title)}</strong><p>${escape(detail)}</p></li>`:`<div><dt>${escape(title)}</dt><dd>${escape(detail)}</dd></div>`).join("");
  return `<figure class="digest-map"><figcaption>${escape(item.caption)}</figcaption>${item.steps?`<ol class="digest-map__steps">${entries}</ol>`:`<dl class="digest-map__matrix">${entries}</dl>`}</figure>`;
}
function visual(kind:VisualId,lang:Language):string {
  if(kind==="home-map") return systemMap(lang);
  if(kind==="daily-publication") return `<figure class="scene-map"><figcaption>${lang==="ru"?"Публикация и два пути восстановления":"Publication and two recovery paths"}</figcaption>${diagram("daily-publication",lang,lang==="ru"?"Одна попытка Daily проходит сбор и проверку, технический этап, публикацию и уведомление. Сбой до публикации возобновляет ту же попытку без нового пакета News; сбой уведомления сохраняет выпуск и повторяет только уведомление.":"One Daily attempt passes capture and validation, technical work, publication and notification. Failure before publication resumes that attempt without a new News batch; notification failure keeps the edition and retries only notification.")}<p>${lang==="ru"?"Критерий завершения — опубликованный выпуск и сохранённое подтверждение уведомления.":"Completion requires a published edition and a durable notification receipt."}</p></figure>`;
  if(kind==="project-run-state") return `<figure class="scene-map"><figcaption>${lang==="ru"?"После допуска: запуск, ревью и безопасная остановка":"After admission: work, review and safe stop"}</figcaption>${diagram("project-run-state",lang,lang==="ru"?"Допущенный запуск планирует ресурсы, затем создаёт отдельный worktree и получает одного управляемого writer Codex. После освобождения CLI он готов к ревью. Done или Cancel запускают остановку; точное доказательство разрешает очистку, а неоднозначная работа сохраняется для разбора. Отменить можно и до ревью.":"An admitted run plans resources, then provisions an isolated worktree and claims one managed Codex writer. After CLI ownership is released it becomes review-ready. Done or Cancel starts stopping; exact proof permits release, while ambiguous work stays for attention. Cancellation can also bypass review.")}<p>${lang==="ru"?"Состояние Review-ready требует освобождения CLI; Done не равен немедленному удалению. Левая ветка ведёт от активной работы к отмене без ревью, правая — от остановки к сохранению неоднозначного результата.":"Review-ready requires CLI release; Done does not delete resources. The left branch cancels active work without review; the right branch preserves an ambiguous stop for the owner."}</p></figure>`;
  if(kind==="signals-gates"||kind==="weekly-evidence"||kind==="cinema-states"||kind==="stocks-data"||kind==="discovery-screen"||kind==="review-acceptance") return digestMap(kind,lang);
  if(kind==="system-architecture") return `<figure class="scene-map"><figcaption>${lang==="ru"?"Два входа, три отдельных процесса":"Two ways to start, three separate workflows"}</figcaption>${diagram("system-map",lang,lang==="ru"?"Работа начинается с запроса владельца через Discord и Hermes либо с расписания или новых данных. Правила Курами направляют её в Digest, Project Orchestrator или Operations. У каждого процесса своё состояние; Discord может показать результат и доступные действия.":"Work starts with an owner request through Discord and Hermes, or with a schedule or new source data. Kurami rules direct it to Digest, Project Orchestrator or Operations. Each workflow keeps its own state; Discord can show results and available controls.")}<p>${lang==="ru"?"Стрелки показывают возможные пути, а не обязательную цепочку. Ни один путь не разрешает автоматический merge или deploy приложения.":"The arrows show possible routes, not a required pipeline. None grants automatic merge or application deployment."}</p></figure>`;
  if(kind==="project-path") return `<figure class="scene-map"><figcaption>${lang==="ru"?"Кто что делает в инженерной задаче":"Who does what in an engineering task"}</figcaption>${diagram("project-path",lang,lang==="ru"?"Ты переводишь задачу в работу. Hermes запускает опрос доски, и Курами замечает переход. Допуск проверяет задачу, описание, лимиты и ресурсы, контроллер создаёт ветку и рабочую копию. Codex пишет код и открывает PR, Курами связывает CI и ревью с точным коммитом. Ты смотришь PR и решаешь, сливать ли его.":"You move an issue into active work. Hermes runs the board poll and Kurami sees the change. Admission checks the issue, description, limits and resources; the controller creates a branch and worktree. Codex writes code and opens a PR; Kurami ties CI and review to the exact commit. You review the PR and decide whether to merge.")}</figure>`;
  if(kind==="roles") return rolesMap(lang);
  if(kind==="state-legend") return stateLegend(lang);
  if(kind==="comparison"||kind==="weekly-contrast"||kind==="stocks-boundary") return comparisonMap(kind,lang);
  if(kind==="for-me-order") return forMeOrder(lang);
  if(kind==="project-admission") return admissionMap(lang);
  if(kind==="project-digest") return projectDigestMap(lang);
  if(kind==="engineering-evidence") return evidenceMap(lang);
  if(kind==="owner-controls") return controlsMap(lang);
  if(kind==="health-map") return healthMap(lang);
  if(kind==="schedule-evidence") return scheduleEvidence(lang);
  if(kind==="recovery-topology") return `<figure class="scene-map"><figcaption>${lang==="ru"?"Топология восстановления: источники, проверка и исключения":"Recovery topology: sources, verification and exclusions"}</figcaption>${diagram("recovery-topology",lang,lang==="ru"?"Код из Git и проверенная локальная копия состояния могут войти в восстановление. Если включён внешний архив, он создаётся из проверенной копии и выбранных данных, затем сверяется после выгрузки. На новом узле состояние возвращают явно, внешние сервисы пересоздают. Worktrees, Codex sessions и Docker data не копируются.":"Git code and a verified local state backup can enter a restore. If enabled, an encrypted off-site bundle is built from the verified backup and selected inputs, then checked after upload. On a new host, state is restored explicitly and external services are rebuilt. Worktrees, Codex sessions and Docker data are not copied.")}<p>${lang==="ru"?"Стрелки показывают возможные источники, а не автоматическое продолжение старых запусков.":"The arrows show possible sources, not automatic continuation of old runs."}</p></figure>`;
  if(kind==="maintenance-scope") return maintenanceScope(lang);
  if(kind==="connector-contours") return connectorContours(lang);
  if(kind==="recovery-matrix") return recoveryMatrix(lang);
  if(kind==="automation-boundaries") return boundaryMap(lang);
  if(kind==="project-architecture") return architectureMap(kind,lang);
  const data:Record<string,Record<Language,[string,string][]>>={
    "ui-layers":{
      ru:[["Тема","Роли цветов и формы: «основной текст», «акцент», «рамка», скругление, тень. Светлый и тёмный режим."],["Основа","Шрифты, заметный фокус для клавиатуры, ссылка «К содержанию», ширина страницы."],["Компоненты","Кнопки, переключатель темы, таблицы, врезки, раскрывающиеся блоки."],["Шаблоны","Шапка с лисой и навигацией, каркас всей страницы."],["Страницы","Digest, эта документация и будущие разделы: только своя раскладка и своё содержимое."]],
      en:[["Theme","Colour and shape roles: primary text, accent, border, radius, shadow. Light and dark modes."],["Foundations","Fonts, a visible keyboard focus, the skip link, page width."],["Components","Buttons, the theme switch, tables, callouts, disclosures."],["Patterns","The fox header with navigation and the whole-page shell."],["Pages","Digest, these docs and future sections add only their own layout and content."]],
    },
    "project-flow":{en:[["Queued","Durable Project transition"],["Admitted","Policy and capacity passed"],["Active","Managed worktree and Codex"],["Parked","Review or owner attention"],["Stopping","Merge or cancellation evidence"],["Released","Only after exact cleanup proof"]],ru:[["В очереди","Сохранённый переход Project"],["Допущен","Правила и лимиты пройдены"],["В работе","Управляемые worktree и Codex"],["Остановлен","Review или решение владельца"],["Завершение","Проверка merge или отмены"],["Освобождён","Только после точного доказательства очистки"]]},
  };
  if(!data[kind])throw new Error(`Unknown docs visual: ${kind}`);
  const stepLabels:Partial<Record<string,Record<Language,string>>>={"ui-layers":{ru:"Слои библиотеки",en:"Library layers"}};
  return steps(data[kind][lang],lang,stepLabels[kind]?.[lang]);
}
function systemMap(lang:Language) {
  const ru=lang==="ru";
  const paths=ru?[
    ["Диалог и решения","Владелец → Discord → Hermes. Агент работает с разрешёнными инструментами внутри процесса Курами."],
    ["Расписания и источники","Таймеры и внешние данные запускают ограниченный сбор, проверки и обновления без нового сообщения."],
  ]:[
    ["Conversation and decisions","Owner → Discord → Hermes. The agent uses allowed tools inside a Kurami workflow."],
    ["Schedules and sources","Timers and external data start bounded collection, validation and refresh without a new message."],
  ];
  const products=ru?[
    ["Digest","Выпуски, обзоры и явно отмеченная свежесть данных."],
    ["Project Orchestrator","Инженерные запуски, Git evidence и управление владельца."],
    ["Operations","Здоровье системы, резервные копии и восстановление."],
  ]:[
    ["Digest","Editions, reviews and explicit data freshness."],
    ["Project Orchestrator","Engineering runs, Git evidence and owner control."],
    ["Operations","System health, backups and recovery."],
  ];
  return `<figure class="system-map"><figcaption>${ru?"Два входных пути, отдельные процессы и видимый результат":"Two entry paths, separate workflows and visible outcomes"}</figcaption><div class="system-map__paths">${paths.map(([title,detail],index)=>`<div class="system-map__path"><span class="folio">0${index+1}</span><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`).join("")}</div><div class="system-map__junction"><strong>${ru?"Курами: правила, проверки и долговременное состояние":"Kurami: policy, gates and durable state"}</strong><p>${ru?"Каждый процесс допускает только разрешённое действие и сохраняет собственные подтверждения.":"Each workflow admits only allowed actions and records its own evidence."}</p></div><div class="system-map__products">${products.map(([title,detail])=>`<div><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`).join("")}</div><div class="system-map__evidence"><strong>${ru?"Результат":"Outcome"}</strong><p>${ru?"Показан результат, явный сбой или ожидание владельца. Состояния разных продуктов не смешиваются.":"The system shows a result, a visible failure or an owner decision. Product state machines remain separate."}</p></div><div class="system-map__owner"><strong>${ru?"Решение владельца":"Owner decision"}</strong><p>${ru?"Принять, направить, остановить или разрешить действие, которое не было делегировано автоматике.":"Accept, steer, stop or authorize an action that was not delegated to automation."}</p></div></figure>`;
}
function side(lang:Language,active:string) {
  const link=(slug:string)=>{
    const page=pages.find(item=>item.slug===slug);
    if(!page)throw new Error(`Missing navigation route: ${slug}`);
    return `<li><a href="${url(lang,slug)}"${active===slug?' aria-current="page"':''}>${escape(page.navTitle[lang])}</a></li>`;
  };
  const section=groupOf(active)?.section??pages.find(page=>page.slug===active)?.section;
  const items=section
    ?`<p class="side__section">${escape(sectionLabels[section][lang])}</p>${navigation[section].map(group=>`<div class="side-group"><h3>${escape(group.heading[lang])}</h3><ul>${group.slugs.map(link).join("")}</ul></div>`).join("")}`
    :`<p class="side__section">${lang==="ru"?"Разделы":"Sections"}</p><div class="side-group"><ul>${sections.map(item=>`<li><a href="${url(lang,firstSlug(item))}">${escape(sectionLabels[item][lang])}</a></li>`).join("")}</ul></div>`;
  return `<nav class="side" aria-label="${labels[lang].articleNav}">${items}</nav><details class="side-mobile"><summary>${section?escape(sectionLabels[section][lang]):labels[lang].next}</summary><nav aria-label="${labels[lang].articleNav}">${items}</nav></details>`;
}
function safeBlocks(page:HumanDocsPage,lang:Language,sourceSha?:string,deployed=false) {
  return page.blocks.map(block=>{
    if(block.type==="source-links")return sourceNotes(block.paths,lang,sourceSha,deployed);
    if(block.type==="diagram")return `<section class="block diagram-block">${visual(block.visual,lang)}<p class="diagram-block__explanation">${escape(block.explanation[lang])}</p></section>`;
    if(block.type==="table")return `<section class="block">${renderTable({caption:block.caption[lang],columns:block.columns[lang],rows:block.rows[lang],rowHeaders:true,stack:true})}</section>`;
    if(block.type==="screenshot")return `<figure class="block screenshot"><img src="/assets/${escape(block.file)}" alt="${escape(block.alt[lang])}" loading="lazy" decoding="async"><figcaption>${escape(block.caption[lang])}</figcaption></figure>`;
    if(block.type==="callout")return renderCallout({tone:block.tone,title:block.title[lang],body:block.body[lang],className:"block"});
    if(block.type==="example")return `<section class="block example"><p class="example__label">${lang==="ru"?"Вымышленный пример":"Synthetic example"}</p><h2>${escape(block.title[lang])}</h2><p>${escape(block.body[lang])}</p></section>`;
    if(block.type==="technical")return `<section class="block">${renderDisclosure({summary:block.summary[lang],body:`<p>${escape(block.body[lang])}</p>${block.code?`<pre><code>${escape(block.code[lang])}</code></pre>`:""}`,boxed:true,className:"technical"})}</section>`;
    const raw=block[lang];
    assertSafeMarkup(raw,`${page.slug}/${lang}`);
    if(block.type==="details")return `<section class="block">${renderDisclosure({summary:block.summary[lang],body:raw,boxed:true})}</section>`;
    return `<section class="block">${block.visual?visual(block.visual,lang):""}${raw}</section>`;
  }).join("");
}
function sourceNotes(paths:readonly string[],lang:Language,sourceSha?:string,deployed=false){
  if(!paths.length||!sourceSha)return "";
  if(!/^[0-9a-f]{40}$/.test(sourceSha))throw new Error("Invalid docs source revision");
  const links=paths.map(path=>{
    assertSourcePath(path);
    return `<li><a href="https://github.com/Shagon1k/kurami/blob/${sourceSha}/${path}">${escape(path)}</a></li>`;
  }).join("");
  const note=deployed?(lang==="ru"?"Исходники на подтверждённой версии приложения":"Source at the verified application revision"):(lang==="ru"?"Исходники на указанной версии Git; это не доказательство развёртывания приложения":"Repository source at the cited revision; this does not prove application deployment");
  return `<aside class="source-notes" aria-label="${lang==="ru"?"Проверяемые источники":"Source references"}"><h2>${lang==="ru"?"Проверить в репозитории":"Check in the repository"}</h2><p>${note} · <code>${sourceSha.slice(0,12)}</code></p><ul>${links}</ul></aside>`;
}
function nextLink(page:HumanDocsPage,lang:Language):string {
  const next=page.next?pages.find(item=>item.slug===page.next):undefined;
  if(!next)return "";
  return `<nav class="next-page" aria-label="${lang==="ru"?"Следующая страница":"Next page"}"><span>${lang==="ru"?"Дальше":"Next"}</span><a href="${url(lang,next.slug)}"><strong>${escape(next.title[lang])}</strong><small>${escape(next.summary[lang])}</small></a></nav>`;
}
export function renderArticle(page:HumanDocsPage,lang:Language,sourceSha?:string,deployed=false) {
  const active=page.section;
  const inlineSources=page.blocks.some(block=>block.type==="source-links");
  const body=`<div class="layout">${side(lang,page.slug)}<article class="article" data-page="${escape(page.slug)}"><header class="intro"><p class="eyebrow">${escape([sectionLabels[active][lang],groupOf(page.slug)?.group.heading[lang]].filter(Boolean).join(" · "))}</p><h1>${escape(page.title[lang])}</h1><p class="lede">${escape(page.summary[lang])}</p></header>${safeBlocks(page,lang,sourceSha,deployed)}${nextLink(page,lang)}${inlineSources?"":sourceNotes(page.sources??[],lang,sourceSha,deployed)}</article></div>`;
  return shell(lang,page.title[lang],page.summary[lang],body,active,page.slug);
}
export function renderHome(lang:Language) {
  const ru=lang==="ru", title=ru?"Курами — личная агентная система":"Kurami — a private agent system";
  const description=ru?"Разговоры и явные решения превращаются в ограниченные по правилам действия. Видно, что сделано и что ждёт твоего решения.":"Conversations and explicit decisions become bounded actions. See what ran and what awaits your decision.";
  const routes=sections.map(section=>{
    const page=pages.find(p=>p.slug===firstSlug(section))!;
    return `<a class="route" href="${url(lang,page.slug)}"><div><p class="folio">${escape(sectionLabels[section][lang])}</p><h2>${escape(page.title[lang])}</h2><p>${escape(page.summary[lang])}</p></div><span class="arrow" aria-hidden="true">↗</span></a>`;
  }).join("");
  return shell(lang,title,description,`<div class="intro"><p class="eyebrow">${ru?"Система, не один сайт":"A system, not a single site"}</p><h1>${title}</h1><p class="lede">${description}</p>${systemMap(lang)}</div><section aria-label="${labels[lang].next}" class="sections">${routes}</section>`);
}
export function renderChangelog(lang:Language,changes:Change[],revision?:string,published=false) {
  const ru=lang==="ru";
  const t=labels[lang], title=t.changelog;
  const groups=new Map<string,Change[]>();
  for(const change of changes) groups.set(change.date,[...(groups.get(change.date)??[]),change]);
  const categories={en:{new:"New",improved:"Improved",fixed:"Fixed",operations:"Operations"},ru:{new:"Новое",improved:"Улучшено",fixed:"Исправлено",operations:"Эксплуатация"}};
  const cards=[...groups].map(([date,items])=>`<section class="change-day"><h2>${escape(date)}</h2>${items.map(c=>`<div class="change"><span class="change__category">${categories[lang][c.category]}</span><a href="https://github.com/Shagon1k/kurami/commit/${c.sha}" rel="noopener noreferrer">${t.source} ${c.sha.slice(0,7)}</a><p>${escape(c.copy)}</p>${c.page?`<a href="${url(lang,c.page)}">${ru?"Открыть страницу":"Read the page"} ↗</a>`:""}</div>`).join("")}</section>`).join("");
  const status=revision
    ? `${t.latest}. ${ru?"Даты в списке — дни коммитов, не дни развёртывания.":"List dates are commit days, not deployment days."}`
    : published?t.awaiting:t.unpublished;
  const empty=revision
    ? ru?"После начальной точки пока нет опубликованных изменений.":"No published changes since the baseline."
    : published
      ? ru?"Этот docs-only release не приписывает себе изменения приложения.":"This docs-only release claims no application changes."
      : ru?"Локальный preview намеренно оставляет changelog приложения пустым.":"The local preview deliberately leaves the application changelog empty.";
  const body=`<div class="layout">${side(lang,"")}<article class="article"><header class="intro"><p class="eyebrow">${revision?escape(revision.slice(0,7)):published?ru?"Ожидает подтверждения":"Awaiting verification":ru?"Локальный просмотр":"Local preview"}</p><h1>${title}</h1><p class="lede">${status}</p></header><div class="changes">${cards||`<p>${empty}</p>`}</div></article></div>`;
  return shell(lang,title,status,body,"changelog","changelog");
}
