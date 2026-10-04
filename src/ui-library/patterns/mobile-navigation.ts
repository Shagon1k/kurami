import {renderButton} from "../components/button.ts";
import {iconPath,renderIcon} from "../components/icon.ts";
import {renderPopover,POPOVER_CSS} from "../components/popover.ts";
import {breakpoints} from "../tokens/index.ts";

export type MobileNavigationInput={app:"hub"|"digest"|"projects"|"docs";lang:"en"|"ru";apps:string;sections:string};

export function renderMobileNavigation(input:MobileNavigationInput):string {
  const ru=input.lang==="ru",t=(a:string,b:string)=>ru?a:b;
  const settings=`<div class="mobile-navigation__settings" data-mobile-slot="more"><div class="mobile-navigation__setting"><span class="mobile-navigation__setting-label">${renderIcon("language")}${t("Язык","Language")}</span><div class="mobile-navigation__setting-value" data-mobile-slot="language"><span class="mobile-navigation__language-current" aria-current="true">${input.lang.toUpperCase()}</span></div></div><div class="mobile-navigation__setting"><span class="mobile-navigation__setting-label">${renderIcon("moon")}${t("Тёмная тема","Dark theme")}</span><div class="mobile-navigation__setting-value" data-mobile-slot="theme"></div></div>${input.app==="hub"?`<div class="mobile-navigation__setting" data-mobile-period-row><span class="mobile-navigation__setting-label">${renderIcon("calendar")}${t("Период","Period")}</span><div class="mobile-navigation__setting-value" data-mobile-slot="period"></div></div>`:""}</div>`;
  const slots=[
    {key:"apps",label:"Apps",title:"Apps",icon:"apps" as const,body:input.apps},
    {key:"sections",label:input.app==="hub"?t("Перейти к","Go to"):input.app==="projects"?t("Проекты","Projects"):t("Разделы","Sections"),title:input.app==="hub"?t("На этой странице","On this page"):input.app==="projects"?t("Проекты","Projects"):t("Разделы","Sections"),icon:input.app==="hub"?"contents" as const:"sections" as const,body:input.sections+'<div data-mobile-slot="sections"></div>'},
    input.app==="hub"?{key:"controls",label:t("Контролы","Controls"),title:t("Управление","Controls"),icon:"controls" as const,body:'<div data-mobile-slot="controls"></div>'}:
    input.app==="projects"?{key:"search",label:t("Поиск","Search"),title:t("Поиск задач","Search tasks"),icon:"search" as const,body:'<div data-mobile-slot="search"></div>'}:
    {key:"contents",label:t("Перейти к","Go to"),title:t("На этой странице","On this page"),icon:"contents" as const,body:'<div data-mobile-slot="contents"></div>'},
    {key:"more",label:t("Настройки","Settings"),title:t("Настройки","Settings"),icon:"settings" as const,body:settings},
  ];
  return `<div class="mobile-navigation" data-mobile-navigation="${input.app}"><nav class="mobile-navigation__bar" aria-label="${t("Навигация приложения","App navigation")}">${slots.map(slot=>renderButton({label:slot.label,iconPath:iconPath(slot.icon),visibleLabel:true,variant:"navigation",attributes:{"data-mobile-menu":slot.key,"aria-expanded":"false","aria-controls":`mobile-menu-${slot.key}`}})).join("")}</nav>${slots.map(slot=>renderPopover({mode:"manual",id:`mobile-menu-${slot.key}`,label:slot.title,body:`<div class="mobile-navigation__heading"><strong>${slot.title}</strong>${renderButton({label:t("Закрыть","Close"),variant:"icon",iconPath:iconPath("close"),attributes:{"data-mobile-close":true}})}</div>${slot.body}`})).join("")}</div>`;
}

export const MOBILE_NAVIGATION_CSS=`
${POPOVER_CSS}
.mobile-navigation { --mobile-search-top: 12px; --mobile-search-height: 100dvh; --mobile-navigation-gap: var(--space-3); display: none; }
@media(max-width:${breakpoints.phone}px) {
  body:has([data-mobile-navigation]) { --mobile-navigation-height: 78px; padding-bottom: calc(var(--mobile-navigation-height) + env(safe-area-inset-bottom) + var(--space-6)); }
  .site-header:has([data-mobile-navigation]) { position: static; backdrop-filter: none; background: var(--surface-page); }
  .site-header:has([data-mobile-navigation]) .site-header__inner { grid-template-columns: minmax(0,1fr); grid-template-areas: "brand"; padding-block: var(--space-4); }
  .site-header:has([data-mobile-navigation]) .site-brand { gap: 9px; }
  .site-header:has([data-mobile-navigation]) .site-brand__fox { width: 42px; height: 42px; }
  .site-header:has([data-mobile-navigation]) .site-brand__name { font-size: 1.25rem; }
  .site-header:has([data-mobile-navigation]) .site-actions,.site-header:has([data-mobile-navigation]) .site-header__inner > .site-nav,.site-header:has([data-mobile-navigation]) .site-menu { display: none; }
  .mobile-navigation { display: block; }
  .mobile-navigation__bar { --navigation-icon-size: 26px; --navigation-button-height: 56px; --navigation-button-padding: var(--space-1) 0; --navigation-button-gap: var(--space-1); --navigation-button-radius: var(--radius-pill); --navigation-active-background: color-mix(in srgb,var(--accent-primary) 9%,var(--surface-section)); --navigation-active-label: var(--text-accent); --navigation-active-icon: var(--text-accent); --navigation-indicator-display: none; position: fixed; inset-inline: 0; bottom: calc(var(--mobile-navigation-gap) + env(safe-area-inset-bottom)); z-index: 40; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); width: min(344px,calc(100% - var(--space-3) * 2)); margin-inline: auto; padding: var(--space-1); color: var(--text-primary); background: color-mix(in srgb,var(--accent-data) 8%,var(--surface-section)); border: 1px solid var(--border-default); border-radius: var(--radius-pill); box-shadow: var(--shadow-raised); }
  @supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .mobile-navigation__bar { background: color-mix(in srgb,color-mix(in srgb,var(--accent-data) 8%,var(--surface-section)) 82%,transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
  }
  .mobile-navigation__bar .button--navigation { --navigation-icon-stroke: 1.5; font-size: var(--navigation-label-size,.8125rem); font-weight: 500; white-space: normal; line-height: 1.3; text-align: center; }
  .mobile-navigation__bar .button--navigation > span { max-width: 100%; overflow-wrap: anywhere; }
  .mobile-navigation__bar .button__svg path { transform-box: fill-box; transform-origin: center; }
  .mobile-navigation__bar [data-mobile-menu="sections"] .button__svg path { transform: scaleY(1.18); }
  .mobile-navigation__bar [data-mobile-menu="controls"] .button__svg path,.mobile-navigation__bar [data-mobile-menu="contents"] .button__svg path,.mobile-navigation[data-mobile-navigation="hub"] [data-mobile-menu="sections"] .button__svg path { transform: scale(1.08); }
  .mobile-navigation__bar [data-mobile-menu="more"] .button__svg path { transform: scale(.94); }
  .mobile-navigation .ui-popover { --popover-width: 430px; --popover-padding: var(--space-4); left: max(var(--space-3),calc((100vw - 430px)/2)); top: auto; bottom: calc(var(--mobile-navigation-height) + env(safe-area-inset-bottom) + var(--space-2)); width: min(430px,calc(100vw - 24px)); max-height: calc(100dvh - var(--mobile-navigation-height) - env(safe-area-inset-bottom) - var(--space-8)); background: color-mix(in srgb,var(--accent-data) 3%,var(--surface-raised)); border-color: color-mix(in srgb,var(--accent-data) 25%,var(--border-default)); }
  .mobile-navigation .ui-popover { opacity: 0; transform: translateY(12px) scale(.98); transform-origin: bottom center; transition: opacity 180ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), display 220ms allow-discrete, overlay 220ms allow-discrete; pointer-events: none; }
  .mobile-navigation .ui-popover:popover-open,.mobile-navigation .ui-popover.is-open { opacity: 1; transform: none; pointer-events: auto; }
  .mobile-navigation .ui-popover[id="mobile-menu-search"] { top: var(--mobile-search-top,12px); bottom: auto; max-height: calc(var(--mobile-search-height,100dvh) - 24px); transform-origin: top center; }
  @starting-style { .mobile-navigation .ui-popover:popover-open { opacity: 0; transform: translateY(12px) scale(.98); } }
  .mobile-navigation__heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
  .mobile-navigation__settings { --control-height: 44px; display: grid; }
  .mobile-navigation__setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding-block: var(--space-3); border-top: 1px solid var(--border-subtle); }
  .mobile-navigation__setting:first-child { border-top: 0; }
  .mobile-navigation__setting[hidden] { display: none; }
  .mobile-navigation__setting-label { display: flex; align-items: center; gap: var(--space-3); font: 500 .875rem/1.4 var(--font-sans); }
  .mobile-navigation__setting-value { display: flex; align-items: center; gap: var(--space-1); flex: none; }
  .mobile-navigation__language-current { display: grid; place-items: center; width: 44px; height: 44px; color: var(--accent-data); background: color-mix(in srgb,var(--accent-data) 10%,var(--surface-raised)); border-radius: var(--radius); font: 500 .875rem/1.4 var(--font-sans); }
  .mobile-navigation__setting-value .button { font: 500 .875rem/1.4 var(--font-sans); }
  .mobile-navigation .period-control { position: static; }
  .mobile-navigation .period-control__trigger { display: none; }
  .mobile-navigation .period-control__choices { display: block; position: static; width: auto; box-shadow: none; }
  .mobile-navigation .site-switcher__nav { display: grid; position: static; border: 0; box-shadow: none; padding: 0; }
  .mobile-navigation .site-nav { display: grid; grid-template-columns: minmax(0,1fr); border: 0; padding: 0; gap: var(--space-1); }
  .mobile-navigation .site-nav__link { justify-content: flex-start; white-space: normal; text-align: start; min-height: 44px; gap: var(--space-3); font: 500 .875rem/1.4 var(--font-sans); }
  .mobile-navigation .ui-icon { --icon-size: 20px; }
  .mobile-navigation__action { --button-icon-size: 20px; min-height: 44px; justify-content: flex-start; padding: var(--space-3); font: 500 .875rem/1.4 var(--font-sans); }
  .mobile-navigation [data-mobile-slot="contents"] { display: grid; gap: var(--space-1); }
  .mobile-navigation__anchor { display: block; padding: var(--space-3); min-height: 44px; color: var(--text-primary); text-decoration: none; border-radius: var(--radius); }
  .mobile-navigation__anchor:hover { background: var(--surface-section); }
  .mobile-navigation .side-mobile__list,.mobile-navigation .toc-mobile__list { max-height: none; overflow: visible; }
  .mobile-navigation [data-mobile-slot] a { display: flex; align-items: center; min-height: 44px; }
  .mobile-navigation .mobile-navigation__link { position: relative; display: flex; align-items: center; gap: var(--space-3); min-height: 44px; padding: var(--space-3); border: 0; border-radius: var(--radius); color: var(--text-primary); font: 500 .875rem/1.4 var(--font-sans); text-decoration: none; }
  .mobile-navigation .mobile-navigation__link::after { content: none; }
  .mobile-navigation .mobile-navigation__link[aria-current]:not([aria-current="false"]) { color: var(--accent-data); background: color-mix(in srgb,var(--accent-data) 10%,var(--surface-raised)); }
  .mobile-navigation .mobile-navigation__link[aria-current]:not([aria-current="false"])::after { content: ""; position: absolute; inset: 10px auto 10px 0; width: 2px; height: auto; transform: none; background: var(--accent-data); }
  .mobile-navigation [data-mobile-menu="more"] { --navigation-icon-open-transform: rotate(45deg); }
  body:has([data-mobile-navigation="docs"]) .side-mobile,body:has([data-mobile-navigation="docs"]) .toc-mobile { display: none; }
  body:has([data-mobile-navigation="projects"]) .projects-toolbar { display: none; }
  .mobile-navigation .projects-search { width: 100%; }
  html:has([data-mobile-navigation]) { scroll-padding-bottom: calc(var(--mobile-navigation-height,78px) + env(safe-area-inset-bottom) + var(--space-4)); }
  body:has([data-mobile-navigation]) main :is(h2,h3,h4)[id] { scroll-margin-block: var(--space-6) calc(var(--mobile-navigation-height,78px) + env(safe-area-inset-bottom) + var(--space-4)); }
  body:has(dialog[open]) .mobile-navigation__bar { visibility: hidden; }
  body:has([data-mobile-navigation]):not(.projects-mobile-detail-open) .toast { bottom: calc(var(--mobile-navigation-height) + env(safe-area-inset-bottom) + var(--space-4)); }
}
@media(max-width:360px) { .mobile-navigation__bar { --navigation-label-size: .75rem; } }
@media(prefers-reduced-motion:reduce) {
  .mobile-navigation .ui-popover { transition: none; transform: none; }
}
`;
