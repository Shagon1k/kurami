// Generated from src/ui-library by `npm run ui:export`. Do not edit; change the library instead.
(function kuramiThemeRuntime() {
  const root = document.documentElement, key = "kurami-theme", media = matchMedia("(prefers-color-scheme: dark)");
  const stored = () => { try { const value = localStorage.getItem(key); return value === "dark" || value === "light" ? value : null; } catch { return null; } };
  const apply = (theme                  ) => {
    root.dataset.theme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.setAttribute("aria-pressed", String(theme === "dark"));
      const icon = button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = theme === "dark" ? "☀" : "◐";
    }
    const surface = getComputedStyle(root).getPropertyValue("--surface-page").trim();
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface);
  };
  apply(stored() ?? (media.matches ? "dark" : "light"));
  media.addEventListener("change", event => { if (!stored()) apply(event.matches ? "dark" : "light"); });
  document.addEventListener("DOMContentLoaded", () => apply(root.dataset.theme === "dark" ? "dark" : "light"));
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-theme-toggle]")) return;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(key, next); } catch {}
    apply(next);
  });
})();
