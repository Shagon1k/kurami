"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Reaction = "like" | "dislike";
type BatchState = "idle" | "confirm" | "success";

const storySeeds = [
  ["AI Практика", "AI", "Локальные агенты учатся выполнять больше задач без облака", "Новые рантаймы оставляют персональный контекст на устройстве и передают наружу только результат.", "12 мин назад"],
  ["Код Дурова", "PRODUCT", "Telegram расширил инструменты для mini apps", "Разработчикам добавили новые события, состояния интерфейса и более предсказуемую навигацию.", "24 мин назад"],
  ["Веб-стандарты", "WEB", "Браузеры согласовали следующий этап развития Web Components", "Повторно используемые элементы получают единообразные API и меньше расхождений между движками.", "41 мин назад"],
  ["Кино сегодня", "КИНО", "Студии пересматривают календарь осенних премьер", "Несколько крупных релизов получили новые даты проката после перестановок в расписании.", "58 мин назад"],
  ["Продуктовая среда", "PRODUCT", "Команды возвращают короткие текстовые changelog вместо длинных презентаций", "Небольшие заметки о решениях помогают быстрее восстановить контекст после релиза.", "1 ч назад"],
  ["AI Практика", "AI", "Открытые модели получили компактные режимы для персональных устройств", "Производители оптимизируют память и скорость для ноутбуков без дискретной видеокарты.", "1 ч назад"],
  ["Инфраструктура", "DEV", "Scheduled jobs всё чаще проектируют как повторяемые операции", "Идемпотентность становится обязательной частью фоновых задач и ежедневных дайджестов.", "1 ч назад"],
  ["Дизайн-системы", "DESIGN", "Интерфейсы возвращаются к более плотным информационным спискам", "Продукты сокращают декоративные карточки там, где важнее быстрое чтение и сравнение.", "2 ч назад"],
  ["Кино сегодня", "КИНО", "Новые трейлеры недели смещают акцент на оригинальные истории", "В подборках стало меньше продолжений и больше самостоятельных проектов среднего бюджета.", "2 ч назад"],
  ["Безопасность", "SECURITY", "Разрешения AI-инструментов становятся видимой частью интерфейса", "Пользователь получает отдельные объяснения для файлов, сети и длительного фонового доступа.", "2 ч назад"],
  ["Продуктовая среда", "PRODUCT", "Утренние сводки начинают учитывать уже просмотренные темы", "Повторяющиеся сюжеты объединяют, сохраняя только действительно новые детали.", "3 ч назад"],
  ["Веб-стандарты", "WEB", "CSS получает новые способы связывать компоненты с контейнером", "Адаптивность всё меньше зависит от размеров всего окна и больше — от локального контекста.", "3 ч назад"],
  ["AI Практика", "AI", "Агентные системы разделяют планирование и выполнение", "Отдельные модели отвечают за выбор шага, проверку результата и работу с инструментами.", "3 ч назад"],
  ["Инфраструктура", "DEV", "Команды упрощают наблюдение за небольшими cron-процессами", "Вместо тяжёлых панелей используют короткие отчёты о запуске, задержках и повторных попытках.", "4 ч назад"],
  ["Кино сегодня", "КИНО", "Кинотеатры тестируют более гибкие окна для специальных показов", "Репертуарные фильмы возвращают на один-два вечера без изменения основного расписания.", "4 ч назад"],
  ["Дизайн-системы", "DESIGN", "Текстовые кнопки снова заменяют неоднозначные иконки", "Команды оставляют пиктограммы только для действий с устоявшимся визуальным значением.", "5 ч назад"],
  ["Безопасность", "SECURITY", "Локальное хранение предпочтений требует понятного срока жизни", "Пользователю предлагают видеть, какие сигналы сохранены и когда они будут удалены.", "5 ч назад"],
  ["Продуктовая среда", "PRODUCT", "Небольшие персональные инструменты уходят от универсальных dashboard", "Один хорошо настроенный ежедневный сценарий оказывается полезнее набора пустых виджетов.", "5 ч назад"],
  ["AI Практика", "AI", "Оценки нравится и не нравится используют как мягкий сигнал", "Модели учитывают реакцию вместе с темой, источником и временем чтения, не делая вывод по одному клику.", "6 ч назад"],
  ["Веб-стандарты", "WEB", "Доступность интерактивных списков проверяют ещё до визуального QA", "Фокус, раскрытие и навигация между страницами становятся частью базового component contract.", "6 ч назад"],
  ["Кино сегодня", "КИНО", "Прокатчики публикуют больше коротких роликов вместо одного трейлера", "Разные версии материала ориентируют на жанр, актёров и визуальный стиль фильма.", "7 ч назад"],
  ["Инфраструктура", "DEV", "Новые пайплайны сохраняют исходную пачку данных для повторного рендера", "Снимок позволяет перестроить страницу без повторного чтения внешних источников.", "7 ч назад"],
  ["Дизайн-системы", "DESIGN", "Тёмные темы переходят от инверсии к отдельным семантическим токенам", "Предупреждения и статусы получают собственные контрастные цвета для тёмного фона.", "8 ч назад"],
  ["Безопасность", "SECURITY", "Массовые действия всё чаще показывают точную границу изменений", "Интерфейс сообщает количество объектов и момент времени, после которого новые данные не затрагиваются.", "8 ч назад"],
  ["Продуктовая среда", "PRODUCT", "Пагинация возвращается в длинные персональные ленты", "Пользователям проще сохранять место и понимать объём, чем в бесконечном потоке материалов.", "9 ч назад"],
  ["AI Практика", "AI", "Модели учатся объяснять причину персональной рекомендации", "Короткое пояснение помогает отличить совпадение по теме от действительно важного сигнала.", "9 ч назад"],
  ["Кино сегодня", "КИНО", "Еженедельные кино-сводки объединяют премьеры и доступные сеансы", "Один экран показывает новые трейлеры, даты выхода и фильмы, которые ещё идут рядом.", "10 ч назад"],
  ["Веб-стандарты", "WEB", "View transitions становятся спокойнее и короче", "Интерфейсы используют движение для сохранения контекста, а не как самостоятельное украшение.", "10 ч назад"],
  ["Инфраструктура", "DEV", "Состояния partial и stale перестают маскировать под успешную загрузку", "Страницы честно показывают, какая часть данных не обновилась и когда была получена последняя версия.", "11 ч назад"],
  ["Продуктовая среда", "PRODUCT", "Персональные дайджесты отделяют сбор данных от отображения", "Независимый визуальный слой позволяет менять источники, не перестраивая интерфейс целиком.", "12 ч назад"],
] as const;

const topicDetails: Record<string, { importance: string; facts: string[] }> = {
  AI: { importance: "Это показывает, как персональные агенты становятся самостоятельнее, сохраняя контроль над пользовательскими данными.", facts: ["Фокус на локальном исполнении", "Явные границы доступа", "Меньше передачи лишнего контекста"] },
  PRODUCT: { importance: "Сигнал касается ежедневных привычек и того, как продукт помогает принимать решения без лишнего шума.", facts: ["Короче путь до действия", "Сохраняется контекст", "Поведение остаётся объяснимым"] },
  WEB: { importance: "Изменение влияет на повторно используемые интерфейсы и уменьшает количество специальных обходных решений.", facts: ["Единое поведение в браузерах", "Компоненты проще переносить", "Меньше связности с размером окна"] },
  "КИНО": { importance: "Это помогает заранее понять, что появится в прокате и на что стоит оставить время в ближайшие недели.", facts: ["Обновились даты или формат показа", "Изменение влияет на расписание", "Оригинальный источник содержит детали"] },
  DEV: { importance: "Подход делает фоновые процессы предсказуемее и упрощает восстановление после неудачного запуска.", facts: ["Повторный запуск безопасен", "Сохраняется исходная пачка", "Ошибки видны отдельно от результата"] },
  DESIGN: { importance: "Тенденция напрямую влияет на читаемость плотных ежедневных страниц и понятность действий.", facts: ["Меньше декоративного шума", "Контролы остаются однозначными", "Состояния видны без цвета"] },
  SECURITY: { importance: "Пользователь должен понимать, что именно изменится и какие данные доступны автоматическому сценарию.", facts: ["Граница действия обозначена", "Разрешения объяснены", "Новые данные не затрагиваются молча"] },
};

const topicPools: Record<string, string[]> = {
  AI: ["ИИ", "AI-агенты", "Локальные модели", "Приватность", "Инструменты", "Персонализация"],
  PRODUCT: ["Продукты", "UX", "Персонализация", "Дайджесты", "Продуктивность", "Автоматизация"],
  WEB: ["Веб", "Web Components", "CSS", "Браузеры", "Доступность", "Frontend"],
  "КИНО": ["Кино", "Премьеры", "Трейлеры", "Прокат", "Стриминг", "Индустрия"],
  DEV: ["Разработка", "Инфраструктура", "Cron", "Надёжность", "Наблюдаемость", "Автоматизация"],
  DESIGN: ["Дизайн", "UI", "Дизайн-системы", "Типографика", "Доступность", "Dark mode"],
  SECURITY: ["Безопасность", "Приватность", "Разрешения", "Данные", "Контроль доступа", "Локальное хранение"],
};

const selectTopics = (topic: string, index: number) => {
  const pool = topicPools[topic];
  return [pool[0], ...[0, 2, 4].map((offset) => pool[1 + ((index + offset) % (pool.length - 1))])];
};

const news = storySeeds.map(([channel, topic, title, summary, time], index) => ({
  id: String(index + 1).padStart(2, "0"),
  channel,
  topic,
  title,
  summary,
  time,
  topics: selectTopics(topic, index),
  ...topicDetails[topic],
}));

const schedule = [
  ["09:30", "Product sync", "30 мин"],
  ["11:00", "Design review", "45 мин"],
  ["14:00", "Фокус-блок", "2 ч 30 м"],
  ["18:30", "Тренировка", "1 ч"],
];

const priorities = [
  "Подготовить решение по Telegram unread state",
  "Проверить новый digest feed на длинной выборке",
  "Ответить хостингу после обеда",
];

export function ReferenceBriefing() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>("01");
  const [reactions, setReactions] = useState<Record<string, Reaction | undefined>>({ "03": "like", "08": "dislike" });
  const [batchState, setBatchState] = useState<BatchState>("idle");
  const pageSize = 10;
  const pageCount = Math.ceil(news.length / pageSize);
  const pageItems = useMemo(() => news.slice((page - 1) * pageSize, page * pageSize), [page]);

  useEffect(() => {
    const saved = window.localStorage.getItem("hermes-theme");
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    // Hydrate the persisted preference after the client mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(saved === "dark" || saved === "light" ? saved : preferred);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    window.localStorage.setItem("hermes-theme", next);
  };

  const changePage = (nextPage: number) => {
    const safePage = Math.max(1, Math.min(pageCount, nextPage));
    setPage(safePage);
    setExpandedId(null);
    window.history.replaceState(null, "", `${window.location.pathname}?newsPage=${safePage}#reference-news`);
    window.requestAnimationFrame(() => document.getElementById("reference-news")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const react = (id: string, reaction: Reaction) => {
    setReactions((current) => ({ ...current, [id]: current[id] === reaction ? undefined : reaction }));
  };

  return (
    <main className="site-shell ref-shell" data-theme={theme}>
      <header className="ref-nav">
        <Link href="/briefing-reference" className="ref-brand">DAILY BRIEFING</Link>
        <span>27 августа 2026 · четверг</span>
        <div><Link href="/components">Components</Link><button type="button" onClick={toggleTheme} aria-label="Переключить цветовую тему">{theme === "light" ? "◐" : "◑"}</button></div>
      </header>

      <article className="ref-page" id="top">
        <header className="ref-hero">
          <div><p className="ref-kicker">УТРЕННИЙ ОБЗОР · DEMO DATA</p><h1>Доброе утро, Alex.</h1><p>Сегодня есть длинное окно для работы и тридцать новых материалов в утренней пачке.</p></div>
          <span className="ref-note note-red">утро без ленты →</span>
        </header>

        <section className="ref-metrics" aria-label="Краткий обзор дня">
          <article><span>Встречи</span><strong>4</strong><p>1 ч 45 м суммарно</p><small>−1 ко вчера</small></article>
          <article><span>Фокус</span><strong>4 ч</strong><p>цель 5 часов</p><small>+35 мин к плану</small></article>
          <article><span>Новые материалы</span><strong>30</strong><p>из 8 каналов</p><small>10 на странице</small></article>
          <article><span>Погода</span><strong>+20°</strong><p>ясно до 18:00</p><small className="warning">дождь 20%</small></article>
        </section>

        <section className="ref-day-grid">
          <div className="ref-paper-block">
            <header><h2>Расписание</h2><span>без конфликтов</span></header>
            <div className="ref-schedule">{schedule.map(([time, title, duration]) => <div key={time}><time>{time}</time><strong>{title}</strong><span>{duration}</span></div>)}</div>
          </div>
          <div className="ref-priorities">
            <header><h2>Приоритеты</h2><span>по порядку</span></header>
            <ol>{priorities.map((priority, index) => <li key={priority}><span>{String(index + 1).padStart(2, "0")}</span><strong>{priority}</strong><small>{index === 0 ? "high" : index === 1 ? "medium" : "low"}</small></li>)}</ol>
            <span className="ref-note note-ink">вот это главное →</span>
          </div>
        </section>

        <section className="ref-news" id="reference-news" aria-labelledby="reference-news-title">
          <header className="ref-news-head">
            <div><p className="ref-kicker">УТРЕННЯЯ ПАЧКА</p><h2 id="reference-news-title">Новости</h2><p>30 материалов · собрано в 08:10 · demo dataset</p></div>
            <span className="ref-source-facet">Telegram · 30</span>
          </header>

          <div className="ref-news-list">
            {pageItems.map((item) => {
              const expanded = expandedId === item.id;
              const reaction = reactions[item.id];
              return (
                <article className={`ref-news-item${expanded ? " expanded" : ""}`} key={item.id}>
                  <span className="ref-news-index">{item.id}</span>
                  <div className="ref-news-copy">
                    <div className="ref-news-meta"><span>Telegram</span><strong>{item.channel}</strong><time>{item.time}</time></div>
                    <h3>{item.title}</h3>
                    <p>{item.summary}</p>
                    <div className="ref-topic-set" aria-label="Темы материала">{item.topics.map((topicLabel) => <span key={topicLabel}>{topicLabel}</span>)}</div>
                    {expanded && <div className="ref-reader"><strong>Почему важно</strong><p>{item.importance}</p><strong>Главное</strong><ul>{item.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul><a href="https://t.me" target="_blank" rel="noreferrer">Перейти к источнику ↗</a></div>}
                  </div>
                  <div className="ref-news-actions">
                    <button type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : item.id)}>{expanded ? "Свернуть" : "Читать"}</button>
                    <a href="https://t.me" target="_blank" rel="noreferrer" aria-label={`Перейти к источнику: ${item.title}`}>↗</a>
                    <button type="button" className={reaction === "like" ? "active" : ""} aria-label={`Нравится: ${item.title}`} aria-pressed={reaction === "like"} onClick={() => react(item.id, "like")}>👍</button>
                    <button type="button" className={reaction === "dislike" ? "active" : ""} aria-label={`Не нравится: ${item.title}`} aria-pressed={reaction === "dislike"} onClick={() => react(item.id, "dislike")}>👎</button>
                  </div>
                </article>
              );
            })}
          </div>

          <nav className="ref-pagination" aria-label="Страницы новостей">
            <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, news.length)} из {news.length}</span>
            <div><button type="button" disabled={page === 1} onClick={() => changePage(page - 1)}>← Новее</button>{Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => <button type="button" key={number} aria-current={page === number ? "page" : undefined} onClick={() => changePage(number)}>{number}</button>)}<button type="button" disabled={page === pageCount} onClick={() => changePage(page + 1)}>Старее →</button></div>
          </nav>

          <section className={`ref-bulk-action ${batchState}`} aria-live="polite">
            {batchState === "idle" && <><div><span>TELEGRAM</span><h3>Готово с этой пачкой?</h3><p>В сводку вошло 30 сообщений из 8 каналов, собранных до 08:10.</p></div><button type="button" onClick={() => setBatchState("confirm")}>Отметить Telegram-сообщения прочитанными</button><small>Новые сообщения после 08:10 останутся непрочитанными.</small></>}
            {batchState === "confirm" && <><div><span>ПОДТВЕРЖДЕНИЕ</span><h3>Отметить 30 сообщений прочитанными?</h3><p>Действие относится только к этой зафиксированной demo-пачке.</p></div><div className="ref-bulk-buttons"><button type="button" onClick={() => setBatchState("idle")}>Отмена</button><button className="confirm" type="button" onClick={() => setBatchState("success")}>Подтвердить</button></div></>}
            {batchState === "success" && <div className="ref-bulk-success"><span>✓</span><div><h3>Telegram-сообщения отмечены прочитанными</h3><p>Следующая сводка начнётся с новых публикаций.</p></div></div>}
            <span className="ref-note note-action">пачка закрыта</span>
          </section>
        </section>

        <section className="ref-quality"><div><span>КАЧЕСТВО ДАННЫХ</span><strong>Demo dataset · 30 из 30 материалов готовы</strong></div><p>Интеграция с реальными источниками будет подключена отдельным workflow.</p></section>

        <footer className="ref-footer"><span>Daily Briefing · эталонная страница</span><Link href="/components">Visual language 0.5</Link><a href="#top">Наверх ↑</a></footer>
      </article>
    </main>
  );
}
