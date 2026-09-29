import { CHART_STYLES } from "./charts/styles.ts";
import {WEEKLY_STYLES} from "../weekly/styles.ts";
import {STOCKS_STYLES} from "../stocks/styles.ts";
import {COMPANY_AVATAR_STYLES} from "./components/company-avatar.ts";
import {KURAMI_COMMENT_STYLES} from "./components/kurami-comment.ts";
import {THEME_CSS} from "../../ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../../ui-library/foundations/index.ts";
import {BUTTON_CSS} from "../../ui-library/components/button.ts";
import {THEME_SWITCH_CSS} from "../../ui-library/components/theme-switch.ts";
import {SITE_HEADER_CSS} from "../../ui-library/patterns/site-header.ts";
export const BRIEFING_STYLES = `
${THEME_CSS}
${FOUNDATION_CSS}
:root {
  --header-offset: 104px;
  --container-max: 1320px;
}

${BUTTON_CSS}
${THEME_SWITCH_CSS}
${SITE_HEADER_CSS}

#main,h2[id],section[id] { scroll-margin-top:var(--header-offset); }
.icon-button { inline-size: 44px; block-size: 44px; display: inline-grid; place-items: center; padding: 0; color: var(--text-primary); background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: 3px; cursor: pointer; font-weight: 600; line-height: 1; text-decoration: none; transition: color 150ms, background 150ms, border-color 150ms, transform 150ms; }
.icon-button:hover { border-color: var(--accent-primary); }
.icon-button:active, .story-toggle:active, .pagination__button:active { transform: translateY(1px); }
:where(button, a):focus-visible { outline: 3px solid var(--accent-primary); outline-offset: 4px; }

.hero { position: relative; min-height: 310px; display: grid; grid-template-columns: minmax(0, 1fr) 280px; align-items: end; gap: 40px; padding: 70px 0 38px; }
.hero__eyebrow, .section-kicker { margin: 0 0 10px; color: var(--text-muted); font: 400 .625rem/1.3 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.hero h1 { max-width: 850px; margin: 0; font-size: clamp(44px, 6vw, 76px); font-weight: 600; line-height: 1.02; letter-spacing: -.055em; }
.hero__subtitle { max-width: 760px; margin: 14px 0 0; color: var(--text-muted); font-size: clamp(17px, 2vw, 21px); line-height: 1.45; }
.kurami-note { color: var(--accent-primary); font: 600 24px/1 var(--font-note); }
.kurami-note--none { transform: none; }
.kurami-note--negative { transform: rotate(-3deg); }
.kurami-note--positive { transform: rotate(2deg); }
.hero__note { align-self: center; justify-self: end; padding-right: 14px; }

.metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: 3px; box-shadow: 4px 4px 0 var(--shadow-offset); }
.metric-card { min-height: 156px; position: relative; display: grid; grid-template-rows: auto auto 1fr auto; gap: 5px; padding: 20px; border-right: 1px solid var(--border-default); }
.metric-card:last-child { border-right: 0; }
.metric-card__label { color: var(--text-muted); font-size: .75rem; }
.metric-card__value { font-size: clamp(2rem, 3.4vw, 2.375rem); font-weight: 600; line-height: 1; letter-spacing: -.045em; }
.metric-card__context { align-self: end; margin: 0; color: var(--text-muted); font-size: .6875rem; }
.metric-card__chip { width: max-content; min-height: 25px; display: inline-flex; align-items: center; justify-content: center; padding: 3px 8px; color: var(--status-success); border: 1px solid currentColor; border-radius: 5px; font-size: .625rem; font-weight: 600; line-height: 1; }
.metric-card__chip.warning { color: var(--status-warning); }
.metric-card__note { position: absolute; right: 14px; top: 13px; max-width: 130px; font-size: 18px; text-align: right; }

.briefing-overview { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: 22px; margin-top: 52px; }
.signal-strip { margin-top: 24px; }
.signal-strip > header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 10px; }
.signal-strip h2 { margin: 0; font-size: .875rem; font-weight: 600; }
.signal-strip > header > span { color: var(--text-muted); font-size: .6875rem; }
.signal-strip__items { display: grid; grid-template-columns: repeat(auto-fit,minmax(min(100%,260px),1fr)); gap: 12px; }
.signal-item { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 10px; padding: 16px; border: 1px solid var(--border-default); border-radius: 3px; background: var(--surface-panel); }
.signal-item__icon { color: var(--text-muted); font-size: 18px; line-height: 1.2; font-weight: 600; text-align: center; }
.signal-item--attention { border-top: 2px solid var(--status-warning); }
.signal-item--attention .signal-item__icon { color: var(--status-warning); }
.signal-item h3 { margin: 0 0 6px; font-size: .8125rem; font-weight: 600; line-height: 1.3; }
.signal-item p { margin: 0; font-size: .75rem; line-height: 1.5; color: var(--text-muted); overflow-wrap: anywhere; }
.signal-item a { display: inline-flex; align-items: center; min-height: 44px; color: var(--text-primary); font-size: .75rem; font-weight: 600; text-underline-offset: 3px; }
.signal-item a:hover { color: var(--accent-primary); }
.signal-item a:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 3px; }
.signal-strip:not([hidden]) + .briefing-overview { margin-top: 28px; }
.briefing-panel { min-width: 0; position: relative; padding: clamp(24px, 3vw, 34px); background: var(--surface-section); border: 1px solid var(--border-default); border-radius: 3px; box-shadow: 4px 4px 0 var(--shadow-offset); }
.briefing-panel__note { position: absolute; right: 30px; top: 72px; z-index: 1; max-width: 170px; font-size: 19px; text-align: right; pointer-events: none; }
.briefing-panel__header { display: flex; align-items: end; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid var(--border-default); }
.briefing-panel__header h2 { margin: 0; font-size: clamp(30px, 3.4vw, 42px); font-weight: 600; line-height: 1; letter-spacing: -.045em; }
.briefing-panel__header > span { color: var(--text-muted); font-size: .625rem; }
.agenda-list, .mail-list { display: grid; }
.briefing-panel__scroll[data-overflow="true"] { max-height: 372px; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-right: 10px; }
.briefing-panel__scroll[data-overflow="true"]:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 6px; }
.briefing-panel__scroll[data-overflow="true"]::-webkit-scrollbar { width: 8px; }
.briefing-panel__scroll[data-overflow="true"]::-webkit-scrollbar-track { background: color-mix(in srgb, var(--surface-panel) 62%, transparent); }
.briefing-panel__scroll[data-overflow="true"]::-webkit-scrollbar-thumb { background: var(--border-default); border: 2px solid var(--surface-section); border-radius: 8px; }
.agenda-row, .mail-row { min-height: 76px; display: grid; align-items: start; gap: 14px; padding: 17px 0; border-bottom: 1px solid var(--border-default); }
.agenda-row:last-child, .mail-row:last-child { border-bottom: 0; }
.agenda-row { grid-template-columns: 58px minmax(0, 1fr) auto; }
.agenda-row__time { padding-top: 2px; color: var(--accent-primary); font: 600 .75rem/1.4 var(--font-mono); }
.agenda-row__copy, .mail-row__copy { min-width: 0; display: grid; gap: 4px; }
.agenda-row__copy strong, .mail-row__top strong { font-size: .8125rem; font-weight: 600; line-height: 1.35; }
.agenda-row__copy span, .mail-row__copy span { color: var(--text-muted); font-size: .625rem; }
.agenda-row__copy p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; margin: 3px 0 0; color: var(--text-muted); font-size: .6875rem; line-height: 1.45; }
.agenda-row__note, .mail-row__note { width: max-content; max-width: 100%; display: inline-block; margin-top: 7px; font-size: 18px; }
.agenda-row__location { width: max-content; max-width: 100%; overflow: hidden; color: var(--text-primary); font-size: .625rem; font-weight: 500; text-decoration-thickness: 1px; text-overflow: ellipsis; text-underline-offset: 3px; white-space: nowrap; }
.agenda-row__badges, .mail-row__badges { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; }
.agenda-row__badge, .mail-row__demo { min-height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 6px; color: var(--text-muted); border: 1px solid currentColor; border-radius: 4px; font: 600 .5625rem/1 var(--font-mono); }
.agenda-row__badge.is-demo, .mail-row__demo { color: var(--status-warning); }
.mail-row { grid-template-columns: 30px minmax(0, 1fr) 154px; align-items: center; }
[data-selection-control] { min-height: 24px; position: relative; display: inline-flex; align-items: center; gap: 8px; color: var(--text-muted); cursor: pointer; font-size: .6875rem; line-height: 1.25; }
.selection-control__input { position: absolute; inset-inline-start: 0; top: 50%; z-index: 2; width: 24px; height: 24px; margin: 0; appearance: none; opacity: 0; cursor: pointer; transform: translateY(-50%); }
.selection-control__box { inline-size: 24px; block-size: 24px; position: relative; flex: 0 0 24px; display: inline-grid; place-items: center; background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: 3px; transition: color 150ms ease, background 150ms ease, border-color 150ms ease, transform 150ms ease; }
.selection-control__box::after { content: ""; color: var(--accent-primary); pointer-events: none; }
.selection-control__input:checked + .selection-control__box { background: color-mix(in srgb, var(--accent-primary) 10%, var(--surface-panel)); border-color: var(--accent-primary); }
.selection-control__input:checked + .selection-control__box::after { content: "✓"; font: 600 1.15rem/1 var(--font-note); transform: rotate(-7deg); }
.selection-control__input:indeterminate + .selection-control__box { background: color-mix(in srgb, var(--accent-primary) 10%, var(--surface-panel)); border-color: var(--accent-primary); }
.selection-control__input:indeterminate + .selection-control__box::after { content: "−"; font: 600 .875rem/1 var(--font-sans); }
[data-selection-control]:hover .selection-control__input:not(:disabled) + .selection-control__box { border-color: var(--accent-primary); transform: translateY(-1px); }
.selection-control__input:focus-visible + .selection-control__box { outline: 3px solid var(--accent-primary); outline-offset: 3px; }
[data-selection-control].is-disabled, [data-selection-control]:has(.selection-control__input:disabled) { cursor: not-allowed; opacity: .55; }
.selection-control__input:disabled { cursor: not-allowed; }
.selection-control__label { color: var(--text-muted); }
.mail-row__select { width: 24px; align-self: center; }
.mail-row__select-placeholder { width: 24px; height: 24px; align-self: center; }
.mail-row__content { min-width: 0; display: grid; gap: 5px; }
.mail-row__top { min-width: 0; }
.mail-row__top strong { display: block; min-width: 0; padding-top: 1px; }
.mail-row__badges { width: 154px; display: grid; grid-template-columns: repeat(2, 72px); align-self: center; justify-content: end; gap: 6px; }
.mail-row__badges > :only-child { grid-column: 2; }
.mail-row__class { width: 72px; min-height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 6px; color: var(--text-muted); border: 1px solid currentColor; border-radius: 4px; font: 600 .5625rem/1 var(--font-mono); }
.mail-row__demo { width: 72px; }
.mail-row[data-mail-class="action"] .mail-row__class { color: var(--accent-primary); }
.mail-row[data-mail-class="important"] .mail-row__class { color: var(--status-warning); }
.mail-row__copy strong a { text-decoration-thickness: 1px; text-underline-offset: 3px; }
.mail-row__copy p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; margin: 4px 0 0; color: var(--text-muted); font-size: .6875rem; line-height: 1.5; }
.mail-actions { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding-top: 18px; border-top: 1px solid var(--border-default); }
.mail-actions__select-all { width: max-content; }
.mail-actions > span { color: var(--text-muted); font-size: .625rem; }
.mail-actions__submit { min-height: 40px; padding-inline: 13px; font-size: .6875rem; }
.mail-actions__status { grid-column: 1 / -1; min-height: 1em; }
.mail-row.is-archived { display: none; }
.section-empty { min-height: 154px; display: grid; place-content: center start; gap: 6px; color: var(--text-muted); }
.section-empty strong { color: var(--text-primary); font-size: .875rem; }
.section-empty span { font-size: .6875rem; }

.digest-feed { position: relative; scroll-margin-top: var(--header-offset); margin-top: 52px; padding: clamp(28px, 3.4vw, 44px); background: var(--surface-section); border: 1px solid var(--border-default); border-radius: 3px; box-shadow: 4px 4px 0 var(--shadow-offset); }
.digest-feed__note { position: absolute; right: 32px; top: 24px; }
.digest-feed__header { display: flex; align-items: end; justify-content: space-between; gap: 30px; padding: 0 0 24px; }
.digest-feed__header h2 { margin: 0; font-size: clamp(36px, 4vw, 54px); font-weight: 600; line-height: 1; letter-spacing: -.05em; scroll-margin-top: var(--header-offset); }
.digest-feed__header h2:focus { outline: 2px solid var(--accent-primary); outline-offset: 6px; }
.digest-feed__header p:last-child { margin: 8px 0 0; color: var(--text-muted); font-size: .75rem; }
.digest-feed__count { min-height: 34px; display: inline-flex; align-items: center; justify-content: center; padding: 5px 10px; background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: 5px; font-size: .6875rem; font-weight: 600; line-height: 1; }
.digest-feed__items { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 2px; }
.feed-order { display: grid; gap: 8px; margin: 0 0 20px; }
.feed-order__buttons { display: flex; flex-wrap: wrap; gap: 8px; }
.feed-order__buttons .button { min-height: 44px; }
.feed-order__buttons .button[aria-pressed="true"] { border-color: var(--accent-primary); box-shadow: inset 0 -2px var(--accent-primary); }
.feed-order__status, .feed-order__explanation { margin: 0; color: var(--text-muted); font-size: .75rem; line-height: 1.5; }
.feed-order__explanation summary { width: fit-content; min-height: 44px; display: list-item; align-content: center; cursor: pointer; color: var(--text-primary); font-weight: 600; }
.feed-order__explanation summary:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 3px; }
.feed-order__explanation p { max-width: 75ch; margin: 8px 0; }
.feed-order__explanation ul { padding-inline-start: 20px; }
.news-story__interest { margin: 8px 0 0; color: var(--text-muted); font-size: .6875rem; line-height: 1.4; }

.news-story { position: relative; display: grid; grid-template-columns: 36px 176px minmax(0, 1fr) auto; gap: 18px; align-items: start; padding: 25px 16px; border-bottom: 1px solid var(--border-default); transition: background 150ms ease; }
.news-story:hover, .news-story:focus-within, .news-story.is-expanded { background: color-mix(in srgb, var(--surface-section) 52%, transparent); }
.news-story.is-read { background: color-mix(in srgb, var(--surface-section) 72%, var(--surface-panel)); }
.news-story.is-read:hover, .news-story.is-read:focus-within, .news-story.is-read.is-expanded { background: color-mix(in srgb, var(--surface-section) 86%, var(--surface-panel)); }
.news-story.is-read::after { content: "✓"; position: absolute; left: 35px; top: 8px; color: var(--accent-primary); font: 600 1.45rem/1 var(--font-note); transform: rotate(-9deg); }
.news-story__index { padding-top: 3px; color: var(--text-muted); font: 400 .625rem/1.4 var(--font-mono); }
.news-story__copy { grid-column: 3; min-width: 0; }
.news-story__meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--text-muted); font-size: .6875rem; }
.news-story__provider { min-height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 6px; color: var(--accent-primary); border: 1px solid currentColor; border-radius: 4px; font-weight: 600; line-height: 1; }
.news-story__channel { color: var(--text-primary); font-weight: 600; }
.news-story__time::before { content: "·"; margin-right: 6px; }
.news-story h3 { max-width: 900px; margin: 9px 0 6px; font-size: clamp(19px, 2.3vw, 29px); font-weight: 600; line-height: 1.12; letter-spacing: -.03em; }
.news-story__summary { max-width: 800px; margin: 0; color: var(--text-muted); font-size: .8125rem; line-height: 1.5; }
.topic-set { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
.topic-chip { min-height: 22px; display: inline-flex; align-items: center; justify-content: center; padding: 2px 7px; color: var(--text-muted); background: color-mix(in srgb, var(--surface-panel) 72%, transparent); border: 1px solid var(--border-default); border-radius: 4px; font-size: .625rem; font-weight: 500; line-height: 1; }
.news-story__note { width: max-content; max-width: min(100%, 260px); display: block; margin: 5px 7% -2px auto; font-size: 19px; text-align: right; }
.news-story__actions { grid-column: 4; display: flex; gap: 6px; }
.news-story__actions .reaction-group { display: contents; }
.story-toggle, .news-story__source { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; color: var(--text-primary); background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: 3px; cursor: pointer; font-size: .75rem; font-weight: 600; line-height: 1; text-decoration: none; transition: color 150ms, background 150ms, border-color 150ms, transform 150ms; }
.story-toggle { min-width: 84px; }
.story-toggle:hover, .news-story__source:hover { border-color: var(--accent-primary); }
.news-story__actions .icon-button[aria-pressed="true"] { color: #fff; background: var(--accent-primary); border-color: var(--accent-primary); }
.news-story__actions .icon-button[aria-busy="true"] { opacity: .55; cursor: wait; }
.story-cover { position: relative; grid-column: 2; width: 100%; aspect-ratio: 4 / 3; overflow: hidden; background: var(--surface-section); border: 1px solid var(--border-default); border-radius: 3px; }
.story-cover img { width: 100%; height: 100%; display: block; object-fit: cover; transition: transform 220ms ease, filter 220ms ease; }
.story-cover:hover img { transform: scale(1.025); filter: contrast(1.03); }
.story-cover__count { position: absolute; right: 7px; bottom: 7px; min-width: 28px; min-height: 24px; display: inline-flex; align-items: center; justify-content: center; padding: 3px 7px; color: #fff; background: #000c; border: 1px solid #ffffff55; border-radius: 3px; font-size: .625rem; font-weight: 600; line-height: 1; }
.story-disclosure__body { grid-column: 1 / -1; width: 100%; display: grid; gap: 22px; padding: 24px 28px; background: var(--surface-panel); border-left: 4px solid var(--text-primary); }
.story-disclosure__copy { display: grid; gap: 10px; }
.story-disclosure__body p { margin: 0; font-size: .8125rem; line-height: 1.62; }
.story-disclosure__body p + p { margin-top: 4px; }
.story-disclosure__body .source-link { width: max-content; margin-top: 6px; font-size: .75rem; font-weight: 600; text-underline-offset: 4px; }
.story-media { display: grid; gap: 12px; padding-top: 18px; border-top: 1px solid var(--border-default); }
.story-media__heading { display: flex; align-items: center; gap: 8px; }
.story-media__heading strong { font-size: .8125rem; font-weight: 600; }
.story-media__heading span { min-width: 22px; min-height: 22px; display: inline-flex; align-items: center; justify-content: center; color: var(--text-muted); border: 1px solid var(--border-default); border-radius: 3px; font: 400 .5625rem/1 var(--font-mono); }
.story-media__grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.story-media__item { min-width: 0; margin: 0; overflow: hidden; background: var(--surface-section); border: 1px solid var(--border-default); border-radius: 3px; }
.story-media__item--image { display: block; aspect-ratio: 16 / 10; }
.story-media__item img, .story-media__item video { width: 100%; height: 100%; display: block; object-fit: cover; }
.story-media__item--image img { transition: transform 220ms ease; }
.story-media__item--image:hover img { transform: scale(1.018); }
.story-media__item--video { display: grid; grid-template-rows: auto auto; align-content: start; }
.story-media__item--video video { height: auto; aspect-ratio: 16 / 10; background: #090909; object-fit: contain; }
.story-media__item figcaption { padding: 9px 11px; color: var(--text-muted); background: var(--surface-panel); font-size: .625rem; }

.media-lightbox { width: min(1120px, calc(100% - 40px)); max-width: none; height: min(88vh, 900px); max-height: none; margin: auto; padding: 44px 18px 18px; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 4px; box-shadow: 0 26px 80px #0008; }
.media-lightbox::backdrop { background: #000b; backdrop-filter: blur(5px); }
.media-lightbox[open] { display: grid; place-items: center; }
.media-lightbox img { max-width: 100%; max-height: calc(88vh - 70px); display: block; object-fit: contain; }
.media-lightbox__close { position: absolute; right: 10px; top: 8px; inline-size: 34px; block-size: 34px; display: inline-grid; place-items: center; padding: 0; color: var(--text-primary); background: transparent; border: 1px solid var(--border-default); border-radius: 3px; cursor: pointer; font-size: 1.25rem; line-height: 1; }

.pagination { min-height: 74px; display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 6px; }
.pagination__range { color: var(--text-muted); font-size: .6875rem; }
.pagination__controls { display: flex; align-items: center; gap: 5px; }
.pagination__button { min-width: 42px; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; padding: 0 11px; color: var(--text-primary); background: transparent; border: 1px solid transparent; border-radius: 3px; cursor: pointer; font-size: .6875rem; font-weight: 600; line-height: 1; transition: color 150ms, background 150ms, border-color 150ms, transform 150ms; }
.pagination__button:hover:not(:disabled):not([aria-current="page"]) { background: var(--surface-panel); border-color: var(--border-default); }
.pagination__button[aria-current="page"] { color: #fff; background: var(--accent-primary); border-color: var(--accent-primary); }
.pagination__button[data-page-prev], .pagination__button[data-page-next] { min-width: 42px; padding-inline: 0; font-size: 1rem; }
.pagination__button:disabled { color: var(--text-muted); cursor: default; opacity: .45; }
.pagination__mobile-jump { display: none; align-items: center; gap: 7px; color: var(--text-muted); font-size: .6875rem; }
.pagination__input { inline-size: 42px; block-size: 42px; padding: 0; color: #fff; background: var(--accent-primary); border: 1px solid var(--accent-primary); border-radius: 3px; font: 600 .6875rem/1 var(--font-sans); text-align: center; appearance: textfield; }
.pagination__input::-webkit-inner-spin-button, .pagination__input::-webkit-outer-spin-button { margin: 0; appearance: none; }
.pagination__input:hover { filter: brightness(.94); }
.pagination__input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 3px; }

.quality-strip { min-height: 92px; display: flex; align-items: center; justify-content: space-between; gap: 30px; margin: 38px 0; padding: 18px 20px; border-left: 4px solid var(--status-warning); background: var(--surface-panel); }
.quality-strip[data-state="ready"] { border-left-color: var(--status-success); }
.quality-strip__heading { display: grid; gap: 4px; }
.quality-strip__heading span { color: var(--status-warning); font-size: .5625rem; font-weight: 600; letter-spacing: .08em; }
.quality-strip[data-state="ready"] .quality-strip__heading span { color: var(--status-success); }
.quality-strip__heading strong { font-size: .8125rem; font-weight: 600; }
.quality-strip p { max-width: 680px; margin: 0; color: var(--text-muted); font-size: .6875rem; text-align: right; }

.cinema-suite { display: grid; gap: 52px; margin: 0 0 52px; }
.cinema-block { min-width: 0; position: relative; padding: clamp(26px, 3.6vw, 48px); background: var(--surface-section); border: 1px solid var(--border-default); border-radius: 3px; box-shadow: 4px 4px 0 var(--shadow-offset); }
.cinema-heading { min-height: 74px; display: flex; align-items: start; justify-content: space-between; gap: 24px; margin-bottom: 26px; }
.cinema-heading h2 { margin: 0; font-size: clamp(34px, 4.5vw, 58px); font-weight: 600; line-height: .98; letter-spacing: -.05em; }
.cinema-heading__note { max-width: 230px; padding: 8px 10px 0 0; text-align: right; transform: rotate(-2deg); }
.cinema-winner { min-height: 174px; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; gap: 10px 30px; margin-bottom: 16px; padding: clamp(24px, 3vw, 36px); color: #fff; background: linear-gradient(118deg, #0b0b0b 0 58%, #46110f 58% 76%, var(--accent-primary) 76%); border: 1px solid #0b0b0b; border-radius: 2px; }
.cinema-winner span { grid-column: 1 / -1; align-self: start; font: 400 .625rem/1.3 var(--font-mono); letter-spacing: .08em; text-transform: uppercase; }
.cinema-winner strong { max-width: 800px; font-size: clamp(28px, 4vw, 52px); line-height: 1; letter-spacing: -.045em; }
.cinema-winner b { color: #fff; font: 500 clamp(22px, 3vw, 34px)/1 var(--font-mono); }
.cinema-signals { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.cinema-signals article { min-height: 124px; display: grid; align-content: space-between; gap: 5px; padding: 16px; background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 2px; }
.cinema-signals span { color: var(--text-muted); font-size: .625rem; }
.cinema-signals strong { font-size: .875rem; line-height: 1.25; }
.cinema-signals b { color: var(--accent-primary); font: 500 .875rem/1 var(--font-mono); }
.cinema-rank header { display: flex; justify-content: space-between; gap: 20px; }
.cinema-rank header span { color: var(--text-muted); font: 400 .5625rem/1.3 var(--font-mono); text-transform: uppercase; }
.cinema-rank h3 { margin: 5px 0 0; font-size: 1rem; line-height: 1.2; }
.cinema-rank-groups { display: grid; gap: 16px; }
.cinema-rank-group { display: grid; gap: 8px; }
.cinema-rank-group > header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 0 2px; }
.cinema-rank-group > header h3 { margin: 0; font-size: 1rem; }
.cinema-rank-group > header span { color: var(--text-muted); font: 400 .5625rem/1 var(--font-mono); text-transform: uppercase; }
.cinema-ranks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.cinema-rank { min-width: 0; padding: 18px; background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 2px; }
.cinema-rank--empty { background: transparent; border-style: dashed; }
.cinema-rank__empty { min-height: 128px; display: grid; align-content: center; gap: 7px; color: var(--text-muted); }
.cinema-rank__empty strong { color: var(--text-primary); font-size: .75rem; }
.cinema-rank__empty p { max-width: 28ch; margin: 0; font-size: .6875rem; line-height: 1.45; }
.cinema-rank table { width: 100%; margin-top: 14px; border-collapse: collapse; font-size: .6875rem; }
.cinema-rank th, .cinema-rank td { padding: 10px 5px; border-top: 1px solid var(--border-default); text-align: right; vertical-align: top; }
.cinema-rank th:nth-child(2), .cinema-rank td:nth-child(2) { text-align: left; }
.cinema-rank tbody th { font-weight: 600; line-height: 1.3; }
.cinema-rank thead th { color: var(--text-muted); font: 400 .5625rem/1 var(--font-mono); border-top: 0; }
.cinema-rank__extra { display: none; }
.cinema-rank:has(.cinema-rank__more[open]) .cinema-rank__extra { display: table-row; }
.cinema-rank__more { margin-top: 8px; color: var(--accent-primary); font-size: .625rem; font-weight: 600; }
.cinema-rank__more summary { width: max-content; cursor: pointer; }
.cinema-trailer-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.cinema-trailer, .cinema-premiere { min-width: 0; overflow: hidden; color: var(--text-primary); background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 2px; text-decoration: none; transition: border-color 160ms ease, transform 160ms ease, box-shadow 160ms ease; }
.cinema-trailer:hover, .cinema-premiere:hover { border-color: var(--text-primary); transform: translateY(-2px); box-shadow: 3px 3px 0 var(--shadow-offset); }
.cinema-art { aspect-ratio: 16 / 9; position: relative; display: grid; place-items: end start; overflow: hidden; padding: 14px; color: #fff; background: linear-gradient(125deg, #131318 0 45%, #511411 45% 72%, var(--accent-primary) 72%); }
.cinema-art img, .cinema-poster img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cinema-art::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 45%, #0009); }
.cinema-art b { z-index: 1; inline-size: 40px; block-size: 40px; display: inline-grid; place-items: center; border: 1px solid #fff; border-radius: 2px; font-size: .875rem; }
.cinema-art i { z-index: 1; position: absolute; right: 12px; bottom: 12px; padding: 4px 6px; background: #000c; border-radius: 2px; font: normal 500 .5625rem/1 var(--font-mono); }
.cinema-card__copy { min-height: 112px; display: grid; align-content: start; gap: 6px; padding: 14px; }
.cinema-card__copy small { color: var(--text-muted); font: 400 .5625rem/1.3 var(--font-mono); text-transform: uppercase; }
.cinema-card__copy strong { font-size: .875rem; line-height: 1.3; }
.cinema-card__copy em { color: var(--text-muted); font-size: .625rem; font-style: normal; }
.cinema-premiere-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.cinema-premiere { display: grid; grid-template-columns: 98px 1fr; }
.cinema-poster { min-height: 156px; position: relative; display: grid; place-items: center; overflow: hidden; color: #fff; background: linear-gradient(160deg, #171713 0 55%, #6f1814 55%); }
.cinema-poster b { font-size: 2.4rem; }
.cinema-premiere .cinema-card__copy { min-height: 180px; }
.cinema-card__genres { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.cinema-card__genres i { padding: 3px 5px; color: var(--text-muted); border: 1px solid var(--border-default); border-radius: 3px; font-size: .5625rem; font-style: normal; }
.cinema-premiere__facts { display: grid; gap: 5px; margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--border-subtle); }
.cinema-premiere__facts span { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 7px; color: var(--text-muted); font-size: .5625rem; line-height: 1.35; }
.cinema-premiere__facts b { color: var(--text-primary); font-weight: 600; }
.cinema-news-list { overflow: hidden; background: var(--surface-raised); border: 1px solid var(--border-default); border-radius: 2px; }
.cinema-news { display: grid; grid-template-columns: 30px 150px minmax(0, 1fr) 44px; gap: 16px; align-items: start; padding: 20px; border-bottom: 1px solid var(--border-default); }
.cinema-news:last-child { border-bottom: 0; }
.cinema-news > span { color: var(--accent-primary); font: 400 .625rem/1.4 var(--font-mono); }
.cinema-news__image { aspect-ratio: 16 / 10; display: block; overflow: hidden; background: linear-gradient(135deg, var(--surface-panel), color-mix(in srgb, var(--text-primary) 7%, var(--surface-panel))); border: 1px solid var(--border-default); border-radius: 2px; }
.cinema-news__image img { width: 100%; height: 100%; display: block; object-fit: cover; }
.cinema-news__copy { min-width: 0; position: relative; }
.cinema-news__note { position: absolute; right: 1%; top: -9px; color: var(--accent-primary); transform: rotate(-2deg); font-size: 17px; }
.cinema-news small { color: var(--text-muted); font-size: .625rem; }
.cinema-news h3 { margin: 5px 0; font-size: clamp(16px, 2vw, 21px); line-height: 1.18; letter-spacing: -.02em; }
.cinema-news p { max-width: 900px; margin: 0; color: var(--text-muted); font-size: .75rem; line-height: 1.5; }
.cinema-news > a { inline-size: 40px; block-size: 40px; display: inline-grid; place-items: center; background: var(--surface-panel); border: 1px solid var(--border-default); border-radius: 2px; text-decoration: none; }
.cinema-news > a:hover { border-color: var(--accent-primary); }
.cinema-preview { min-height: 220px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: end; gap: 30px; margin-top: 52px; padding: clamp(28px, 4vw, 48px); background: linear-gradient(115deg, var(--surface-section) 0 72%, color-mix(in srgb, var(--accent-primary) 9%, var(--surface-section)) 72%); border: 1px solid var(--border-default); border-radius: 3px; box-shadow: 4px 4px 0 var(--shadow-offset); }
.cinema-preview h2 { margin: 0; font-size: clamp(34px, 4vw, 50px); line-height: 1; letter-spacing: -.05em; }
.cinema-preview p { max-width: 650px; margin: 12px 0 0; color: var(--text-muted); }
.cinema-preview__facts { display: flex; gap: 22px; }
.cinema-preview__facts span { display: grid; color: var(--text-muted); font-size: .625rem; }
.cinema-preview__facts b { color: var(--text-primary); font-size: 1.5rem; }
.cinema-failure { display: grid; gap: 5px; margin: 36px 0; padding: 20px; color: var(--text-muted); background: var(--surface-panel); border-left: 4px solid var(--status-warning); font-size: .75rem; }
.cinema-failure strong { color: var(--text-primary); }
.page-footer { min-height: 94px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 20px; color: var(--text-muted); border-top: 1px solid var(--border-default); font-size: .625rem; }
.page-footer span:last-child { justify-self: end; }
.page-footer__credit { display:inline-flex; align-items:center; min-height:44px; color:inherit; text-underline-offset:3px; }

@media (max-width: 900px) {
  .hero { grid-template-columns: 1fr; min-height: 280px; }
  .hero__note { position: absolute; right: 10px; bottom: 36px; }
  .metric-strip { grid-template-columns: 1fr 1fr; }
  .metric-card:nth-child(2) { border-right: 0; }
  .metric-card:nth-child(n+3) { border-top: 1px solid var(--border-default); }
  .briefing-overview { grid-template-columns: 1fr; }
  .news-story { grid-template-columns: 32px 144px minmax(0, 1fr); }
  .news-story__copy, .news-story__actions { grid-column: 3; }
  .story-disclosure__body { grid-column: 1 / -1; }
  .story-media__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .digest-feed { padding: 28px 24px; }
  .digest-feed__note { position: static; display: block; width: max-content; margin: 0 0 18px auto; }
  .cinema-ranks { grid-template-columns: 1fr 1fr; }
  .cinema-rank:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .cinema-trailer-grid { grid-template-columns: 1fr 1fr; }
  .cinema-premiere-grid { grid-template-columns: 1fr 1fr; }
  .cinema-preview { grid-template-columns: 1fr auto; }
  .cinema-preview__facts { grid-column: 1; }
}

@media (max-width: 620px) {
  :root { --header-offset:148px; }
  .hero { min-height: 260px; padding-top: 50px; }
  .hero__note { bottom: 26px; font-size: 21px; }
  .metric-card { min-height: 140px; padding: 16px; }
  .briefing-overview { margin-top: 36px; gap: 18px; }
  .briefing-panel { padding: 24px 18px; box-shadow: 3px 3px 0 var(--shadow-offset); }
  .briefing-panel__scroll[data-overflow="true"] { max-height: 460px; }
  .briefing-panel__header { align-items: start; }
  .agenda-row { grid-template-columns: 52px minmax(0, 1fr); }
  .agenda-row__badges { grid-column: 2; justify-content: flex-start; }
  .mail-row { grid-template-columns: 28px 1fr; gap: 8px; }
  .mail-row__content, .mail-row__badges { grid-column: 2; }
  .mail-row__badges { width: 150px; grid-template-columns: repeat(2, 72px); justify-content: start; }
  .mail-row__badges > :only-child { grid-column: 1; }
  .mail-actions { grid-template-columns: 1fr auto; }
  .mail-actions__select-all { grid-column: 1; }
  .mail-actions__submit { grid-column: 2; grid-row: 1 / span 2; }
  .digest-feed { margin-top: 36px; padding: 24px 16px; box-shadow: 3px 3px 0 var(--shadow-offset); }
  .digest-feed__header { align-items: start; flex-direction: column; gap: 10px; }
  .news-story { grid-template-columns: 24px minmax(0, 1fr); gap: 10px; padding: 22px 12px; }
  /* Keep the ordinal as a compact lead-in, then let the actual story use the
     full card width from the next row. On mobile this removes the permanent
     empty left rail while preserving a stable reading order. */
  .story-cover, .news-story__copy, .news-story__actions { grid-column: 1 / -1; }
  .story-cover { aspect-ratio: 16 / 9; margin-bottom: 4px; }
  .news-story__actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .news-story__note { margin-right: 2%; font-size: 18px; }
  .story-toggle { grid-column: 1 / -1; width: 100%; }
  .news-story__source, .news-story__actions .icon-button { width: 100%; min-width: 0; padding-inline: 0; }
  .story-disclosure__body { grid-column: 1 / -1; padding: 18px; }
  .story-media__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pagination { align-items: flex-start; flex-direction: column; padding: 18px 0; }
  .pagination__controls { width: 100%; justify-content: space-between; }
  .pagination__button[data-page] { display: none; }
  .pagination__mobile-jump { display: inline-flex; }
  .quality-strip { align-items: flex-start; flex-direction: column; gap: 10px; }
  .quality-strip p { text-align: left; }
  .cinema-suite { gap: 34px; }
  .cinema-block { padding: 24px 16px; box-shadow: 3px 3px 0 var(--shadow-offset); }
  .cinema-heading { min-height: 0; flex-direction: column; }
  .cinema-heading__note { align-self: end; padding: 0; }
  .cinema-winner { grid-template-columns: 1fr; background: linear-gradient(135deg, #0b0b0b 0 58%, #651713 58%); }
  .cinema-signals { grid-template-columns: 1fr 1fr; }
  .cinema-ranks, .cinema-trailer-grid, .cinema-premiere-grid { grid-template-columns: 1fr; }
  .cinema-rank:last-child:nth-child(odd) { grid-column: auto; }
  .cinema-preview { grid-template-columns: 1fr; align-items: start; margin-top: 36px; padding: 26px 20px; }
  .cinema-preview__facts { grid-column: auto; }
  .cinema-preview .button { width: 100%; }
  .cinema-news { grid-template-columns: 24px 96px minmax(0, 1fr); gap: 10px; padding: 17px 12px; }
  .cinema-news > a { grid-column: 3; }
  .cinema-news__note { position: static; display: block; width: max-content; margin: 5px 0 1px auto; }
  .page-footer { grid-template-columns: 1fr; padding: 24px 0; }
  .page-footer span:last-child { justify-self: start; }
}

@media (max-width: 420px) {
  .story-media__grid { grid-template-columns: 1fr; }
}

${CHART_STYLES}
${WEEKLY_STYLES}
${STOCKS_STYLES}
${COMPANY_AVATAR_STYLES}
${KURAMI_COMMENT_STYLES}
`;
