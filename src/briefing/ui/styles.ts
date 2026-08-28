export const BRIEFING_STYLES = `
:root {
  color-scheme: light;
  --paper: #fbfbf8;
  --surface: #ffffff;
  --section: #f3f0e9;
  --panel: #f6f3ed;
  --ink: #0b0b0b;
  --muted: #62615c;
  --line: #c9c3b7;
  --line-soft: #ded9cf;
  --signal: #e4211b;
  --signal-soft: #fff0ed;
  --positive: #08783f;
  --warning: #a86400;
  --shadow: #d9d4ca;
  --font-sans: "Onest", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Fragment Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}

html[data-theme="dark"] {
  color-scheme: dark;
  --paper: #0b0b0a;
  --surface: #121211;
  --section: #181714;
  --panel: #1e1d19;
  --ink: #f7f4ec;
  --muted: #b9b5ac;
  --line: #4b4841;
  --line-soft: #33312d;
  --signal: #ff4a43;
  --signal-soft: #321815;
  --positive: #66d29b;
  --warning: #ffc267;
  --shadow: #050505;
}

* { box-sizing: border-box; }
[hidden] { display: none !important; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
  font: 400 16px/1.5 var(--font-sans);
  text-rendering: optimizeLegibility;
}
button, a, summary { -webkit-tap-highlight-color: transparent; }
button { font: inherit; }
a { color: inherit; }
.page-shell { width: min(calc(100% - 40px), 1280px); margin-inline: auto; }
.skip-link { position: fixed; left: 16px; top: -80px; z-index: 20; padding: 10px 14px; background: var(--signal); color: #fff; }
.skip-link:focus { top: 16px; }
.utility-header {
  min-height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border-bottom: 1px solid var(--line);
}
.utility-brand { font-weight: 600; letter-spacing: -.02em; }
.utility-meta { color: var(--muted); font-size: .8125rem; }
.utility-actions { display: flex; align-items: center; gap: 12px; }
.theme-toggle, .icon-button, .pagination__button {
  min-width: 44px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--ink);
  background: var(--surface);
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
}
.theme-toggle { padding: 10px 14px; }
.theme-toggle:hover, .icon-button:hover, .pagination__button:hover:not(:disabled) { border-color: var(--ink); background: var(--panel); }
:where(button, a, summary):focus-visible { outline: 2px solid var(--signal); outline-offset: 3px; }
.hero { padding: clamp(56px, 9vw, 112px) 0 clamp(40px, 6vw, 72px); }
.hero__eyebrow, .section-kicker {
  margin: 0 0 12px;
  color: var(--muted);
  font: 500 .75rem/1.25 var(--font-mono);
  letter-spacing: .06em;
  text-transform: uppercase;
}
.hero h1 { max-width: 18ch; margin: 0; font-size: clamp(2.75rem, 7vw, 5.25rem); font-weight: 600; line-height: .98; letter-spacing: -.055em; }
.hero__subtitle { max-width: 68ch; margin: 18px 0 0; color: var(--muted); font-size: clamp(1rem, 2vw, 1.25rem); }
.quality-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--line);
  border-left: 4px solid var(--warning);
  background: var(--panel);
}
.quality-strip[data-state="ready"] { border-left-color: var(--positive); }
.quality-strip__mark { font-weight: 600; }
.quality-strip p { margin: 0; color: var(--muted); }
.digest-feed { padding: clamp(56px, 8vw, 96px) 0; }
.digest-feed__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 24px;
  border-bottom: 3px solid var(--ink);
}
.digest-feed__header h2 { margin: 0; font-size: clamp(2.25rem, 5vw, 4.25rem); font-weight: 600; line-height: 1; letter-spacing: -.045em; }
.digest-feed__header h2[data-feed-heading] { scroll-margin-top: 28px; }
.digest-feed__header h2[data-feed-heading]:focus { outline: 2px solid var(--signal); outline-offset: 6px; }
.digest-feed__header p { margin: 10px 0 0; color: var(--muted); font-size: 1rem; }
.digest-feed__count { flex: none; color: var(--muted); font: 400 .75rem/1.4 var(--font-mono); text-transform: uppercase; }
.digest-feed__items { border-bottom: 1px solid var(--line); }
.news-story {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: clamp(14px, 2vw, 24px);
  padding: clamp(24px, 3vw, 36px) 0;
  border-bottom: 1px solid var(--line);
}
.news-story:last-child { border-bottom: 0; }
.news-story__index { padding-top: 3px; color: var(--signal); font: 400 .875rem/1.4 var(--font-mono); }
.news-story__meta { margin: 0 0 9px; color: var(--muted); font-size: .8125rem; }
.news-story h3 { max-width: 36ch; margin: 0; font-size: clamp(1.35rem, 2.4vw, 2rem); font-weight: 600; line-height: 1.13; letter-spacing: -.035em; }
.news-story__summary { max-width: 76ch; margin: 12px 0 0; color: var(--muted); font-size: 1rem; line-height: 1.55; }
.news-story__footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px 20px; margin-top: 18px; }
.topic-set { display: flex; flex-wrap: wrap; gap: 6px; }
.topic-chip {
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  padding: 4px 9px;
  border: 1px solid var(--line);
  border-radius: 5px;
  color: var(--muted);
  background: var(--panel);
  box-shadow: inset 0 -1px 0 var(--line-soft);
  font-size: .75rem;
  font-weight: 500;
  line-height: 1;
}
.source-link { font-size: .8125rem; font-weight: 600; text-decoration-thickness: 1px; text-underline-offset: 4px; }
.source-link:hover { color: var(--signal); }
.story-disclosure { margin-top: 14px; border-top: 1px dashed var(--line); }
.story-disclosure summary {
  width: max-content;
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding-top: 10px;
  list-style: none;
  font-size: .875rem;
  font-weight: 600;
  cursor: pointer;
}
.story-disclosure summary::-webkit-details-marker { display: none; }
.story-disclosure summary::after { content: "↓"; color: var(--signal); }
.story-disclosure[open] summary::after { content: "↑"; }
.story-disclosure .when-open { display: none; }
.story-disclosure[open] .when-open { display: inline; }
.story-disclosure[open] .when-closed { display: none; }
.story-disclosure__body {
  max-width: 76ch;
  margin-top: 12px;
  padding: 18px 20px;
  border-left: 4px solid var(--signal);
  background: var(--signal-soft);
}
.story-disclosure__body p { margin: 0; line-height: 1.65; }
.story-disclosure__body p + p { margin-top: 12px; }
.reaction-group { display: flex; gap: 6px; }
.reaction-group .icon-button { font-size: 17px; }
.reaction-group .icon-button[aria-pressed="true"] { color: #fff; border-color: var(--signal); background: var(--signal); }
.reaction-group .icon-button[aria-busy="true"] { opacity: .55; cursor: wait; }
.pagination { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding-top: 24px; }
.pagination__button { padding: 10px 15px; }
.pagination__button:last-child { justify-self: end; }
.pagination__button:disabled { opacity: .38; cursor: not-allowed; }
.pagination__status { color: var(--muted); font: 400 .75rem/1 var(--font-mono); }
.page-footer { display: flex; justify-content: space-between; gap: 20px; padding: 28px 0 48px; border-top: 1px solid var(--line); color: var(--muted); font-size: .75rem; }

@media (max-width: 720px) {
  .page-shell { width: min(calc(100% - 28px), 1280px); }
  .utility-meta, .theme-toggle [data-theme-label] { display: none; }
  .theme-toggle { padding-inline: 0; }
  .hero { padding-top: 48px; }
  .digest-feed__header { align-items: start; flex-direction: column; gap: 10px; }
  .news-story { grid-template-columns: 28px minmax(0, 1fr); }
  .news-story__reactions { grid-column: 2; grid-row: 2; margin-top: 16px; }
  .news-story h3 { max-width: none; }
  .news-story__footer { align-items: flex-start; flex-direction: column; }
  .pagination__button { padding-inline: 11px; font-size: .8125rem; }
  .page-footer { flex-direction: column; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
}
`;
