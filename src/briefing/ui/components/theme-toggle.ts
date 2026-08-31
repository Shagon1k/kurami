import { renderButton } from "./button.ts";

export function renderThemeToggle(): string {
  return renderButton({
    label: "Тёмная тема",
    variant: "icon",
    className: "theme-toggle",
    icon: "◐",
    ariaLabel: "Включить тёмную тему",
    attributes: { "data-theme-toggle": true, "aria-pressed": "false" },
    labelAttributes: { "data-theme-label": true },
  }).replace('class="button__icon"', 'class="button__icon" data-theme-icon');
}
