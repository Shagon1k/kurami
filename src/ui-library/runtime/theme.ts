// One theme runtime for every Kurami page. Sites serve THEME_RUNTIME_JS as /assets/theme.js and load it
// synchronously in <head>, so the stored or system theme applies before first paint.
import {MOBILE_NAVIGATION_RUNTIME_JS} from "./mobile-navigation.ts";
import {READING_RUNTIME_JS} from './reading.ts';
function kuramiThemeRuntime() {
  const root = document.documentElement, key = "kurami-theme", media = matchMedia("(prefers-color-scheme: dark)");
  const stored = () => { try { const value = localStorage.getItem(key); return value === "dark" || value === "light" ? value : null; } catch { return null; } };
  const apply = (theme: "dark" | "light") => {
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
  const menus = () => document.querySelectorAll<HTMLDetailsElement>(".site-switcher[open],.site-menu[open],.side-mobile[open]");
  document.addEventListener("pointerdown", event => {
    if (!(event.target instanceof Node)) return;
    for (const menu of menus()) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    for (const menu of menus()) { menu.open = false; menu.querySelector("summary")?.focus({preventScroll:true}); }
  });
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    for (const menu of menus()) if (!menu.contains(event.target) || event.target.closest("a[href]")) menu.open = false;
  });
}

export const THEME_RUNTIME_JS = `(${kuramiThemeRuntime.toString()})();\n${MOBILE_NAVIGATION_RUNTIME_JS}\n${READING_RUNTIME_JS}`;
export const THEME_SCRIPT_TAG = '<script src="/assets/theme.js"></script>';
