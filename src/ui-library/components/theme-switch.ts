import { renderButton } from "./button.ts";
import { renderPopover } from "./popover.ts";
import { themeVariants } from "../themes/index.ts";

// One theme control for every Kurami page. The header button looks as before and opens a menu with
// the theme (the Hub default, Paper or a variant) and the mode. The runtime (runtime/theme.ts) applies
// the choice, keeps the pressed states in sync and positions the menu; on phones the mobile navigation
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
.theme-menu__option small { margin-left: auto; color: var(--text-muted); font: 400 .6875rem/1 var(--font-mono); }
.theme-menu__hint { margin: var(--space-3) 0 0; color: var(--text-muted); font-size: .75rem; line-height: 1.45; }
`;

const copy = {
  ru: { button: "Тема", theme: "Тема", mode: "Режим", hub: "Как в Hub", light: "Светлая", dark: "Тёмная", only: "Только тёмный режим:", device: "Выбор действует на этом устройстве во всех приложениях Kurami." },
  en: { button: "Theme", theme: "Theme", mode: "Mode", hub: "Hub default", light: "Light", dark: "Dark", only: "Dark mode only:", device: "Applies on this device in every Kurami app." },
} as const;

function option(label: string, attributes: Record<string, string>, note = ""): string {
  const html = renderButton({ label, variant: "toggle", className: "theme-menu__option", visibleLabel: true, attributes: { "aria-pressed": "false", ...attributes } });
  return note ? html.replace(/<\/button>$/, `${note}</button>`) : html;
}

export function renderThemeSwitch(lang: keyof typeof copy = "ru"): string {
  // One theme control per page, so the popover ID is fixed.
  const t = copy[lang], id = "kurami-theme-menu";
  const themes = [
    option(t.hub, { "data-theme-choice": "default" }, "<small data-theme-default-label></small>"),
    option("Paper", { "data-theme-choice": "paper" }),
    ...themeVariants.map(variant => option(variant.label, { "data-theme-choice": variant.name })),
  ].join("");
  const modes = option(t.light, { "data-mode-choice": "light" }) + option(t.dark, { "data-mode-choice": "dark" });
  const onlyDark = themeVariants.filter(variant => !variant.modes.light).map(variant => variant.label).join(", ");
  const body = `<p class="theme-menu__label">${t.theme}</p><div class="theme-menu__group theme-menu__group--themes" role="group" aria-label="${t.theme}">${themes}</div>`
    + `<p class="theme-menu__label">${t.mode}</p><div class="theme-menu__group theme-menu__group--modes" role="group" aria-label="${t.mode}">${modes}</div>`
    + `<p class="theme-menu__hint">${onlyDark ? `${t.only} ${onlyDark}. ` : ""}${t.device}</p>`;
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
