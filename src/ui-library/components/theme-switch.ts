import { renderButton } from "./button.ts";

// The runtime (runtime/theme.ts) keeps aria-pressed and the icon in sync; the name stays constant.
export const THEME_SWITCH_CSS = `.theme-switch .button__icon { font-size: 19px; }`;

const labels = { ru: "Тёмная тема", en: "Dark theme" } as const;

export function renderThemeSwitch(lang: keyof typeof labels = "ru"): string {
  return renderButton({
    label: labels[lang],
    variant: "icon",
    className: "theme-switch",
    icon: "◐",
    attributes: { "data-theme-toggle": true, "aria-pressed": "false" },
  }).replace('class="button__icon"', 'class="button__icon" data-theme-icon');
}
