// Kurami site header: fox brand, section navigation and actions. Navigation either wraps to a second
// row on phones (few links) or collapses into a menu below tablet width (many links).
import { escapeHtml } from "../foundations/html.ts";
import { breakpoints } from "../tokens/index.ts";

export type NavLink = { href: string; label: string; current?: "page" | "location"; title?: string; disabled?: boolean; hint?: string; external?: boolean };
export type SiteNavInput = { label: string; links: readonly NavLink[]; scroll?: boolean; attributes?: Record<string, true | string>; hideWhenEmpty?: boolean };
export type SiteSwitcherInput = { label: string; summary: string; links: readonly NavLink[] };
export type SiteHeaderInput = {
  label?: string;
  attributes?: Record<string, string>;
  brand: { href: string; ariaLabel: string; foxSrc: string; suffix?: string; meta?: { label: string; datetime?: string } };
  nav: SiteNavInput & { collapse?: { label: string } };
  sites?: SiteSwitcherInput;
  /** Trusted HTML from library components, e.g. renderThemeSwitch(). */
  actions: string;
  utility?: string;
  utilityFloating?:boolean;
};

const SAFE_ATTRIBUTE = /^(?:data-[a-z][a-z0-9-]*|id)$/;
function attributes(values: Record<string, true | string> | undefined): string {
  return Object.entries(values ?? {}).map(([name, value]) => {
    if (!SAFE_ATTRIBUTE.test(name)) throw new Error(`Unsafe header attribute: ${name}`);
    return value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
  }).join("");
}
function safeHref(href: string): string {
  if (!/^(?:\/(?!\/)|https:\/\/|#)/.test(href)) throw new Error("Unsafe navigation href");
  return escapeHtml(href);
}

export function renderSiteNav(input: SiteNavInput, className = "site-nav"): string {
  const links = input.links.map(link => {
    const href=safeHref(link.href);
    if(link.disabled)return `<span class="site-nav__link site-nav__link--disabled" aria-disabled="true"${link.title ? ` title="${escapeHtml(link.title)}"` : ""}>${escapeHtml(link.label)}${link.hint ? `<small class="site-nav__hint">${escapeHtml(link.hint)}</small>` : ""}</span>`;
    return `<a class="site-nav__link${link.external?" site-nav__link--external":""}" href="${href}"${link.external?' target="_blank" rel="noopener noreferrer"':""}${link.current ? ` aria-current="${link.current}"` : ""}${link.title ? ` title="${escapeHtml(link.title)}"` : ""}>${escapeHtml(link.label)}${link.external?'<span class="site-nav__external" aria-hidden="true">↗</span>':""}</a>`;
  }).join("");
  const hidden = input.hideWhenEmpty && !links ? " hidden" : "";
  return `<nav class="${className}${input.scroll?" site-nav--scroll":""}"${attributes(input.attributes)} aria-label="${escapeHtml(input.label)}"${hidden}>${links}</nav>`;
}

export function renderSiteSwitcher(input: SiteSwitcherInput): string {
  return `<details class="site-switcher"><summary aria-label="${escapeHtml(input.label)}"><span class="site-switcher__icon" aria-hidden="true"></span><span class="site-switcher__title">${escapeHtml(input.summary)}</span></summary>${renderSiteNav({label:input.label,links:input.links},"site-switcher__nav")}</details>`;
}

export function renderSiteHeader(input: SiteHeaderInput): string {
  const { brand, nav } = input;
  const meta = brand.meta ? brand.meta.datetime
    ? `<time class="site-brand__meta" datetime="${escapeHtml(brand.meta.datetime)}">${escapeHtml(brand.meta.label)}</time>`
    : `<span class="site-brand__meta">${escapeHtml(brand.meta.label)}</span>` : "";
  const suffix = brand.suffix ? ` <span class="site-brand__suffix">${escapeHtml(brand.suffix)}</span>` : "";
  const menu = nav.collapse
    ? `<details class="site-menu"><summary aria-label="${escapeHtml(nav.collapse.label)}"><span class="site-menu__icon" aria-hidden="true"></span></summary>${renderSiteNav({ label: nav.label, links: nav.links }, "site-menu__nav")}</details>`
    : "";
  return `<header class="site-header${nav.collapse ? " site-header--collapsible" : ""}${nav.scroll?" site-header--scroll-nav":""}" data-site-header${input.utilityFloating?' data-floating-utility="true"':""}${attributes(input.attributes)}${input.label ? ` aria-label="${escapeHtml(input.label)}"` : ""}>
    <div class="site-header__inner container">
      <a class="site-brand" href="${safeHref(brand.href)}" aria-label="${escapeHtml(brand.ariaLabel)}">
        <img class="site-brand__fox" src="${safeHref(brand.foxSrc)}" width="48" height="48" alt="" decoding="async">
        <span class="site-brand__copy"><span class="site-brand__name">Kurami<span class="site-brand__dot" aria-hidden="true">.</span>${suffix}</span>${meta}</span>
      </a>
      ${renderSiteNav(nav)}${menu}${input.utility?`<div class="site-header__utility">${input.utility}</div>`:""}
      <div class="site-actions">${input.sites ? renderSiteSwitcher(input.sites) : ""}${input.actions}</div>
    </div>
  </header>`;
}

export const SITE_HEADER_CSS = `
.site-header { position: sticky; top: 0; z-index: 30; width: 100%; color: var(--text-primary); background: color-mix(in srgb, var(--surface-page) 94%, transparent); border-bottom: 1px solid var(--border-default); backdrop-filter: blur(14px); transition: box-shadow 160ms ease, border-color 160ms ease, background 160ms ease; }
.site-header.is-scrolled { background: color-mix(in srgb, var(--surface-page) 97%, transparent); border-bottom-color: color-mix(in srgb, var(--border-default) 72%, var(--text-primary)); box-shadow: var(--shadow-raised); }
.site-header__inner { position: relative; min-height: 84px; display: grid; grid-template-columns: minmax(0,1fr) auto auto; grid-template-areas: "brand nav actions"; align-items: center; gap: 24px; padding-block: 12px; }
.site-header__utility { grid-area: nav; display: flex; align-items: center; justify-content: flex-end; gap: var(--space-2); }
.site-brand { grid-area: brand; justify-self: start; min-width: 0; max-width: 100%; min-height: 48px; display: inline-flex; align-items: center; gap: 12px; color: var(--text-primary); text-decoration: none; white-space: nowrap; border-radius: var(--radius); }
.site-brand__fox { width: 48px; height: 48px; flex-shrink: 0; object-fit: contain; }
[data-theme="dark"] .site-brand__fox { filter: drop-shadow(0 0 1px #ffffff8c); }
.site-brand__copy { display: grid; gap: 3px; min-width: 0; }
.site-brand__name { font-size: 1.375rem; font-weight: 600; line-height: 1.05; letter-spacing: -.055em; }
.site-brand__dot { color: var(--accent-primary); }
.site-brand__suffix { letter-spacing: -.03em; }
.site-brand:hover .site-brand__name { color: var(--accent-primary); }
.site-brand__meta { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; color: var(--text-muted); font-size: .75rem; line-height: 1.45; font-weight: 400; }
.site-brand:focus-visible, .site-nav__link:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 4px; }
.site-nav { grid-area: nav; display: flex; align-items: center; gap: 6px; }
.site-nav--scroll { min-width: 0; max-width: 100%; overflow-x: auto; scrollbar-width: thin; }
.site-nav--scroll .site-nav__link { flex: none; }
.site-nav__link { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: var(--control-height); padding: var(--space-2) var(--space-3); color: var(--text-muted); font-size: .8125rem; font-weight: 600; text-decoration: none; white-space: nowrap; border-radius: var(--radius); transition: background 140ms ease, color 140ms ease; }
.site-nav__link:not(.site-nav__link--disabled):hover { color: var(--text-primary); background: var(--surface-section); }
.site-nav__link:not(.site-nav__link--disabled):active { background: var(--surface-panel); }
.site-nav__link--disabled { cursor: default; }
.site-nav__hint { margin-left: auto; padding-left: 12px; color: var(--text-muted); font-size: .6875rem; font-weight: 400; }
.site-nav__link[aria-current] { color: var(--text-primary); background: var(--surface-section); }
.site-nav__link[aria-current]::after { content: ""; position: absolute; height: 2px; background: var(--accent-primary); bottom: 0; left: 16px; right: 16px; }
.site-nav[hidden] { display: none; }
.site-actions { grid-area: actions; justify-self: end; display: flex; align-items: center; gap: 6px; padding-left: 20px; border-left: 1px solid var(--border-default); }
.site-switcher { position: relative; }
.site-switcher summary { min-height: var(--control-height); display: inline-flex; align-items: center; gap: 12px; padding: 0 12px; border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-panel); color: var(--text-primary); cursor: pointer; list-style: none; font-size: .8125rem; font-weight: 600; white-space: nowrap; }
.site-switcher summary::-webkit-details-marker { display: none; }
.site-switcher summary:hover, .site-switcher[open] summary { border-color: var(--accent-primary); }
.site-switcher summary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 4px; }
.site-switcher__icon { width: 5px; height: 5px; margin: 0 9px 9px 0; flex: none; background: currentColor; box-shadow: 9px 0 currentColor, 0 9px currentColor, 9px 9px currentColor; }
.site-switcher__nav { position: absolute; top: calc(100% + 8px); right: 0; z-index: 2; min-width: 164px; display: grid; gap: 2px; padding: 6px; border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-raised); box-shadow: var(--shadow-card); }
.site-switcher__nav .site-nav__link { justify-content: flex-start; min-height: var(--control-height); }
.site-switcher__nav .site-nav__link[aria-current] { color: var(--text-accent); }
.site-switcher__nav .site-nav__link[aria-current]::after { left: 0; right: auto; top: 12px; bottom: 12px; width: 2px; height: auto; }
.site-switcher__nav .site-nav__link--external { color: var(--text-muted); }
.site-switcher__nav .site-nav__link:not(.site-nav__link--external) + .site-nav__link--external { margin-top: var(--space-1); border-top: 1px solid var(--border-subtle); border-radius: 0; }
.site-nav__external { margin-inline-start: auto; padding-inline-start: var(--space-3); color: var(--text-muted); }
.site-menu { display: none; }
@media (max-width: ${breakpoints.tablet}px) {
  .site-header--collapsible .site-header__inner { grid-template-areas: "brand menu actions"; gap: 8px; }
  .site-header--collapsible .site-nav { display: none; }
  .site-header--collapsible .site-menu { display: block; grid-area: menu; }
  .site-header--collapsible .site-actions { border-left: 0; padding-left: 0; }
  .site-menu summary { display: grid; place-items: center; width: var(--control-height); height: var(--control-height); border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-panel); cursor: pointer; list-style: none; }
  .site-menu summary::-webkit-details-marker { display: none; }
  .site-menu__icon, .site-menu__icon::before, .site-menu__icon::after { display: block; width: 20px; height: 2px; background: var(--text-primary); }
  .site-menu__icon { position: relative; }
  .site-menu__icon::before, .site-menu__icon::after { content: ""; position: absolute; left: 0; }
  .site-menu__icon::before { top: -6px; } .site-menu__icon::after { top: 6px; }
  .site-menu[open] .site-menu__icon { background: transparent; }
  .site-menu[open] .site-menu__icon::before { top: 0; transform: rotate(45deg); }
  .site-menu[open] .site-menu__icon::after { top: 0; transform: rotate(-45deg); }
  .site-menu__nav { position: absolute; top: calc(100% - 1px); left: 0; right: 0; display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 2px 12px; padding: 14px; border: 1px solid var(--border-default); background: var(--surface-raised); box-shadow: var(--shadow-card); }
  .site-menu__nav .site-nav__link { justify-content: flex-start; padding: 8px 12px; color: var(--text-primary); font-size: 1rem; }
  .site-menu__nav .site-nav__link[aria-current] { color: var(--text-accent); background: transparent; border-left: 2px solid var(--accent-primary); border-radius: 0; }
  .site-menu__nav .site-nav__link[aria-current]::after { content: none; }
}
@media (max-width: ${breakpoints.tablet}px) {
  .site-header--scroll-nav .site-header__inner { grid-template-columns: minmax(0,1fr) auto; grid-template-areas: "brand actions" "nav nav"; row-gap: var(--space-1); }
}
@media (max-width: ${breakpoints.phone}px) {
  .site-header__inner { min-height: 72px; grid-template-columns: minmax(0,1fr) auto; grid-template-areas: "brand actions" "nav nav"; column-gap: 12px; row-gap: 4px; padding-block: 10px 6px; }
  .site-header--collapsible .site-header__inner { grid-template-columns: minmax(0,1fr) auto auto; grid-template-areas: "brand menu actions"; padding-block: 10px; }
  .site-brand { gap: 9px; }
  .site-brand__fox { width: 42px; height: 42px; }
  .site-brand__name { font-size: 1.25rem; }
  .site-actions { border-left: 0; padding-left: 0; }
  .site-switcher summary { width: var(--control-height); justify-content: center; padding: 0; }
  .site-switcher__title { display: none; }
  .site-switcher { position: static; }
  .site-switcher__nav { top: calc(100% + 4px); right: 0; }
  .site-nav { justify-self: stretch; gap: 4px; border-top: 1px solid var(--border-default); padding-top: 4px; }
  .site-header__utility { justify-self: stretch; border-top: 1px solid var(--border-subtle); padding-top: var(--space-1); }
  .site-header[data-floating-utility] .site-header__inner { grid-template-areas: "brand actions"; padding-block: 10px; }
  .site-header[data-floating-utility] .site-header__utility { grid-area: auto; position: absolute; border: 0; padding: 0; }
  .site-nav__link { flex: 1; padding-inline: 10px; }
  .site-menu__nav { grid-template-columns: 1fr; }
}
@media (max-width: 360px) {
  .site-brand__fox { width: 34px; height: 34px; }
  .site-brand__name { font-size: 1.05rem; }
  .site-actions { gap: 4px; }
}
`;
