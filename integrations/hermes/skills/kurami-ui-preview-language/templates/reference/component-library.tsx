"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const colors = [
  { name: "PAPER", value: "#FBFBF8", className: "paper" },
  { name: "SURFACE", value: "#FFFFFF", className: "surface" },
  { name: "INK", value: "#0B0B0B", className: "ink" },
  { name: "SIGNAL", value: "#E21B16", className: "signal" },
  { name: "MUTED", value: "#5E5E59", className: "muted" },
];

const noteExamples = [
  { intent: "FOCUS", text: "важное число", rotation: "-4deg" },
  { intent: "CONTEXT", text: "вчера было иначе", rotation: "3deg" },
  { intent: "ACTION", text: "лучше перенести →", rotation: "-2deg" },
  { intent: "REASSURE", text: "всё под контролем", rotation: "4deg" },
  { intent: "HUMOR", text: "календарь подрался", rotation: "-5deg" },
];

const metrics = [
  { label: "Встречи", value: "4", delta: "+1", tone: "up", context: "на сегодня", bars: [35, 42, 38, 54, 49, 70, 62] },
  { label: "Фокус-время", value: "3ч 20м", delta: "+12%", tone: "up", context: "к среднему", bars: [48, 44, 56, 62, 58, 76, 82] },
  { label: "Новых историй", value: "18", delta: "−6", tone: "down", context: "после фильтра", bars: [84, 72, 66, 58, 62, 49, 44] },
  { label: "Погода", value: "+18°", delta: "ясно", tone: "neutral", context: "Вильнюс", bars: [40, 46, 55, 66, 74, 72, 78] },
];

const sources = [
  { name: "The Verge", type: "Технологии", status: "Активен", score: "4.8", preference: "like" },
  { name: "Кинопоиск", type: "Кино", status: "Активен", score: "4.5", preference: "like" },
  { name: "Медуза — новости", type: "Новости", status: "На паузе", score: "3.9", preference: "neutral" },
];

const digestItems = [
  {
    id: "01",
    source: "Telegram",
    sourceDetail: "Код Дурова",
    title: "Telegram расширил инструменты для mini apps",
    summary: "Разработчикам добавили новые события и элементы интерфейса.",
    time: "1 ч назад",
    topics: ["Telegram", "Mini Apps", "Платформы", "Разработка"],
    why: "Изменение упрощает создание сложных сценариев внутри мессенджера.",
    facts: ["Новые события доступны без обновления клиента", "Компоненты получили единые состояния", "Документация обновляется поэтапно"],
  },
  {
    id: "02",
    source: "Telegram",
    sourceDetail: "Техно",
    title: "Локальные агенты переносят выполнение ближе к данным",
    summary: "Новые инструменты делают приватность частью архитектуры, а не настройкой.",
    time: "34 мин назад",
    topics: ["ИИ", "AI-агенты", "Приватность", "Локальные модели"],
    why: "Подход влияет на скорость, стоимость и модель доступа к личным данным.",
    facts: ["Часть вычислений остаётся на устройстве", "Облачная синхронизация становится выборочной", "Контроль разрешений виден пользователю"],
  },
  {
    id: "03",
    source: "Telegram",
    sourceDetail: "Кино сегодня",
    title: "Студии пересматривают календарь осенних премьер",
    summary: "Несколько крупных релизов получили новые даты проката.",
    time: "2 ч назад",
    topics: ["Кино", "Премьеры", "Прокат", "Индустрия"],
    why: "Переносы меняют конкуренцию за экраны и расписание ближайших премьер.",
    facts: ["Две премьеры переехали на октябрь", "Один релиз получил широкий прокат", "Новые трейлеры ожидаются на неделе"],
  },
];

export function ComponentLibrary() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [expandedDigestId, setExpandedDigestId] = useState<string | null>("01");
  const [digestPage, setDigestPage] = useState(1);
  const [digestReactions, setDigestReactions] = useState<Record<string, "like" | "dislike" | undefined>>({ "02": "like" });
  const [bulkActionState, setBulkActionState] = useState<"idle" | "confirm" | "success">("idle");

  useEffect(() => {
    const saved = window.localStorage.getItem("hermes-theme");
    // Hydrate the persisted preference after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved === "dark" || saved === "light" ? saved : "light");
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("hermes-theme", next);
  };

  return (
    <main className="site-shell kit-shell" data-theme={theme}>
      <header className="preview-nav kit-nav">
        <Link className="brand" href="/c-b30"><span className="brand-mark">H</span><span>HERMES AGENT</span></Link>
        <span className="kit-nav-title">VISUAL LANGUAGE · 0.4</span>
        <div className="nav-actions">
          <Link className="kit-link" href="/c-b30">BRIEFING</Link>
          <button className="theme-button" type="button" onClick={toggleTheme}>{theme === "light" ? "● DARK" : "○ LIGHT"}</button>
        </div>
      </header>

      <article className="kit-page">
      <header className="kit-hero" id="top">
          <p className="kicker">SWISS SIGNAL × KURAMI NOTES</p>
          <h1>Hermes<br />Visual Language.</h1>
          <p>Один строгий каркас для ежедневных страниц. Характер появляется через контент, данные и короткие заметки Курами.</p>
          <span className="kit-hero-note">не скучно ≠ шумно</span>
        </header>

        <nav className="kit-index" aria-label="Разделы библиотеки">
          <a href="#foundations">01 · FOUNDATIONS</a><a href="#actions">02 · ACTIONS</a><a href="#editorial">03 · DATA</a><a href="#media">04 · MEDIA</a><a href="#states">05 · STATES</a><a href="#kurami">06 · NOTES</a><a href="#layouts">07 · LAYOUTS</a>
        </nav>

        <section className="kit-section" id="foundations">
          <header className="kit-section-head"><span>01</span><div><p className="kicker">FOUNDATIONS</p><h2>Основа системы</h2><p>Почти белый фон, чёрная структура и один сигнальный красный. Цвет не используется без смысловой причины.</p></div></header>

          <div className="kit-block">
            <div className="kit-block-head"><h3>COLOR TOKENS</h3><code>colors.css</code></div>
            <div className="kit-swatches">
              {colors.map((color) => <div className={`kit-swatch ${color.className}`} key={color.name}><div /><strong>{color.name}</strong><code>{color.value}</code></div>)}
            </div>
          </div>

          <div className="kit-block">
            <div className="kit-block-head"><h3>TYPOGRAPHY</h3><code>typography.css</code></div>
            <div className="kit-type-list">
              <div><span>DISPLAY / ONEST 900</span><strong>Доброе утро, Alex.</strong></div>
              <div><span>HEADING / ONEST 800</span><h3>Новости, которые стоят времени</h3></div>
              <div><span>BODY / ONEST 400</span><p>Курами собрала главное и убрала повторы. Здесь остаётся только то, что может повлиять на сегодняшний день.</p></div>
              <div className="mono"><span>META / FRAGMENT MONO</span><p>DAILY BRIEFING · 26.08.2026 · 07:30</p></div>
              <div className="hand"><span>NOTE / CAVEAT 600</span><p>всё под контролем ↗</p></div>
            </div>
          </div>

          <div className="kit-two-col">
            <div className="kit-block"><div className="kit-block-head"><h3>SPACING</h3><code>4PX BASE</code></div><div className="kit-spacing">{[4,8,12,16,24,32,48,64].map(value => <div key={value}><span>{value}</span><i style={{ width: `${value * 2}px` }} /></div>)}</div></div>
            <div className="kit-block"><div className="kit-block-head"><h3>LINES + RADIUS</h3><code>STRUCTURE</code></div><div className="kit-lines"><div><i className="line-1"/><span>1PX / INTERNAL</span></div><div><i className="line-2"/><span>2PX / SECTION</span></div><div><i className="line-4"/><span>4PX / SIGNAL</span></div><div className="radius-sample"><i/><span>0–4PX / UI · 999PX / STATUS ONLY</span></div></div></div>
          </div>
        </section>

        <section className="kit-section" id="actions">
          <header className="kit-section-head"><span>02</span><div><p className="kicker">ACTIONS + FEEDBACK</p><h2>Элементы действия</h2><p>Прямые формы и буквальные подписи. Hover меняет заливку, focus всегда заметен.</p></div></header>
          <div className="kit-block"><div className="kit-block-head"><h3>BUTTONS + LINKS</h3><code>actions.tsx</code></div><div className="kit-stage"><button className="primary-button">ОТКРЫТЬ БРИФИНГ</button><button className="kit-secondary">ОТЛОЖИТЬ</button><button className="kit-quiet">Подробнее →</button><button className="kit-icon" aria-label="Открыть">↗</button></div></div>
          <div className="kit-two-col">
            <div className="kit-block"><div className="kit-block-head"><h3>ICON BUTTONS</h3><code>icon-button.tsx</code></div><div className="kit-icon-row"><button aria-label="Поиск"><i className="ui-icon icon-search" /></button><button aria-label="Уведомления"><i className="ui-icon icon-bell" /></button><button className="selected" aria-label="Настройки"><i className="ui-icon icon-sliders" /></button><button aria-label="Добавить"><i className="ui-icon icon-plus" /></button><button aria-label="Удалить"><i className="ui-icon icon-trash" /></button></div></div>
            <div className="kit-block"><div className="kit-block-head"><h3>BUTTON GROUP</h3><code>segmented.tsx</code></div><div className="kit-control-stack"><div className="kit-segmented"><button>День</button><button className="active">Неделя</button><button>Месяц</button></div><div className="kit-reactions" aria-label="Оценка новости"><button className="active">Нравится <span>12</span></button><button>Не моё <span>3</span></button><button>Сохранить</button></div></div></div>
          </div>
          <div className="kit-block"><div className="kit-block-head"><h3>STATUS + ALERTS</h3><code>feedback.tsx</code></div><div className="kit-stage"><span className="kit-badge signal">Важно</span><span className="kit-badge positive">✓ Готово</span><span className="kit-badge warning">На проверке</span><span className="kit-badge muted">Черновик</span><span className="kit-badge live">● Live</span></div><div className="kit-alerts"><div className="kit-alert info"><span>i</span><p>Новая версия briefing уже доступна.</p><button aria-label="Закрыть уведомление">×</button></div><div className="kit-alert success"><span>✓</span><p>Все источники успешно обновлены.</p><button aria-label="Закрыть уведомление">×</button></div><div className="kit-alert warning"><span>!</span><p>Два канала давно не обновлялись.</p><button aria-label="Закрыть уведомление">×</button></div><div className="kit-alert danger"><span>×</span><p>Telegram не ответил. Повторим позже.</p><button aria-label="Закрыть уведомление">×</button></div></div></div>
          <div className="kit-block"><div className="kit-block-head"><h3>NAVIGATION</h3><code>tabs.tsx</code></div><div className="kit-navigation"><div className="kit-breadcrumbs"><span>Главная</span><b>›</b><span>Настройки</span><b>›</b><strong>Источники</strong></div><div className="kit-tabs"><button className="active">Обзор</button><button>Новости</button><button>Кино</button><button>Календарь</button></div></div></div>
        </section>

        <section className="kit-section" id="editorial">
          <header className="kit-section-head"><span>03</span><div><p className="kicker">EDITORIAL + DATA</p><h2>Контент и сигналы</h2><p>Главное — смысловая иерархия. Карточка не должна быть декоративнее собственного содержимого.</p></div></header>
          <div className="kit-block"><div className="kit-block-head"><h3>STORY ROW</h3><code>story-row.tsx</code></div><article className="kit-story"><span>01</span><div><span className="tag">AI / AGENTS</span><h3>Локальные агенты делают ставку на приватность</h3><p>Исполнение всё чаще переносится ближе к данным пользователя.</p><small>THE VERGE · 12 МИН НАЗАД</small></div><button className="kit-icon" aria-label="Открыть новость">↗</button></article></div>
          <div className="kit-block" id="digest-demo">
            <div className="kit-block-head"><h3>PAGINATED DIGEST FEED</h3><code>digest-feed.tsx · SOURCE-AGNOSTIC</code></div>
            <div className="kit-digest">
              <header className="kit-digest-head">
                <div><span className="kicker">DIGEST FEED</span><h3>Новости</h3><p>126 материалов · собрано в 08:10</p></div>
                <span className="kit-source-facet">Telegram · 126</span>
              </header>

              <div className="kit-digest-list">
                {digestItems.map((item) => {
                  const expanded = expandedDigestId === item.id;
                  const reaction = digestReactions[item.id];
                  return (
                    <article className={`kit-digest-item${expanded ? " expanded" : ""}`} key={item.id}>
                      <span className="kit-digest-index">{item.id}</span>
                      <div className="kit-digest-copy">
                        <div className="kit-digest-meta"><span>{item.source}</span><strong>{item.sourceDetail}</strong><time>{item.time}</time></div>
                        <h4>{item.title}</h4>
                        <p>{item.summary}</p>
                        <div className="kit-topic-set" aria-label="Темы материала">{item.topics.map((topic) => <span key={topic}>{topic}</span>)}</div>
                        {expanded && (
                          <div className="kit-digest-expanded">
                            <strong>Почему важно</strong>
                            <p>{item.why}</p>
                            <strong>Главное</strong>
                            <ul>{item.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
                          </div>
                        )}
                      </div>
                      <div className="kit-digest-actions">
                        <button type="button" aria-expanded={expanded} onClick={() => setExpandedDigestId(expanded ? null : item.id)}>{expanded ? "Свернуть" : "Развернуть"}</button>
                        <button type="button" aria-label={`Открыть оригинал: ${item.title}`}>↗</button>
                        <button type="button" className={reaction === "like" ? "active" : ""} aria-label={`Больше такого: ${item.title}`} title="Больше такого" aria-pressed={reaction === "like"} onClick={() => setDigestReactions((current) => ({ ...current, [item.id]: current[item.id] === "like" ? undefined : "like" }))}>➕</button>
                        <button type="button" className={reaction === "dislike" ? "active" : ""} aria-label={`Меньше такого: ${item.title}`} title="Меньше такого" aria-pressed={reaction === "dislike"} onClick={() => setDigestReactions((current) => ({ ...current, [item.id]: current[item.id] === "dislike" ? undefined : "dislike" }))}>➖</button>
                      </div>
                    </article>
                  );
                })}
              </div>

              <nav className="kit-pagination" aria-label="Страницы материалов">
                <span>1–12 из 126</span>
                <div>
                  <button type="button" disabled={digestPage === 1} aria-label="Предыдущая страница" onClick={() => setDigestPage((page) => Math.max(1, page - 1))}>←</button>
                  {[1, 2, 3].map((page) => <button type="button" className="kit-pagination-page" key={page} aria-current={digestPage === page ? "page" : undefined} onClick={() => setDigestPage(page)}>{page}</button>)}
                  <span>…</span>
                  <button type="button" className="kit-pagination-page" onClick={() => setDigestPage(11)} aria-current={digestPage === 11 ? "page" : undefined}>11</button>
                  <label className="kit-pagination-mobile"><span className="sr-only">Перейти к странице</span><input type="number" inputMode="numeric" min={1} max={11} value={digestPage} aria-label={`Номер страницы ${digestPage} из 11`} onChange={(event) => setDigestPage(Math.min(11, Math.max(1, Number(event.currentTarget.value) || 1)))} /><span aria-hidden="true">/ 11</span></label>
                  <button type="button" disabled={digestPage === 11} aria-label="Следующая страница" onClick={() => setDigestPage((page) => Math.min(11, page + 1))}>→</button>
                </div>
              </nav>

              <section className={`kit-bulk-action ${bulkActionState}`} aria-live="polite">
                {bulkActionState === "idle" && <><div><span>TELEGRAM</span><strong>Обработать текущую пачку</strong><p>В сводку вошло 126 сообщений из 14 каналов, собранных до 08:10.</p></div><button className="primary-button" type="button" onClick={() => setBulkActionState("confirm")}>Отметить Telegram-сообщения прочитанными</button><small>Новые сообщения после 08:10 не будут затронуты.</small></>}
                {bulkActionState === "confirm" && <><div><span>ПОДТВЕРЖДЕНИЕ</span><strong>Отметить 126 сообщений прочитанными?</strong><p>Действие относится только к материалам этой зафиксированной пачки.</p></div><div className="kit-bulk-buttons"><button className="kit-secondary" type="button" onClick={() => setBulkActionState("idle")}>Отмена</button><button className="primary-button" type="button" onClick={() => setBulkActionState("success")}>Подтвердить</button></div></>}
                {bulkActionState === "success" && <div className="kit-bulk-success"><span>✓</span><div><strong>Telegram-сообщения отмечены прочитанными</strong><p>Следующая сводка начнётся с новых публикаций.</p></div></div>}
              </section>
            </div>
          </div>
          <div className="kit-block"><div className="kit-block-head"><h3>METRIC CARDS</h3><code>metric-card.tsx</code></div><div className="kit-metric-grid">{metrics.map(metric => <article key={metric.label}><span>{metric.label}</span><div className="kit-metric-value"><strong>{metric.value}</strong><small className={metric.tone}>{metric.delta}</small></div><div className="kit-sparkline">{metric.bars.map((bar, index) => <i key={index} style={{ height: `${bar}%` }} />)}</div><em>{metric.context}</em></article>)}</div></div>
          <div className="kit-two-col">
            <div className="kit-block"><div className="kit-block-head"><h3>KEY METRIC</h3><code>metric.tsx</code></div><div className="kit-metric"><span>ПРИОРИТЕТ ДНЯ</span><strong>78</strong><small>↑ 6% за сутки</small><em>важное число</em></div></div>
            <div className="kit-block"><div className="kit-block-head"><h3>BAR CHART</h3><code>bar-chart.tsx</code></div><div className="kit-mini-chart">{[38,62,49,81,70,96,78].map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div></div>
          </div>
          <div className="kit-two-col">
            <div className="kit-block"><div className="kit-block-head"><h3>TREND CHART</h3><code>line-chart.tsx</code></div><div className="kit-trend"><div className="kit-chart-legend"><span><i className="current"/>Эта неделя</span><span><i/>Прошлая</span></div><svg viewBox="0 0 600 230" role="img" aria-label="Сравнение активности за две недели"><g className="grid"><line x1="20" y1="45" x2="580" y2="45"/><line x1="20" y1="110" x2="580" y2="110"/><line x1="20" y1="175" x2="580" y2="175"/></g><polyline className="previous" points="20,178 110,165 200,156 290,128 380,119 470,91 580,72"/><polyline className="current" points="20,160 110,145 200,151 290,113 380,122 470,76 580,42"/><g className="kit-chart-nodes">{[[20,160,42],[110,145,48],[200,151,46],[290,113,61],[380,122,57],[470,76,74],[580,42,88]].map(([x,y,value]) => <g key={x} tabIndex={0} aria-label={`${value}`}><circle cx={x} cy={y} r="3"/><text x={x} y={y - 12} textAnchor="middle">{value}</text></g>)}</g></svg><div className="kit-axis"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div></div></div>
            <div className="kit-block"><div className="kit-block-head"><h3>GAUGE</h3><code>gauge.tsx</code></div><div className="kit-gauge-wrap"><div className="kit-gauge"><div><strong>74%</strong><span>источников прочитано</span></div></div><p>18 из 24 источников обработаны</p></div></div>
          </div>
          <div className="kit-block"><div className="kit-block-head"><h3>SOURCE + FRESHNESS</h3><code>trust.tsx</code></div><div className="kit-trust"><div><span>GOOGLE CALENDAR</span><strong>SYNCED</strong></div><div><span>RSS · 12 SOURCES</span><strong>92% COVERAGE</strong></div><div><span>LAST UPDATE</span><strong>07:30</strong></div></div></div>
          <div className="kit-block"><div className="kit-block-head"><h3>STRUCTURED LIST</h3><code>source-table.tsx</code></div><div className="kit-table-tools"><strong>24 источника</strong><label><i className="ui-icon icon-search" /><input aria-label="Поиск источников" placeholder="Найти источник" /></label><button>Фильтры</button><button className="primary-button">＋ Добавить</button></div><div className="kit-source-table"><div className="kit-source-head"><span>Источник</span><span>Тема</span><span>Статус</span><span>Оценка</span><span>Предпочтение</span></div>{sources.map(source => <div className="kit-source-row" key={source.name}><strong>{source.name}</strong><span>{source.type}</span><span className={source.status === "Активен" ? "status-live" : "status-paused"}>● {source.status}</span><span>{source.score} ↗</span><div className="kit-mini-reactions"><button className={source.preference === "like" ? "active" : ""} aria-label={`Нравится: ${source.name}`}>Нравится</button><button className={source.preference === "neutral" ? "active negative" : ""} aria-label={`Не нравится: ${source.name}`}>Не моё</button></div></div>)}</div></div>
        </section>

        <section className="kit-section" id="media">
          <header className="kit-section-head"><span>04</span><div><p className="kicker">MEDIA</p><h2>Кино и видео</h2><p>Не один «главный» материал, а повторяемые коллекции. Количество трейлеров и премьер меняется независимо от композиции страницы.</p></div></header>
          <div className="kit-block"><div className="kit-block-head"><h3>СВЕЖИЕ ТРЕЙЛЕРЫ</h3><code>trailer-collection.tsx · 3 NEW</code></div><div className="kit-trailer-collection"><article><div className="kit-video-frame video-one"><span>MICKEY<br/>17</span><button aria-label="Воспроизвести трейлер Микки 17">▶</button><small>02:24</small></div><div><span>WARNER BROS. · YOUTUBE</span><strong>Микки 17 — официальный трейлер</strong><p>Фантастика · премьера 6 марта</p></div></article><article><div className="kit-video-frame video-two"><span>MATERI<br/>ALISTS</span><button aria-label="Воспроизвести трейлер Материалисты">▶</button><small>02:11</small></div><div><span>A24 · YOUTUBE</span><strong>Материалисты — первый трейлер</strong><p>Романтика · премьера 12 июня</p></div></article><article><div className="kit-video-frame video-three"><span>F1</span><button aria-label="Воспроизвести трейлер F1">▶</button><small>02:36</small></div><div><span>APPLE ORIGINAL FILMS</span><strong>F1 — финальный трейлер</strong><p>Драма · премьера 27 июня</p></div></article></div></div>
          <div className="kit-block"><div className="kit-block-head"><h3>НА СЛЕДУЮЩЕЙ НЕДЕЛЕ</h3><code>premiere-collection.tsx · 4 RELEASES</code></div><div className="kit-premiere-collection"><article><div className="kit-poster poster-one"><span>THE<br/>BRUTALIST</span><b>8.1</b></div><strong>Бруталист</strong><p>Драма · 3ч 34м</p><small>ЧТ · 6 МАРТА</small></article><article><div className="kit-poster poster-two"><span>NOSFERATU</span><b>7.4</b></div><strong>Носферату</strong><p>Хоррор · 2ч 12м</p><small>ЧТ · 6 МАРТА</small></article><article><div className="kit-poster poster-three"><span>ANORA</span><b>7.8</b></div><strong>Анора</strong><p>Драма · 2ч 19м</p><small>СБ · 8 МАРТА</small></article><article><div className="kit-poster poster-four"><span>FLOW</span><b>8.3</b></div><strong>Поток</strong><p>Анимация · 1ч 25м</p><small>ВС · 9 МАРТА</small></article></div></div>
        </section>

        <section className="kit-section" id="states">
          <header className="kit-section-head"><span>05</span><div><p className="kicker">SYSTEM STATES</p><h2>Когда данные не готовы</h2><p>Briefing честно показывает, что загружается, устарело или не приехало. Проблема не должна выглядеть как пустое место.</p></div></header>
          <div className="kit-state-grid"><article className="loading"><span>LOADING</span><div className="skeleton wide"/><div className="skeleton"/><div className="skeleton short"/><small>Собираем новости…</small></article><article className="empty"><span>EMPTY</span><strong>Пока тихо</strong><p>Новых трейлеров за неделю не появилось.</p><button className="kit-secondary">Проверить источники</button></article><article className="stale"><span>STALE</span><strong>Обновлено 3 часа назад</strong><p>Показываем последнюю сохранённую версию.</p><button className="kit-quiet">Повторить →</button></article></div>
          <div className="kit-block"><div className="kit-block-head"><h3>PARTIAL RESULT</h3><code>partial-state.tsx</code></div><div className="kit-partial"><div><span>18 / 21</span><strong>Источников обработано</strong><p>Briefing готов. Три Telegram-канала временно недоступны.</p></div><button className="kit-secondary">Показать детали</button><em>основное на месте</em></div></div>
        </section>

        <section className="kit-section" id="kurami">
          <header className="kit-section-head"><span>06</span><div><p className="kicker">KURAMI NOTES</p><h2>Заметки Курами</h2><p>Курами использует их для фокуса, контекста и характера. Одна заметка — одна цель. Всегда 1–4 слова.</p></div></header>
          <div className="kit-block"><div className="kit-block-head"><h3>INTENTS</h3><code>kurami-note.tsx</code></div><div className="kit-note-grid">{noteExamples.map(note => <div key={note.intent}><span>{note.intent}</span><strong style={{ transform: `rotate(${note.rotation})` }}>{note.text}</strong></div>)}</div></div>
          <div className="kit-two-col">
            <div className="kit-block do"><div className="kit-block-head"><h3>DO</h3><code>GROUNDED</code></div><ul><li>Привязывать к одному элементу</li><li>Сначала польза, потом характер</li><li>Не более одной шутки</li><li>Одинаковые правила на всех экранах</li></ul></div>
            <div className="kit-block dont"><div className="kit-block-head"><h3>DON’T</h3><code>NO NOISE</code></div><ul><li>Не пересказывать основной текст</li><li>Не шутить о серьёзных инцидентах</li><li>Не выдумывать факты</li><li>Не комментировать каждый блок</li></ul></div>
          </div>
        </section>

        <section className="kit-section" id="layouts">
          <header className="kit-section-head"><span>07</span><div><p className="kicker">LAYOUT GRAMMAR</p><h2>Не шаблоны, а правила</h2><p>Страница собирается из модулей. Жёсткими остаются сетка, ритм и порядок приоритетов.</p></div></header>
          <div className="kit-layouts"><div><span>HERO + SIGNALS</span><i className="layout-a"/></div><div><span>EDITORIAL FEED</span><i className="layout-b"/></div><div><span>DATA + ACTION</span><i className="layout-c"/></div></div>
        </section>

        <footer className="site-footer kit-footer"><div className="brand"><span className="brand-mark">H</span><span>HERMES AGENT</span></div><p>VISUAL LANGUAGE · DRAFT 0.4</p><a href="#top">НАВЕРХ ↑</a></footer>
      </article>
    </main>
  );
}
