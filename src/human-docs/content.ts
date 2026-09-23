// Authored, trusted copy for the owner-only human documentation site.
export type HumanDocsPage = {
  slug: string;
  section: 'start' | 'understand' | 'digest' | 'projects' | 'operations';
  title: { en: string; ru: string };
  navTitle: { en: string; ru: string };
  summary: { en: string; ru: string };
  blocks: { en: string; ru: string }[];
};

export const pages: HumanDocsPage[] = [
  {
    slug: 'what-is-kurami', section: 'start',
    title: { en: 'Kurami at a glance', ru: 'Курами: главное' },
    navTitle: { en: 'Overview', ru: 'Обзор' },
    summary: { en: 'A private agent system for its owner, not just a dashboard.', ru: 'Закрытая агентная система для владельца, а не просто панель.' },
    blocks: [
      { en: '<p>Kurami turns conversations and explicit owner decisions into bounded work. It shows what ran, what awaits an owner decision, and what automation cannot do alone.</p>', ru: '<p>Курами превращает разговоры и явные решения владельца в действия с ограничениями. Она показывает, что сделано, где требуется решение владельца и чего автоматика не делает сама.</p>' },
      { en: '<div data-visual="home-map"></div><p>Digest handles information and reviews; Project Orchestrator handles engineering runs; Operations covers health and recovery. Discord is the primary owner control surface.</p>', ru: '<div data-visual="home-map"></div><p>Digest отвечает за информацию и обзоры, Project Orchestrator — за инженерные задачи, Operations — за здоровье системы и восстановление. Основное управление для владельца — в Discord.</p>' },
    ],
  },
  {
    slug: 'who-does-what', section: 'start',
    title: { en: 'Kurami, Hermes, Codex', ru: 'Курами, Hermes, Codex' },
    navTitle: { en: 'Roles', ru: 'Роли' },
    summary: { en: 'Three roles, different boundaries.', ru: 'Три разные роли и границы ответственности.' },
    blocks: [
      { en: '<div data-visual="boundary"></div><p>Hermes provides the agent runtime, scheduling and conversation gateways. Kurami defines workflows, deterministic policy and durable state; Codex performs engineering work only after admission.</p>', ru: '<div data-visual="boundary"></div><p>Hermes предоставляет среду агента, расписание и каналы общения. Курами задаёт процессы, проверяемые правила и долговременное состояние; Codex выполняет инженерную работу только после допуска.</p>' },
      { en: '<p>Not every page view or status change starts a model. Rendering, polling, validation and many controls are deterministic code.</p>', ru: '<p>Не каждое открытие страницы или изменение статуса запускает модель. Отображение, опрос, проверки и многие элементы управления работают как обычный код.</p>' },
    ],
  },
  {
    slug: 'system-map', section: 'understand',
    title: { en: 'System map', ru: 'Схема системы' },
    navTitle: { en: 'System map', ru: 'Схема системы' },
    summary: { en: 'Intent, checks, evidence, owner decision.', ru: 'Намерение, проверки, доказательства, решение владельца.' },
    blocks: [
      { en: '<div data-visual="home-map"></div><p>A request or scheduled event enters its own workflow, passes its gates, and leaves a visible result or failure. Digest and Project Orchestrator have separate lifecycles and stores.</p>', ru: '<div data-visual="home-map"></div><p>Запрос или событие по расписанию проходит проверки своего процесса и оставляет видимый результат либо ошибку. У Digest и Project Orchestrator разные жизненные циклы и хранилища.</p>' },
      { en: '<p>For projects, GitHub Project holds work intent, GitHub holds PR and CI evidence, and Kurami’s Run Store tracks run ownership. Discord reports status and accepts bounded owner actions.</p>', ru: '<p>Для проектов GitHub Project хранит намерение, GitHub — сведения о PR и CI, а Run Store Курами — владельца и состояние запуска. Discord показывает статус и принимает ограниченный набор действий владельца.</p>' },
      { en: '<details><summary>Where is state kept?</summary><p>Daily editions live in a briefing SQLite database separate from the orchestrator database. In the project Run Store, observed Project items and durable transition events lead to runs, resource mappings and append-only state history. A Discord card reflects that state; it is not the source of truth.</p></details>', ru: '<details><summary>Где хранится состояние?</summary><p>Выпуски Daily хранятся в отдельной от оркестратора базе SQLite. В Run Store снимки элементов GitHub Project и события переходов связаны с запусками, учётом ресурсов и историей состояний. Карточка Discord отображает это состояние, но не служит источником истины.</p></details>' },
    ],
  },
  {
    slug: 'reading-state', section: 'understand',
    title: { en: 'Reading state', ru: 'Как читать статусы' },
    navTitle: { en: 'State', ru: 'Статусы' },
    summary: { en: 'Fresh, stale, partial and accepted are not interchangeable.', ru: 'Актуально, устарело, частично и принято — не одно и то же.' },
    blocks: [
      { en: '<p>A stale live value is the last successful reading, not a fresh measurement. A partial Daily edition exposes source gaps; a failed run does not silently become a published success.</p>', ru: '<p>Устаревшее значение — последнее успешное измерение, а не свежие данные. Частичный выпуск Daily показывает пробелы источников; неудачный запуск не выдаётся за успешную публикацию.</p>' },
      { en: '<p>A PR, a passing check and a published preview are separate evidence. Human Review is not merge approval, and a completed process is not proof that the owner-visible result was accepted.</p>', ru: '<p>PR, пройденная проверка и опубликованное превью — разные свидетельства. Human Review не означает согласие на слияние, а завершение процесса не доказывает, что результат принят и показан владельцу.</p>' },
    ],
  },
  {
    slug: 'daily', section: 'digest',
    title: { en: 'Daily edition', ru: 'Выпуск Daily' },
    navTitle: { en: 'Daily', ru: 'Daily' },
    summary: { en: 'A scheduled news snapshot alongside refreshable information.', ru: 'Срез новостей по расписанию рядом с обновляемыми данными.' },
    blocks: [
      { en: '<div data-visual="comparison"></div><p>The edition news and its sources are frozen at publication. Mail, calendar and weather may refresh later; a failed refresh retains the last good value and marks it stale.</p>', ru: '<div data-visual="comparison"></div><p>Новости выпуска и их источники фиксируются при публикации. Почта, календарь и погода могут обновляться позже; при сбое остаётся последнее достоверное значение с отметкой об устаревании.</p>' },
      { en: '<p>Opening a story or reacting on the page does not reopen a provider session. Read &amp; Archive for selected mail is a separate explicit action.</p>', ru: '<p>Открытие сюжета или реакция на странице не запускают новый сеанс сбора данных. «Прочитать и архивировать» выбранные письма — отдельное явное действие.</p>' },
    ],
  },
  {
    slug: 'daily-lifecycle', section: 'digest',
    title: { en: 'How does Daily arrive?', ru: 'Как появляется Daily?' },
    navTitle: { en: 'Daily lifecycle', ru: 'Цикл Daily' },
    summary: { en: 'One durable attempt, with bounded recovery.', ru: 'Один сохраняемый запуск с ограниченным восстановлением.' },
    blocks: [
      { en: '<div data-visual="daily-flow"></div><p>The scheduled run, in its configured timezone, captures sources, prepares and validates an edition, then publishes it. A bounded recovery window resumes the same durable attempt rather than collecting a second news snapshot. These windows are deployment scheduling policy, not page controls.</p>', ru: '<div data-visual="daily-flow"></div><p>Запуск по расписанию в заданном часовом поясе собирает источники, готовит и проверяет выпуск, затем публикует его. В ограниченном окне восстановления продолжается та же сохраняемая попытка, без повторного сбора новостей. Эти окна заданы расписанием развёртывания, а не настройками страницы.</p>' },
      { en: '<p>One Discord card per edition date reflects progress, failure and the final release. The periodic Central Poller refreshes live fields without rewriting frozen news.</p>', ru: '<p>Одна карточка в Discord на дату выпуска показывает ход работы, сбой и готовый выпуск. Периодический Central Poller обновляет живые поля, не переписывая зафиксированные новости.</p>' },
      { en: '<details><summary>Publication boundary</summary><p>The completion worker checkpoints image downloads and acknowledgement receipts before finalizing the edition. A published edition with a failed notification retries only notification. Success requires both the published state and a durable notification receipt; a generic scheduler success is insufficient.</p><p>The Central Poller compares the saved edition revision before committing live-field updates and asserts that the frozen news and source-batch digest did not change.</p></details>', ru: '<details><summary>Граница публикации</summary><p>Завершающий процесс сохраняет результаты загрузки изображений и подтверждений до публикации выпуска. Если уведомление о готовом выпуске не удалось, повторяется только уведомление. Успех требует опубликованного состояния и сохранённого подтверждения доставки; одного успешного статуса планировщика недостаточно.</p><p>Перед записью живых полей Central Poller сверяет версию выпуска и проверяет неизменность новостей и пакета источников.</p></details>' },
    ],
  },
  {
    slug: 'weekly-cinema', section: 'digest',
    title: { en: 'Weekly and Cinema', ru: 'Weekly и Cinema' },
    navTitle: { en: 'Weekly & Cinema', ru: 'Weekly и Cinema' },
    summary: { en: 'Two different weekly additions to Digest.', ru: 'Два разных еженедельных дополнения к Digest.' },
    blocks: [
      { en: '<div data-visual="weekly-contrast"></div><p>On its configured weekly schedule, Weekly aggregates observations from the preceding seven completed local dates. Missing observations stay missing; planned calendar time is not described as time actually worked.</p>', ru: '<div data-visual="weekly-contrast"></div><p>По заданному недельному расписанию Weekly собирает наблюдения за семь завершённых местных дней. Отсутствующие данные не превращаются в нули, а запланированное время в календаре не считается отработанным.</p>' },
      { en: '<p>On its configured weekly schedule, Cinema can promote a new snapshot and add a teaser to the corresponding Daily edition. Its failure does not block Daily or replace the last successful Cinema page.</p>', ru: '<p>По заданному недельному расписанию Cinema может опубликовать новый выпуск и добавить анонс в соответствующий Daily. Сбой Cinema не блокирует Daily и не заменяет последнюю успешную страницу Cinema.</p>' },
    ],
  },
  {
    slug: 'stocks-review', section: 'digest',
    title: { en: 'Stocks and Investment Review', ru: 'Stocks и Investment Review' },
    navTitle: { en: 'Stocks & Reviews', ru: 'Акции и обзоры' },
    summary: { en: 'Market cache is not portfolio advice.', ru: 'Рыночные данные — не совет по портфелю.' },
    blocks: [
      { en: '<div data-visual="stocks-boundary"></div><p>Stocks displays a cached watchlist and a frozen Daily teaser, without holdings or trading actions. Missing or old quotes remain visibly unavailable or stale.</p>', ru: '<div data-visual="stocks-boundary"></div><p>Stocks показывает сохранённый список акций и фиксированный анонс в Daily, но не позиции портфеля и не торговые действия. Отсутствующие или старые котировки явно помечаются.</p>' },
      { en: '<p>Investment Review is a separate private research flow based on a confirmed holdings snapshot and dated evidence. Bounded weekly research runs on its configured schedule and can accept a report only after checks; monthly runs and acceptance are manual. It never sends brokerage orders, and no personal report should be assumed published.</p>', ru: '<p>Investment Review — отдельный закрытый процесс анализа подтверждённого состава портфеля и датированных источников. Ограниченный недельный запуск идёт по заданному расписанию и принимает отчёт только после проверок; месячные запуски и принятие выполняются вручную. Система не отправляет биржевые заявки; нельзя считать, что личный отчёт уже опубликован.</p>' },
    ],
  },
  {
    slug: 'for-me', section: 'digest',
    title: { en: 'What does “For me” change?', ru: 'Что меняет «Для меня»?' },
    navTitle: { en: 'For me', ru: 'Для меня' },
    summary: { en: 'A different order, never a hidden story.', ru: 'Другой порядок, но не скрытые сюжеты.' },
    blocks: [
      { en: '<p>“Overview” keeps the saved editorial order. “For me” can reorder the same stories after enough distinct explicit reactions; it neither changes the published edition nor removes stories.</p>', ru: '<p>«Обзор» сохраняет редакционный порядок. «Для меня» может переставить те же сюжеты после достаточного числа явных реакций на разные истории, но не меняет опубликованный выпуск и ничего не скрывает.</p>' },
      { en: '<p>Reading, opening a link and time spent on a page are not preference votes. Critical stories retain their editorial position.</p>', ru: '<p>Чтение, переход по ссылке и время на странице не считаются голосами за предпочтение. Важные сюжеты сохраняют редакционное место.</p>' },
    ],
  },
  {
    slug: 'project-orchestrator', section: 'projects',
    title: { en: 'Project Orchestrator', ru: 'Project Orchestrator' },
    navTitle: { en: 'Orchestrator', ru: 'Оркестратор' },
    summary: { en: 'A distinct Kurami product for bounded engineering runs.', ru: 'Отдельный продукт Курами для управляемых инженерных задач.' },
    blocks: [
      { en: '<div data-visual="project-flow"></div><p>An explicit GitHub Project status transition can become an admitted run with its own branch, worktree and Codex task. Kurami records ownership and evidence; the owner steers it from Discord.</p>', ru: '<div data-visual="project-flow"></div><p>Явное изменение статуса в GitHub Project может стать допущенным запуском с отдельной веткой, рабочей копией и задачей Codex. Курами хранит состояние и свидетельства; владелец управляет работой через Discord.</p>' },
      { en: '<p>It does not merge PRs or deploy application code on its own. Unclear ownership or cleanup evidence stops automation rather than triggering deletion.</p>', ru: '<p>Она не сливает PR и не развёртывает код приложения самостоятельно. При неясном владельце или сомнительных данных для очистки автоматика останавливается, а не удаляет ресурсы.</p>' },
    ],
  },
  {
    slug: 'project-admission', section: 'projects',
    title: { en: 'Project admission', ru: 'Допуск проекта' },
    navTitle: { en: 'Admission', ru: 'Допуск' },
    summary: { en: 'Compatibility first; then a real transition and capacity.', ru: 'Сначала совместимость, затем реальный переход и свободные ресурсы.' },
    blocks: [
      { en: '<p>The read-only readiness checker evaluates configured GitHub identity, workspace, Discord, CI and optional preview capability. PASS proves a check, WARN needs an owner decision, and FAIL blocks onboarding; checking does not authorize changes.</p>', ru: '<p>Проверка готовности без записи изучает настройки GitHub, рабочее пространство, Discord, CI и необязательное превью. PASS подтверждает пункт, WARN требует решения владельца, FAIL блокирует подключение; сама проверка не даёт разрешения что-либо менять.</p>' },
      { en: '<p>A run needs an open issue with a description and a real transition into the configured active Project status. Initial observations do not retroactively start work; WIP and resource gates still apply.</p>', ru: '<p>Для запуска нужны открытая задача с описанием и реальный переход в рабочий статус GitHub Project. Первый снимок не запускает старые задачи задним числом; ограничения по числу задач и ресурсам остаются в силе.</p>' },
    ],
  },
  {
    slug: 'run-lifecycle', section: 'projects',
    title: { en: 'Engineering run', ru: 'Инженерный запуск' },
    navTitle: { en: 'Run lifecycle', ru: 'Цикл запуска' },
    summary: { en: 'Isolated work, visible evidence, an owner decision.', ru: 'Изолированная работа, видимые проверки, решение владельца.' },
    blocks: [
      { en: '<div data-visual="project-flow"></div><p>After admission, Kurami provisions a managed worktree, starts a dedicated Codex task and tracks its PR. The run can pause for review or attention instead of guessing a next action.</p>', ru: '<div data-visual="project-flow"></div><p>После допуска Курами создаёт отдельную рабочую копию, запускает задачу Codex и отслеживает PR. Запуск может остановиться для проверки или решения проблемы, а не угадывать дальнейшее действие.</p>' },
      { en: '<p>Moving a task to Human Review does not instantly free Codex ownership. After the owner merges, Kurami checks merge evidence before releasing resources; cancellation preserves ambiguous or published work.</p>', ru: '<p>Переход в Human Review не освобождает управление Codex мгновенно. После слияния владельцем Курами проверяет доказательство слияния перед освобождением ресурсов; при отмене неоднозначная или опубликованная работа сохраняется.</p>' },
      { en: '<details><summary>Run state and release</summary><p>A durable Project transition is queued before admission. The controller handles only actionable Run Store states: provision an admitted worktree, start Codex within capacity, then park for review or attention. Human Review is review-ready only after the managed CLI releases ownership.</p><p>Done initiates stopping, not immediate deletion. Release needs verified Git ancestry or a merged PR matching the recorded head branch and exact SHA. Dirty unpublished work and a published Draft PR remain for attention during cancellation.</p></details>', ru: '<details><summary>Состояние и освобождение ресурсов</summary><p>Переход статуса GitHub Project сохраняется до допуска. Контроллер обрабатывает лишь состояния Run Store, требующие действия: создаёт рабочую копию, запускает Codex с учётом лимитов, затем ставит запуск на паузу для ревью или разбора проблемы. Готовность к ревью наступает только после освобождения управления CLI.</p><p>Статус Done запускает остановку, а не немедленное удаление. Для освобождения ресурсов нужна проверенная история Git или слитый PR с совпадением ветки и точного SHA. При отмене незаписанные изменения и опубликованный черновик PR остаются для разбора.</p></details>' },
    ],
  },
  {
    slug: 'engineering-evidence', section: 'projects',
    title: { en: 'CI, reviews and previews', ru: 'CI, ревью и превью' },
    navTitle: { en: 'Evidence', ru: 'Проверки' },
    summary: { en: 'Three separate checks on the exact managed work.', ru: 'Три разные проверки конкретного результата.' },
    blocks: [
      { en: '<div data-visual="engineering-evidence"></div><p>CI is observed on the managed PR’s exact head commit; missing or unknown checks are not passing checks. AI Code Review and review fixes start only on explicit owner action in a safe review state.</p>', ru: '<div data-visual="engineering-evidence"></div><p>CI проверяется для точного коммита управляемого PR; отсутствующая или неизвестная проверка не считается пройденной. AI Code Review и исправления замечаний запускаются только по явному действию владельца в безопасном состоянии ревью.</p>' },
      { en: '<p>An optional preview uses the configured Compose or static adapter and must match a clean, verified PR head. A preview is temporary evidence to inspect, not deployment or merge approval.</p>', ru: '<p>Необязательное превью использует настроенный адаптер Compose или статических файлов и должно соответствовать чистому рабочему дереву с проверенным коммитом PR. Это временная возможность посмотреть результат, а не развёртывание или согласие на слияние.</p>' },
    ],
  },
  {
    slug: 'owner-controls', section: 'projects',
    title: { en: 'Owner controls', ru: 'Действия владельца' },
    navTitle: { en: 'Controls', ru: 'Управление' },
    summary: { en: 'Discord controls are scoped to the current run.', ru: 'Действия в Discord привязаны к конкретному запуску.' },
    blocks: [
      { en: '<p>The run card offers actions valid for its current state: status, takeover, bounded CI repair or review, preview controls and cancellation when applicable. A requested action is not completion; the durable state must confirm its outcome.</p>', ru: '<p>Карточка запуска предлагает только допустимые сейчас действия: статус, передачу управления, ограниченное исправление CI или ревью, управление превью и отмену. Принятый запрос ещё не означает завершения; результат подтверждается сохраняемым состоянием.</p>' },
      { en: '<p>Destructive cleanup has separate safeguards and confirmation; a published PR is not discarded as if it were local scratch work. Telegram is only a text fallback, not the primary proactive control surface.</p>', ru: '<p>Удаление результатов защищено отдельными проверками и подтверждением; опубликованный PR нельзя выбросить как локальный черновик. Telegram служит текстовым запасным каналом, а не основным каналом управления.</p>' },
    ],
  },
  {
    slug: 'health', section: 'operations',
    title: { en: 'System health', ru: 'Состояние системы' },
    navTitle: { en: 'Health', ru: 'Состояние' },
    summary: { en: 'One persistent Discord card and threshold alerts.', ru: 'Одна постоянная карточка в Discord и оповещения по порогам.' },
    blocks: [
      { en: '<p>System Health tracks host resources, connectivity, orchestrator state and recent checks. It edits an existing Discord card and reports threshold alerts and recoveries rather than posting a new card every interval.</p>', ru: '<p>System Health отслеживает ресурсы сервера, связь, состояние оркестратора и последние проверки. Она обновляет существующую карточку Discord и сообщает о пороговых сбоях и восстановлении, не создавая новую карточку при каждой проверке.</p>' },
      { en: '<p>The owner can change the health check interval in <code>/kurami settings</code>. A health card is operational evidence, not a guarantee that every external provider is available.</p>', ru: '<p>Владелец может менять интервал проверки через <code>/kurami settings</code>. Карточка состояния — диагностические данные, а не гарантия доступности всех внешних источников.</p>' },
    ],
  },
  {
    slug: 'recovery', section: 'operations',
    title: { en: 'Recovery scope', ru: 'Границы восстановления' },
    navTitle: { en: 'Recovery', ru: 'Восстановление' },
    summary: { en: 'Code and verified state, not an image of the whole machine.', ru: 'Код и проверенное состояние, но не образ всего сервера.' },
    blocks: [
      { en: '<div data-visual="recovery-scope"></div><p>The private repository holds versioned code and non-secret configuration. Verified runtime backups and, when enabled, a minimal encrypted off-site bundle cover selected state and recovery inputs; neither is a full machine image.</p>', ru: '<div data-visual="recovery-scope"></div><p>Закрытый репозиторий хранит версии кода и конфигурацию без секретов. Проверенные локальные копии и, если включено, минимальный зашифрованный внешний архив покрывают выбранное состояние и данные для восстановления; ни то ни другое не является образом всего сервера.</p>' },
      { en: '<p>Codex sessions, Docker data and worktrees are not in that bundle. Restore requires an operator, verification and an offline decryption identity; unclear resources are not automatically deleted.</p>', ru: '<p>Сеансы Codex, данные Docker и рабочие копии в архив не входят. Восстановление требует участия оператора, проверки и ключа расшифровки вне сервера; неоднозначные ресурсы не удаляются автоматически.</p>' },
      { en: '<details><summary>Verify before restore</summary><p>The ordinary runtime backup excludes credentials. When minimal off-site recovery is enabled, its encrypted bundle contains a verified SQLite/config snapshot, selected recovery inputs and manifests. An operator checks the bundle checksum, decrypts with an offline identity on an isolated host, verifies file manifests and SQLite integrity, then restores explicitly. A local encrypted file alone does not establish off-site recovery.</p></details>', ru: '<details><summary>Проверка перед восстановлением</summary><p>Обычная копия состояния не содержит секретов. Если включено минимальное внешнее восстановление, зашифрованный архив содержит проверенный снимок SQLite и конфигурации, выбранные данные для восстановления и манифесты. Оператор проверяет контрольную сумму архива, расшифровывает его на отдельном узле ключом вне сервера, сверяет файлы и целостность SQLite и только затем явно восстанавливает систему. Один локальный зашифрованный файл не подтверждает внешнюю копию.</p></details>' },
    ],
  },
  {
    slug: 'automation-boundaries', section: 'operations',
    title: { en: 'Automation boundaries', ru: 'Границы автоматизации' },
    navTitle: { en: 'Boundaries', ru: 'Границы' },
    summary: { en: 'Schedules do not grant unlimited authority.', ru: 'Расписание не даёт неограниченных полномочий.' },
    blocks: [
      { en: '<p>Scheduled Digest work has time and duplicate gates; periodic refresh is deterministic and cannot rewrite edition news. Optional weekly products have their own isolation or acceptance checks.</p>', ru: '<p>Работа Digest по расписанию ограничена временем и защитой от повторов; периодическое обновление выполняется обычным кодом и не переписывает новости выпуска. У еженедельных дополнений отдельные правила изоляции или принятия результата.</p>' },
      { en: '<p>Project Orchestrator admits only eligible work within capacity. It does not autonomously merge, deploy application code or delete uncertain resources; external issue text and provider content are data, not instructions.</p>', ru: '<p>Project Orchestrator допускает только подходящие задачи при наличии ресурсов. Она не сливает PR, не развёртывает код приложения и не удаляет сомнительные ресурсы сама; текст задач и данные внешних источников — это данные, а не команды.</p>' },
    ],
  },
];
