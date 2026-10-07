import { renderButton } from "./button.ts";
import { renderPopover } from "./popover.ts";
import { themeVariants } from "../themes/index.ts";
import { INFO_TIP_CSS, renderInfoButton, renderInfoNote } from "./info-tip.ts";
import { iconPath } from "./icon.ts";

// One theme control for every Kurami page. The header button looks as before and opens a menu with
// the theme (Paper or a variant, as preview cards) and the mode (a sun/moon switch) for the current
// session; the lasting choice is the Hub default.
// The runtime (runtime/theme.ts) applies the choice, keeps the pressed states in sync and positions the menu; on phones the mobile navigation
// moves the whole menu into its settings sheet, where the options show inline.
export const THEME_SWITCH_CSS = `
/* The trigger is a plain icon button like its neighbours (apps, language): one palette icon for the whole
   appearance, whatever the mode. */
.theme-menu { position: relative; display: inline-flex; }
.theme-menu__panel { --popover-width: 280px; --popover-padding: var(--space-3); }
/* Two kinds of choice that must not read as four themes: the theme is a pair of cards with a preview,
   the mode is a small sun/moon switch in the heading row, like the language and period switches. */
.theme-menu__head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
.theme-menu__label { display: flex; align-items: center; flex: 1; min-width: 0; margin: 0; color: var(--text-muted); font: 500 .6875rem/1.4 var(--font-mono); letter-spacing: .07em; text-transform: uppercase; }
.theme-menu__modes { display: inline-flex; flex: none; gap: 2px; padding: 2px; border: 1px solid var(--border-default); border-radius: var(--radius); background: var(--surface-panel); }
.theme-menu .theme-menu__mode { --button-width: var(--control-height); --button-icon-size: 18px; padding: 0; }
.theme-menu__themes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
.theme-menu .theme-menu__theme { --button-justify: flex-start; width: 100%; min-height: 44px; gap: var(--space-2); font-size: .8125rem; }
.theme-menu__swatch { flex: none; width: 24px; height: 16px; border-radius: 4px; }
.theme-menu__swatch[data-swatch="paper"] { background: radial-gradient(circle at 72% 50%, #e2231a 0 3px, transparent 3.5px), #f0ede4; box-shadow: inset 0 0 0 1px #1a1a1a40; }
.theme-menu__swatch[data-swatch="neon"] { background: linear-gradient(90deg, transparent 18%, #ff2233 18% 82%, transparent 82%) center / 100% 2px no-repeat, #07060b; box-shadow: inset 0 0 0 1px #ff223380, 0 0 6px #ff223366; }
${INFO_TIP_CSS}`;

const copy = {
  ru: { button: "Тема", theme: "Тема", mode: "Режим", light: "Светлая", dark: "Тёмная", only: "Только тёмный режим:", session: "Действует, пока открыто приложение. Постоянная тема — в Hub → Управление → Оформление.", about: "Про выбор темы" },
  en: { button: "Theme", theme: "Theme", mode: "Mode", light: "Light", dark: "Dark", only: "Dark mode only:", session: "Lasts while the app is open. The lasting theme is set in Hub → Controls → Appearance.", about: "About the theme choice" },
} as const;

function themeOption(name: string, label: string): string {
  return renderButton({ label, variant: "toggle", className: "theme-menu__theme", visibleLabel: true, attributes: { "aria-pressed": "false", "data-theme-choice": name } })
    .replace(/(<button[^>]*>)/, `$1<span class="theme-menu__swatch" data-swatch="${name}" aria-hidden="true"></span>`);
}

function modeOption(mode: "light" | "dark", label: string): string {
  return renderButton({ label, variant: "toggle", size: "compact", className: "theme-menu__mode", iconPath: iconPath(mode === "light" ? "sun" : "moon"), attributes: { "aria-pressed": "false", "data-mode-choice": mode, title: label } });
}

export function renderThemeSwitch(lang: keyof typeof copy = "ru"): string {
  // One theme control per page, so the popover ID is fixed.
  const t = copy[lang], id = "kurami-theme-menu", note = `${id}-note`;
  const themes = [themeOption("paper", "Paper"), ...themeVariants.map(variant => themeOption(variant.name, variant.label))].join("");
  const onlyDark = themeVariants.filter(variant => !variant.modes.light).map(variant => variant.label).join(", ");
  const body = `<div class="theme-menu__head"><p class="theme-menu__label">${t.theme}</p>${renderInfoButton({ id: note, label: t.about })}`
    + `<div class="theme-menu__modes" role="group" aria-label="${t.mode}">${modeOption("light", t.light)}${modeOption("dark", t.dark)}</div></div>`
    + `<div class="theme-menu__themes" role="group" aria-label="${t.theme}">${themes}</div>`
    + renderInfoNote({ id: note, text: `${onlyDark ? `${t.only} ${onlyDark}. ` : ""}${t.session}` });
  const trigger = renderButton({
    label: t.button,
    variant: "icon",
    className: "theme-switch",
    iconPath: iconPath("palette"),
    attributes: { "data-theme-toggle": true, "aria-haspopup": "true", "aria-expanded": "false", popovertarget: id },
  });
  const panel = renderPopover({ id, label: t.theme, body }).replace('class="ui-popover"', 'class="ui-popover theme-menu__panel" data-theme-panel');
  return `<div class="theme-menu" data-theme-menu>${trigger}${panel}</div>`;
}
