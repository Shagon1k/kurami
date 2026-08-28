export function renderThemeToggle(): string {
  return `<button class="theme-toggle" type="button" data-theme-toggle aria-label="Включить тёмную тему" aria-pressed="false"><span data-theme-icon aria-hidden="true">◐</span><span class="sr-only" data-theme-label>Тёмная тема</span></button>`;
}
