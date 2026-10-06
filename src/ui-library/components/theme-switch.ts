import { renderButton } from "./button.ts";
import { renderPopover } from "./popover.ts";
import { themeVariants } from "../themes/index.ts";

// One theme control for every Kurami page. The header button looks as before and opens a menu with
// the theme (Paper or a variant) and the mode for the current session; the lasting choice is the Hub default.
// The runtime (runtime/theme.ts) applies the choice, keeps the pressed states in sync and positions the menu; on phones the mobile navigation
// moves the whole menu into its settings sheet, where the options show inline.
export const THEME_SWITCH_CSS = `
.theme-switch .button__icon { font-size: 19px; }
/* The trigger keeps the look of the former switch: filled while the page is dark. */
.theme-switch[data-theme-mode="dark"],.theme-switch[data-theme-mode="dark"]:hover:not(:disabled):not([aria-busy="true"]) { color: var(--text-on-accent); background: var(--accent-primary); border-color: var(--accent-primary); }
.theme-menu { position: relative; display: inline-flex; }
.theme-menu__panel { --popover-width: 248px; --popover-padding: var(--space-3); }
.theme-menu__group { display: grid; gap: var(--space-1); }
.theme-menu__group--modes { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.theme-menu__label { margin: 0 0 var(--space-1); color: var(--text-muted); font: 500 .6875rem/1.4 var(--font-mono); letter-spacing: .07em; text-transform: uppercase; }
.theme-menu__group + .theme-menu__label { margin-top: var(--space-3); }
.theme-menu .theme-menu__option { --button-justify: flex-start; width: 100%; }
.theme-menu__option::before { content: ""; width: 14px; height: 14px; flex: none; border-radius: 50%; box-shadow: inset 0 0 0 2px currentColor; opacity: .7; }
.theme-menu__option[aria-pressed="true"]::before { box-shadow: inset 0 0 0 4px currentColor; opacity: 1; }
.theme-menu__hint { margin: var(--space-3) 0 0; color: var(--text-muted); font-size: .75rem; line-height: 1.45; }
`;

const copy = {
  ru: { button: "Тема", theme: "Тема", mode: "Режим", light: "Светлая", dark: "Тёмная", only: "Только тёмный режим:", session: "Действует, пока открыто приложение. Постоянная тема — в Hub → Настройки → Оформление." },
  en: { button: "Theme", theme: "Theme", mode: "Mode", light: "Light", dark: "Dark", only: "Dark mode only:", session: "Lasts while the app is open. The lasting theme is set in Hub → Settings → Appearance." },
} as const;

function option(label: string, attributes: Record<string, string>): string {
  return renderButton({ label, variant: "toggle", className: "theme-menu__option", visibleLabel: true, attributes: { "aria-pressed": "false", ...attributes } });
}

export function renderThemeSwitch(lang: keyof typeof copy = "ru"): string {
  // One theme control per page, so the popover ID is fixed.
  const t = copy[lang], id = "kurami-theme-menu";
  const themes = [
    option("Paper", { "data-theme-choice": "paper" }),
    ...themeVariants.map(variant => option(variant.label, { "data-theme-choice": variant.name })),
  ].join("");
  const modes = option(t.light, { "data-mode-choice": "light" }) + option(t.dark, { "data-mode-choice": "dark" });
  const onlyDark = themeVariants.filter(variant => !variant.modes.light).map(variant => variant.label).join(", ");
  const body = `<p class="theme-menu__label">${t.theme}</p><div class="theme-menu__group theme-menu__group--themes" role="group" aria-label="${t.theme}">${themes}</div>`
    + `<p class="theme-menu__label">${t.mode}</p><div class="theme-menu__group theme-menu__group--modes" role="group" aria-label="${t.mode}">${modes}</div>`
    + `<p class="theme-menu__hint">${onlyDark ? `${t.only} ${onlyDark}. ` : ""}${t.session}</p>`;
  const trigger = renderButton({
    label: t.button,
    variant: "icon",
    className: "theme-switch",
    icon: "◐",
    attributes: { "data-theme-toggle": true, "aria-haspopup": "true", "aria-expanded": "false", popovertarget: id },
  }).replace('class="button__icon"', 'class="button__icon" data-theme-icon');
  const panel = renderPopover({ id, label: t.theme, body }).replace('class="ui-popover"', 'class="ui-popover theme-menu__panel" data-theme-panel');
  return `<div class="theme-menu" data-theme-menu>${trigger}${panel}</div>`;
}
