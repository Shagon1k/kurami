import {renderButton} from "../components/button.ts";
import {iconPath} from "../components/icon.ts";
import {renderPopover,POPOVER_CSS} from "../components/popover.ts";
import {breakpoints} from "../tokens/index.ts";

export type MobileNavigationInput={app:"hub"|"digest"|"projects"|"docs";lang:"en"|"ru";apps:string;sections:string};

export function renderMobileNavigation(input:MobileNavigationInput):string {
  const ru=input.lang==="ru",t=(a:string,b:string)=>ru?a:b;
  const slots=[
    {key:"apps",label:"Apps",title:"Apps",icon:"apps" as const,body:input.apps},
    {key:"sections",label:input.app==="hub"?t("На странице","On page"):input.app==="projects"?t("Проекты","Projects"):t("Разделы","Sections"),title:input.app==="hub"?t("На этой странице","On this page"):input.app==="projects"?t("Проекты","Projects"):t("Разделы","Sections"),icon:input.app==="hub"?"contents" as const:"sections" as const,body:input.sections+'<div data-mobile-slot="sections"></div>'},
    input.app==="hub"?{key:"controls",label:"Controls",title:t("Управление","Controls"),icon:"controls" as const,body:'<div data-mobile-slot="controls"></div>'}:
    input.app==="projects"?{key:"search",label:t("Поиск","Search"),title:t("Поиск задач","Search tasks"),icon:"search" as const,body:'<div data-mobile-slot="search"></div>'}:
    {key:"contents",label:t("На странице","On page"),title:t("На этой странице","On this page"),icon:"contents" as const,body:'<div data-mobile-slot="contents"></div>'},
    {key:"more",label:t("Настройки","Settings"),title:t("Настройки","Settings"),icon:"settings" as const,body:'<div class="mobile-navigation__settings" data-mobile-slot="more"></div>'},
  ];
  return `<div class="mobile-navigation" data-mobile-navigation="${input.app}"><nav class="mobile-navigation__bar" aria-label="${t("Навигация приложения","App navigation")}">${slots.map(slot=>renderButton({label:slot.label,iconPath:iconPath(slot.icon),visibleLabel:true,variant:"navigation",attributes:{"data-mobile-menu":slot.key,"aria-expanded":"false","aria-controls":`mobile-menu-${slot.key}`}})).join("")}</nav>${slots.map(slot=>renderPopover({mode:"manual",id:`mobile-menu-${slot.key}`,label:slot.title,body:`<div class="mobile-navigation__heading"><strong>${slot.title}</strong>${renderButton({label:t("Закрыть","Close"),variant:"icon",iconPath:iconPath("close"),attributes:{"data-mobile-close":true}})}</div>${slot.body}`})).join("")}</div>`;
}

export const MOBILE_NAVIGATION_CSS=`
${POPOVER_CSS}
.mobile-navigation { --mobile-search-top: 12px; --mobile-search-height: 100dvh; display: none; }
@media(max-width:${breakpoints.phone}px) {
  body:has([data-mobile-navigation]) { --mobile-navigation-height: 82px; padding-bottom: calc(var(--mobile-navigation-height) + env(safe-area-inset-bottom) + var(--space-6)); }
  .site-header:has([data-mobile-navigation]) { position: static; backdrop-filter: none; background: var(--surface-page); }
  .site-header:has([data-mobile-navigation]) .site-header__inner { grid-template-columns: minmax(0,1fr); grid-template-areas: "brand"; padding-block: var(--space-4); }
  .site-header:has([data-mobile-navigation]) .site-brand { gap: 9px; }
  .site-header:has([data-mobile-navigation]) .site-brand__fox { width: 42px; height: 42px; }
  .site-header:has([data-mobile-navigation]) .site-brand__name { font-size: 1.25rem; }
  .site-header:has([data-mobile-navigation]) .site-actions,.site-header:has([data-mobile-navigation]) .site-header__inner > .site-nav,.site-header:has([data-mobile-navigation]) .site-menu { display: none; }
  .mobile-navigation { display: block; }
  .mobile-navigation__bar { position: fixed; inset-inline: 0; bottom: 0; z-index: 40; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); padding-bottom: env(safe-area-inset-bottom); color: var(--text-primary); background: var(--surface-section); border-top: 1px solid color-mix(in srgb,var(--text-primary) 45%,var(--border-default)); }
  .mobile-navigation .ui-popover { --popover-width: 430px; --popover-padding: var(--space-4); left: max(var(--space-3),calc((100vw - 430px)/2)); top: auto; bottom: calc(var(--mobile-navigation-height) + env(safe-area-inset-bottom) + var(--space-2)); width: min(430px,calc(100vw - 24px)); max-height: calc(100dvh - var(--mobile-navigation-height) - env(safe-area-inset-bottom) - var(--space-8)); }
  .mobile-navigation .ui-popover { opacity: 0; transform: translateY(12px) scale(.98); transform-origin: bottom center; transition: opacity 180ms ease, transform 220ms cubic-bezier(.2,.8,.2,1), display 220ms allow-discrete, overlay 220ms allow-discrete; pointer-events: none; }
  .mobile-navigation .ui-popover:popover-open,.mobile-navigation .ui-popover.is-open { opacity: 1; transform: none; pointer-events: auto; }
  .mobile-navigation .ui-popover[id="mobile-menu-search"] { top: var(--mobile-search-top,12px); bottom: auto; max-height: calc(var(--mobile-search-height,100dvh) - 24px); transform-origin: top center; }
  @starting-style { .mobile-navigation .ui-popover:popover-open { opacity: 0; transform: translateY(12px) scale(.98); } }
  .mobile-navigation__heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
  .mobile-navigation__settings { --control-height: 44px; display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .mobile-navigation .site-switcher__nav { display: grid; position: static; border: 0; box-shadow: none; padding: 0; }
  .mobile-navigation .site-nav { display: grid; grid-template-columns: minmax(0,1fr); border: 0; padding: 0; gap: var(--space-1); }
  .mobile-navigation .site-nav__link { justify-content: flex-start; white-space: normal; text-align: start; min-height: 44px; }
  .mobile-navigation [data-mobile-slot="contents"] { display: grid; gap: var(--space-1); }
  .mobile-navigation__anchor { display: block; padding: var(--space-3); min-height: 44px; color: var(--text-primary); text-decoration: none; border-radius: var(--radius); }
  .mobile-navigation__anchor:hover { background: var(--surface-section); }
  .mobile-navigation .side-mobile__list,.mobile-navigation .toc-mobile__list { max-height: none; overflow: visible; }
  .mobile-navigation [data-mobile-slot] a { display: flex; align-items: center; min-height: 44px; }
  .mobile-navigation .mobile-navigation__link { position: relative; display: flex; align-items: center; min-height: 44px; padding: var(--space-3); border: 0; border-radius: var(--radius); color: var(--text-primary); font-size: .875rem; text-decoration: none; }
  .mobile-navigation .mobile-navigation__link::after { content: none; }
  .mobile-navigation .mobile-navigation__link[aria-current]:not([aria-current="false"]) { color: var(--accent-data); background: color-mix(in srgb,var(--accent-data) 10%,var(--surface-raised)); font-weight: 600; }
  .mobile-navigation .mobile-navigation__link[aria-current]:not([aria-current="false"])::after { content: ""; position: absolute; inset: auto auto 3px 50%; width: 18px; height: 2px; transform: translateX(-50%); background: var(--accent-data); }
  .mobile-navigation [data-mobile-menu="more"] { --navigation-icon-open-transform: rotate(45deg); }
  body:has([data-mobile-navigation="docs"]) .side-mobile,body:has([data-mobile-navigation="docs"]) .toc-mobile { display: none; }
  body:has([data-mobile-navigation="projects"]) .projects-toolbar { display: none; }
  .mobile-navigation .projects-search { width: 100%; }
  body:has(dialog[open]) .mobile-navigation__bar { visibility: hidden; }
  body:has([data-mobile-navigation]):not(.projects-mobile-detail-open) .toast { bottom: calc(var(--mobile-navigation-height) + env(safe-area-inset-bottom) + var(--space-4)); }
}
@media(prefers-reduced-motion:reduce) {
  .mobile-navigation .ui-popover { transition: none; transform: none; }
}
`;
