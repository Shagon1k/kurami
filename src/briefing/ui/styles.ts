export const BRIEFING_STYLES = `
:root {
  color-scheme: light;
  --paper: #fbfbf8;
  --surface: #ffffff;
  --section: #f1eee5;
  --panel: #faf8f2;
  --ink: #0b0b0b;
  --muted: #5e5e59;
  --signal: #e21b16;
  --line: #c9c3b7;
  --grid: #d8d8d1;
  --signal-soft: #fff0ed;
  --section-shadow: #d9d4c9;
  --positive: #147844;
  --warning: #9b5b00;
  --font-sans: "Onest", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Fragment Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-note: "Caveat", "Segoe Print", cursive;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --paper: #0a0a0a;
  --surface: #111110;
  --section: #171714;
  --panel: #1d1d19;
  --ink: #f7f7f3;
  --muted: #aaa9a2;
  --signal: #ff4b45;
  --line: #44443e;
  --grid: #292927;
  --signal-soft: #2a1110;
  --section-shadow: #050505;
  --positive: #67e5a0;
  --warning: #ffd06e;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; }
body { margin: 0; color: var(--ink); background: var(--paper); font: 400 16px/1.5 var(--font-sans); text-rendering: optimizeLegibility; }
button, a { -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
a { color: inherit; }
.page-shell { width: min(1320px, calc(100% - 48px)); margin-inline: auto; }
.skip-link { position: fixed; left: 16px; top: -80px; z-index: 50; padding: 10px 14px; color: #fff; background: var(--signal); }
.skip-link:focus { top: 16px; }
.sr-only { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0, 0, 0, 0) !important; white-space: nowrap !important; border: 0 !important; }

.utility-header { position: sticky; top: 0; z-index: 30; width: 100%; color: var(--ink); background: color-mix(in srgb, var(--paper) 94%, transparent); border-bottom: 1px solid var(--line); backdrop-filter: blur(14px); transition: box-shadow 160ms ease, border-color 160ms ease, background 160ms ease; }
.utility-header.is-scrolled { background: color-mix(in srgb, var(--paper) 97%, transparent); border-bottom-color: color-mix(in srgb, var(--line) 72%, var(--ink)); box-shadow: 0 8px 22px color-mix(in srgb, var(--ink) 10%, transparent); }
.utility-header__inner { min-height: 74px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 24px; padding-block: 10px; }
.utility-brand { display: inline-flex; align-items: center; gap: 10px; font-size: .875rem; font-weight: 600; letter-spacing: -.01em; }
.utility-brand__mark { inline-size: 26px; block-size: 26px; display: inline-grid; place-items: center; color: #fff; background: var(--ink); border-radius: 2px; font: 600 .6875rem/1 var(--font-mono); }
.utility-meta { color: var(--muted); font-size: .75rem; }
.utility-actions { justify-self: end; }
.theme-toggle, .icon-button { inline-size: 44px; block-size: 44px; display: inline-grid; place-items: center; padding: 0; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 3px; cursor: pointer; font-weight: 600; line-height: 1; text-decoration: none; transition: color 150ms, background 150ms, border-color 150ms, transform 150ms; }
.theme-toggle { font-size: 19px; }
.theme-toggle:hover, .icon-button:hover { border-color: var(--signal); }
.theme-toggle:active, .icon-button:active, .story-toggle:active, .pagination__button:active { transform: translateY(1px); }
:where(button, a):focus-visible { outline: 3px solid var(--signal); outline-offset: 4px; }

.hero { position: relative; min-height: 310px; display: grid; grid-template-columns: minmax(0, 1fr) 280px; align-items: end; gap: 40px; padding: 70px 0 38px; }
.hero__eyebrow, .section-kicker { margin: 0 0 10px; color: var(--muted); font: 400 .625rem/1.3 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.hero h1 { max-width: 850px; margin: 0; font-size: clamp(44px, 6vw, 76px); font-weight: 600; line-height: 1.02; letter-spacing: -.055em; }
.hero__subtitle { max-width: 760px; margin: 14px 0 0; color: var(--muted); font-size: clamp(17px, 2vw, 21px); line-height: 1.45; }
.kurami-note { color: var(--signal); font: 600 24px/1 var(--font-note); }
.hero__note { align-self: center; justify-self: end; padding-right: 14px; transform: rotate(-3deg); }

.metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--panel); border: 1px solid var(--line); }
.metric-card { min-height: 156px; display: grid; grid-template-rows: auto auto 1fr auto; gap: 5px; padding: 20px; border-right: 1px solid var(--line); }
.metric-card:last-child { border-right: 0; }
.metric-card__label { color: var(--muted); font-size: .75rem; }
.metric-card__value { font-size: clamp(2rem, 3.4vw, 2.375rem); font-weight: 600; line-height: 1; letter-spacing: -.045em; }
.metric-card__context { align-self: end; margin: 0; color: var(--muted); font-size: .6875rem; }
.metric-card__chip { width: max-content; min-height: 25px; display: inline-flex; align-items: center; justify-content: center; padding: 3px 8px; color: var(--positive); border: 1px solid currentColor; border-radius: 5px; font-size: .625rem; font-weight: 600; line-height: 1; }
.metric-card__chip.warning { color: var(--warning); }

.digest-feed { position: relative; scroll-margin-top: 78px; margin-top: 46px; padding: 46px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.digest-feed__note { position: absolute; right: 16px; top: 23px; color: var(--signal); transform: rotate(-2deg); }
.digest-feed__header { display: flex; align-items: end; justify-content: space-between; gap: 30px; padding: 0 0 24px; }
.digest-feed__header h2 { margin: 0; font-size: clamp(36px, 4vw, 54px); font-weight: 600; line-height: 1; letter-spacing: -.05em; scroll-margin-top: 84px; }
.digest-feed__header h2:focus { outline: 2px solid var(--signal); outline-offset: 6px; }
.digest-feed__header p:last-child { margin: 8px 0 0; color: var(--muted); font-size: .75rem; }
.digest-feed__count { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; padding: 5px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 5px; font-size: .6875rem; font-weight: 600; line-height: 1; }
.digest-feed__items { border-top: 1px solid var(--line); }

.news-story { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 18px; align-items: start; padding: 25px 8px; border-bottom: 1px solid var(--line); transition: background 150ms ease; }
.news-story.has-media { grid-template-columns: 36px 176px minmax(0, 1fr) auto; }
.news-story:hover, .news-story:focus-within, .news-story.is-expanded { background: color-mix(in srgb, var(--section) 52%, transparent); }
.news-story__index { padding-top: 3px; color: var(--muted); font: 400 .625rem/1.4 var(--font-mono); }
.news-story__copy { grid-column: 2; min-width: 0; }
.news-story.has-media .news-story__copy { grid-column: 3; }
.news-story__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--muted); font-size: .6875rem; }
.news-story__provider { min-height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 6px; color: var(--signal); border: 1px solid currentColor; border-radius: 4px; font-weight: 600; line-height: 1; }
.news-story__channel { color: var(--ink); font-weight: 600; }
.news-story__time::before { content: "·"; margin-right: 6px; }
.news-story__read-state { min-height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 6px; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; font-size: .625rem; font-weight: 600; line-height: 1; }
.news-story:not(.is-read) .news-story__read-state { display: none; }
.news-story h3 { max-width: 900px; margin: 9px 0 6px; font-size: clamp(19px, 2.3vw, 29px); font-weight: 600; line-height: 1.12; letter-spacing: -.03em; }
.news-story__summary { max-width: 800px; margin: 0; color: var(--muted); font-size: .8125rem; line-height: 1.5; }
.topic-set { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
.topic-chip { min-height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 7px; color: var(--muted); background: color-mix(in srgb, var(--panel) 72%, transparent); border: 1px solid var(--line); border-radius: 4px; font-size: .625rem; font-weight: 500; line-height: 1; }
.news-story__actions { grid-column: 3; display: flex; gap: 6px; }
.news-story.has-media .news-story__actions { grid-column: 4; }
.news-story__actions .reaction-group { display: contents; }
.story-toggle, .news-story__source { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 3px; cursor: pointer; font-size: .75rem; font-weight: 600; line-height: 1; text-decoration: none; transition: color 150ms, background 150ms, border-color 150ms, transform 150ms; }
.story-toggle { min-width: 84px; }
.story-toggle:hover, .news-story__source:hover { border-color: var(--signal); }
.news-story__actions .icon-button[aria-pressed="true"] { color: #fff; background: var(--signal); border-color: var(--signal); }
.news-story__actions .icon-button[aria-busy="true"] { opacity: .55; cursor: wait; }
.story-cover { position: relative; grid-column: 2; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; background: var(--section); border: 1px solid var(--line); border-radius: 3px; }
.story-cover img { width: 100%; height: 100%; display: block; object-fit: cover; transition: transform 220ms ease, filter 220ms ease; }
.story-cover:hover img { transform: scale(1.025); filter: contrast(1.03); }
.story-cover__count { position: absolute; right: 7px; bottom: 7px; min-width: 28px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center; padding: 3px 7px; color: #fff; background: #000c; border: 1px solid #ffffff55; border-radius: 3px; font-size: .625rem; font-weight: 600; line-height: 1; }
.story-disclosure__body { grid-column: 1 / -1; width: 100%; display: grid; gap: 22px; padding: 24px 28px; background: var(--panel); border-left: 4px solid var(--ink); }
.story-disclosure__copy { display: grid; gap: 10px; }
.story-disclosure__body p { margin: 0; font-size: .8125rem; line-height: 1.62; }
.story-disclosure__body p + p { margin-top: 4px; }
.story-disclosure__body .source-link { width: max-content; margin-top: 6px; font-size: .75rem; font-weight: 600; text-underline-offset: 4px; }
.story-media { display: grid; gap: 12px; padding-top: 18px; border-top: 1px solid var(--line); }
.story-media__heading { display: flex; align-items: center; gap: 8px; }
.story-media__heading strong { font-size: .8125rem; font-weight: 600; }
.story-media__heading span { min-width: 22px; min-height: 22px; display: inline-flex; align-items: center; justify-content: center; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; font: 400 .5625rem/1 var(--font-mono); }
.story-media__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 10px; }
.story-media__item { min-width: 0; margin: 0; overflow: hidden; background: var(--section); border: 1px solid var(--line); border-radius: 3px; }
.story-media__item--image { display: block; aspect-ratio: 16 / 10; }
.story-media__item img, .story-media__item video { width: 100%; height: 100%; display: block; object-fit: cover; }
.story-media__item--image img { transition: transform 220ms ease; }
.story-media__item--image:hover img { transform: scale(1.018); }
.story-media__item--video { display: grid; grid-template-rows: minmax(180px, 320px) auto; }
.story-media__item--video video { max-height: 320px; background: #090909; object-fit: contain; }
.story-media__item figcaption { padding: 9px 11px; color: var(--muted); background: var(--panel); font-size: .625rem; }

.media-lightbox { width: min(1120px, calc(100% - 40px)); max-width: none; height: min(88vh, 900px); max-height: none; margin: auto; padding: 44px 18px 18px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 4px; box-shadow: 0 26px 80px #0008; }
.media-lightbox::backdrop { background: #000b; backdrop-filter: blur(5px); }
.media-lightbox[open] { display: grid; place-items: center; }
.media-lightbox img { max-width: 100%; max-height: calc(88vh - 70px); display: block; object-fit: contain; }
.media-lightbox__close { position: absolute; right: 10px; top: 8px; inline-size: 34px; block-size: 34px; display: inline-grid; place-items: center; padding: 0; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 3px; cursor: pointer; font-size: 1.25rem; line-height: 1; }

.pagination { min-height: 78px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.pagination__range { color: var(--muted); font-size: .6875rem; }
.pagination__controls { display: flex; align-items: center; gap: 5px; }
.pagination__button { min-width: 42px; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 11px; color: var(--ink); background: transparent; border: 1px solid transparent; border-radius: 3px; cursor: pointer; font-size: .6875rem; font-weight: 600; line-height: 1; transition: color 150ms, background 150ms, border-color 150ms, transform 150ms; }
.pagination__button:hover:not(:disabled):not([aria-current="page"]) { background: var(--panel); border-color: var(--line); }
.pagination__button[aria-current="page"] { color: #fff; background: var(--signal); border-color: var(--signal); }
.pagination__button[data-page-prev], .pagination__button[data-page-next] { min-width: 42px; padding-inline: 0; font-size: 1rem; }
.pagination__button:disabled { color: var(--muted); cursor: default; opacity: .45; }

.quality-strip { min-height: 92px; display: flex; align-items: center; justify-content: space-between; gap: 30px; margin: 38px 0; padding: 18px 20px; border-left: 4px solid var(--warning); background: var(--panel); }
.quality-strip[data-state="ready"] { border-left-color: var(--positive); }
.quality-strip__heading { display: grid; gap: 4px; }
.quality-strip__heading span { color: var(--warning); font-size: .5625rem; font-weight: 600; letter-spacing: .08em; }
.quality-strip[data-state="ready"] .quality-strip__heading span { color: var(--positive); }
.quality-strip__heading strong { font-size: .8125rem; font-weight: 600; }
.quality-strip p { max-width: 680px; margin: 0; color: var(--muted); font-size: .6875rem; text-align: right; }
.page-footer { min-height: 94px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px; color: var(--muted); border-top: 1px solid var(--line); font-size: .625rem; }
.page-footer span:last-child { justify-self: end; }

@media (max-width: 900px) {
  .utility-header__inner { grid-template-columns: 1fr auto; }
  .utility-meta { display: none; }
  .hero { grid-template-columns: 1fr; min-height: 280px; }
  .hero__note { position: absolute; right: 10px; bottom: 36px; }
  .metric-strip { grid-template-columns: 1fr 1fr; }
  .metric-card:nth-child(2) { border-right: 0; }
  .metric-card:nth-child(n+3) { border-top: 1px solid var(--line); }
  .news-story { grid-template-columns: 32px minmax(0, 1fr); }
  .news-story__actions { grid-column: 2; }
  .news-story.has-media { grid-template-columns: 32px 144px minmax(0, 1fr); }
  .news-story.has-media .news-story__copy, .news-story.has-media .news-story__actions { grid-column: 3; }
  .story-disclosure__body { grid-column: 1 / -1; }
  .digest-feed__note { position: static; display: block; width: max-content; margin: 0 0 18px auto; }
}

@media (max-width: 620px) {
  .page-shell { width: min(100% - 28px, 1320px); }
  .utility-header__inner { min-height: 66px; padding-block: 8px; }
  .utility-brand__mark { display: none; }
  .hero { min-height: 260px; padding-top: 50px; }
  .hero__note { bottom: 26px; font-size: 21px; }
  .metric-card { min-height: 140px; padding: 16px; }
  .digest-feed { margin-top: 32px; padding: 36px 0; }
  .digest-feed__header { align-items: start; flex-direction: column; gap: 10px; }
  .news-story { grid-template-columns: 24px minmax(0, 1fr); gap: 10px; padding: 22px 2px; }
  .news-story.has-media { grid-template-columns: 24px minmax(0, 1fr); }
  .news-story.has-media .story-cover, .news-story.has-media .news-story__copy, .news-story.has-media .news-story__actions { grid-column: 2; }
  .story-cover { aspect-ratio: 16 / 9; margin-bottom: 4px; }
  .news-story__actions { flex-wrap: wrap; }
  .story-toggle { flex: 1; }
  .story-disclosure__body { grid-column: 1 / -1; padding: 18px; }
  .story-media__grid { grid-template-columns: 1fr; }
  .pagination { align-items: flex-start; flex-direction: column; padding: 18px 0; }
  .pagination__controls { width: 100%; justify-content: space-between; }
  .pagination__button[data-page] { display: none; }
  .pagination__button[data-page][aria-current="page"] { display: inline-flex; }
  .quality-strip { align-items: flex-start; flex-direction: column; gap: 10px; }
  .quality-strip p { text-align: left; }
  .page-footer { grid-template-columns: 1fr; padding: 24px 0; }
  .page-footer span:last-child { justify-self: start; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  * { transition-duration: 0.01ms !important; }
}
`;
