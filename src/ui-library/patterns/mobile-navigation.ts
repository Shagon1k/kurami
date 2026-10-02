import {renderButton} from "../components/button.ts";
import {iconPath} from "../components/icon.ts";
import {renderPopover,POPOVER_CSS} from "../components/popover.ts";
import {breakpoints} from "../tokens/index.ts";

export type MobileNavigationInput={app:"hub"|"digest"|"projects"|"docs";lang:"en"|"ru";apps:string;sections:string};

export function renderMobileNavigation(input:MobileNavigationInput):string {
  const ru=input.lang==="ru",t=(a:string,b:string)=>ru?a:b;
  const slots=[
    {key:"apps",label:"Apps",title:"Apps",icon:"apps" as const,body:input.apps},
    {key:"sections",label:input.app==="projects"?t("Проекты","Projects"):t("Разделы","Sections"),title:t("Разделы","Sections"),icon:"sections" as const,body:input.sections+'<div data-mobile-slot="sections"></div>'},
    input.app==="hub"?{key:"controls",label:"Controls",title:t("Управление","Controls"),icon:"controls" as const,body:'<div data-mobile-slot="controls"></div>'}:
    input.app==="projects"?{key:"search",label:t("Поиск","Search"),title:t("Поиск задач","Search tasks"),icon:"search" as const,body:'<div data-mobile-slot="search"></div>'}:
    {key:"contents",label:input.app==="docs"?t("В статье","On page"):t("В выпуске","Contents"),title:input.app==="docs"?t("Оглавление","On this page"):t("Содержание выпуска","Edition contents"),icon:"contents" as const,body:'<div data-mobile-slot="contents"></div>'},
    {key:"more",label:t("Ещё","More"),title:t("Настройки","Settings"),icon:"more" as const,body:'<div class="mobile-navigation__settings" data-mobile-slot="more"></div>'},
  ];
  return `<div class="mobile-navigation" data-mobile-navigation="${input.app}"><nav class="mobile-navigation__bar" aria-label="${t("Навигация приложения","App navigation")}">${slots.map(slot=>renderButton({label:slot.label,iconPath:iconPath(slot.icon),visibleLabel:true,variant:"navigation",attributes:{"data-mobile-menu":slot.key,"aria-expanded":"false","aria-controls":`mobile-menu-${slot.key}`}})).join("")}</nav>${slots.map(slot=>renderPopover({mode:"manual",id:`mobile-menu-${slot.key}`,label:slot.title,body:`<div class="mobile-navigation__heading"><strong>${slot.title}</strong>${renderButton({label:t("Закрыть","Close"),variant:"icon",iconPath:iconPath("close"),attributes:{"data-mobile-close":true}})}</div>${slot.body}`})).join("")}</div>`;
}

export const MOBILE_NAVIGATION_CSS=`
${POPOVER_CSS}
.mobile-navigation { display: none; }
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
  .mobile-navigation__heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-3); }
  .mobile-navigation__settings { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
  .mobile-navigation .site-switcher__nav { display: grid; position: static; border: 0; box-shadow: none; padding: 0; }
  .mobile-navigation .site-nav { display: grid; grid-template-columns: minmax(0,1fr); border: 0; padding: 0; gap: var(--space-1); }
  .mobile-navigation .site-nav__link { justify-content: flex-start; white-space: normal; text-align: start; min-height: 44px; }
  .mobile-navigation [data-mobile-slot="contents"] { display: grid; gap: var(--space-1); }
  .mobile-navigation__anchor { display: block; padding: var(--space-3); min-height: 44px; color: var(--text-primary); text-decoration: none; border-radius: var(--radius); }
  .mobile-navigation__anchor:hover { background: var(--surface-section); }
  .mobile-navigation .side-mobile__list,.mobile-navigation .toc-mobile__list { max-height: none; overflow: visible; }
  .mobile-navigation [data-mobile-slot] a { display: flex; align-items: center; min-height: 44px; }
  body:has([data-mobile-navigation="docs"]) .side-mobile,body:has([data-mobile-navigation="docs"]) .toc-mobile { display: none; }
  body:has([data-mobile-navigation="projects"]) .projects-toolbar { display: none; }
  .mobile-navigation .projects-search { width: 100%; }
  body:has(dialog[open]) .mobile-navigation__bar { visibility: hidden; }
  body:has([data-mobile-navigation]):not(.projects-mobile-detail-open) .toast { bottom: calc(var(--mobile-navigation-height) + env(safe-area-inset-bottom) + var(--space-4)); }
}
`;
