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
type ArchitectureKind="daily-architecture"|"project-architecture";
const architectures:Record<ArchitectureKind,Record<Language,{caption:string;steps:[string,string][];outcomes:[string,string][];source:string}>>={
  "daily-architecture":{
    en:{caption:"Daily · publication and refresh",steps:[["Scheduled attempt","One durable attempt for the local edition date."],["Capture","Source batch is persisted and validated."],["Publish","Edition and news snapshot become visible."],["Notify","One Discord card and a durable notification receipt."]],outcomes:[["Frozen in the edition","Source batch, story IDs and ownership stay fixed; explicit editorial repair may revise authored copy."],["Refreshable fields","Mail, calendar and weather keep their last good value if a refresh fails, marked stale."]],source:"docs/daily-briefing-runtime.md"},
    ru:{caption:"Daily · публикация и обновление",steps:[["Запуск по расписанию","Одна сохраняемая попытка на локальную дату выпуска."],["Сбор","Пакет источников сохранён и проверен."],["Публикация","Выпуск и снимок новостей становятся доступны."],["Уведомление","Одна карточка Discord и сохранённое подтверждение доставки."]],outcomes:[["Зафиксировано в выпуске","Пакет источников, ID и принадлежность сюжетов не меняются; текст можно исправить отдельным редакционным действием."],["Обновляемые поля","Почта, календарь и погода при сбое сохраняют последнее достоверное значение с отметкой об устаревании."]],source:"docs/daily-briefing-runtime.md"}
  },
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
    "weekly-contrast":ru?{caption:"Два еженедельных результата",cards:[["Weekly","Агрегация семи завершённых дней; пропуски остаются видимыми."],["Cinema","Отдельный снимок со своими источниками, проверками и публикацией."]],note:"Сбой одного результата не переписывает другой и не блокирует Daily."}:{caption:"Two weekly outcomes",cards:[["Weekly","Aggregation of seven completed days; missing observations stay visible."],["Cinema","A separate snapshot with its own sources, validation and promotion."]],note:"Failure in one outcome neither rewrites the other nor blocks Daily."},
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
  const cards=ru?[
    ["Проверить","Статус и ссылки на текущий run, PR, Codex и preview."],
    ["Направить","Takeover или продолжение — только когда ownership и состояние это разрешают."],
    ["Получить evidence","Ограниченное исправление CI, review и preview по явному запросу."],
    ["Остановить","Отмена или снятие preview; сомнительная и опубликованная работа сохраняется."],
  ]:[
    ["Inspect","Status and links for the current run, PR, Codex task and preview."],
    ["Steer","Takeover or continue only when state and ownership allow it."],
    ["Request evidence","Bounded CI repair, review and preview on explicit request."],
    ["Stop","Cancel or remove preview; ambiguous and published work is preserved."],
  ];
  return `<figure class="project-cards controls-map"><figcaption>${ru?"Карточка показывает только допустимые сейчас действия":"The card exposes only actions valid now"}</figcaption><div class="project-cards__grid">${cards.map(([title,detail])=>`<div class="project-cards__card"><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`).join("")}</div><p class="project-cards__note">${ru?"Нажатие создаёт проверяемое намерение. Завершение подтверждает сохраняемое состояние, а не сам клик.":"A click records verifiable intent. Durable state—not the click—confirms completion."}</p></figure>`;
}
function healthMap(lang:Language) {
  const ru=lang==="ru";
  const steps=ru?[
    ["Наблюдать","Ресурсы узла, связь, runtime, recovery и свежесть копий."],
    ["Оценить","Настроенные пороги, серии сбоев и cooldown хранятся между проверками."],
    ["Показать","Одна постоянная карточка и ограниченная история снимков."],
  ]:[
    ["Observe","Host resources, connectivity, runtime, recovery and backup freshness."],
    ["Evaluate","Configured thresholds, failure streaks and cooldown survive checks."],
    ["Present","One persistent card and a bounded snapshot history."],
  ];
  const outcomes=ru?[
    ["Стабильно","Карточка обновляется без нового сообщения."],
    ["Изменение инцидента","Alerts получает новый сбой, смену серьёзности, напоминание или восстановление."],
  ]:[
    ["Stable","The card updates without a new message."],
    ["Incident change","Alerts receives a new incident, severity change, reminder or recovery."],
  ];
  return `<figure class="health-map"><figcaption>${ru?"Сигнал здоровья, а не обещание uptime":"A health signal, not an uptime promise"}</figcaption><ol class="health-map__path">${steps.map(([title,detail],index)=>`<li><span class="folio">${String(index+1).padStart(2,"0")}</span><strong>${escape(title)}</strong><p>${escape(detail)}</p></li>`).join("")}</ol><div class="health-map__outcomes">${outcomes.map(([title,detail])=>`<div><strong>${escape(title)}</strong><p>${escape(detail)}</p></div>`).join("")}</div><p class="health-map__note">${ru?"Обычная проверка ничего не очищает и не исправляет автоматически.":"The ordinary health check neither cleans up nor repairs resources."}</p></figure>`;
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
function visual(kind:string,lang:Language):string {
  if(kind==="home-map") return systemMap(lang);
  if(kind==="roles") return rolesMap(lang);
  if(kind==="state-legend") return stateLegend(lang);
  if(kind==="comparison"||kind==="weekly-contrast"||kind==="stocks-boundary") return comparisonMap(kind,lang);
  if(kind==="for-me-order") return forMeOrder(lang);
  if(kind==="project-admission") return admissionMap(lang);
  if(kind==="engineering-evidence") return evidenceMap(lang);
  if(kind==="owner-controls") return controlsMap(lang);
  if(kind==="health-map") return healthMap(lang);
  if(kind==="recovery-matrix") return recoveryMatrix(lang);
  if(kind==="automation-boundaries") return boundaryMap(lang);
  if(kind==="daily-architecture"||kind==="project-architecture") return architectureMap(kind,lang);
  const data:Record<string,Record<Language,[string,string][]>>={
    "project-flow":{en:[["Queued","Durable Project transition"],["Admitted","Policy and capacity passed"],["Active","Managed worktree and Codex"],["Parked","Review or owner attention"],["Stopping","Merge or cancellation evidence"],["Released","Only after exact cleanup proof"]],ru:[["В очереди","Сохранённый переход Project"],["Допущен","Правила и лимиты пройдены"],["В работе","Управляемые worktree и Codex"],["Остановлен","Review или решение владельца"],["Завершение","Проверка merge или отмены"],["Освобождён","Только после точного доказательства очистки"]]},
  };
  if(!data[kind])throw new Error(`Unknown docs visual: ${kind}`);
  return steps(data[kind][lang],lang);
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
  const empty=revision
    ? ru?"После начальной точки пока нет опубликованных изменений.":"No published changes since the baseline."
    : published
      ? ru?"Этот docs-only release не приписывает себе изменения приложения.":"This docs-only release claims no application changes."
      : ru?"Локальный preview намеренно оставляет changelog приложения пустым.":"The local preview deliberately leaves the application changelog empty.";
  const body=`<div class="layout">${side(lang,"")}<article class="article"><header class="intro"><p class="eyebrow">${revision?escape(revision.slice(0,7)):published?ru?"Ожидает подтверждения":"Awaiting verification":ru?"Локальный просмотр":"Local preview"}</p><h1>${title}</h1><p class="lede">${status}</p></header><div class="changes">${cards||`<p>${empty}</p>`}</div></article></div>`;
  return shell(lang,title,status,body,"changelog","changelog");
}
