// One theme runtime for every Kurami page. Sites serve THEME_RUNTIME_JS as /assets/theme.js and load it
// synchronously in <head>, so the stored or system theme applies before first paint.
import {MOBILE_NAVIGATION_RUNTIME_JS} from "./mobile-navigation.ts";
import {READING_RUNTIME_JS} from './reading.ts';
import {themeVariants} from "../themes/index.ts";
type ThemeMode = "light" | "dark";
type ThemeChoices = { labels: Record<string, string>; modes: Record<string, ThemeMode[]> };

/**
 * Effective theme = this device's choice (localStorage), else the Hub default (the `kurami-theme-default`
 * cookie set by the web gateway, "<theme>.<mode>"), else Paper in the system mode. `data-theme` keeps the
 * mode (light/dark) as before; `data-kurami-theme` names a non-Paper theme. A theme without the requested
 * mode falls back to the mode it has.
 */
function kuramiThemeRuntime(choices: ThemeChoices) {
  const root = document.documentElement, modeKey = "kurami-theme", themeKey = "kurami-theme-name", media = matchMedia("(prefers-color-scheme: dark)");
  const known = (theme: string | null | undefined): theme is string => !!theme && Object.hasOwn(choices.modes, theme);
  const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key: string, value: string | null) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {} };
  const storedMode = (): ThemeMode | null => { const value = read(modeKey); return value === "dark" || value === "light" ? value : null; };
  const storedTheme = () => { const value = read(themeKey); return known(value) ? value : null; };
  const hubDefault = () => {
    const match = /(?:^|;\s*)kurami-theme-default=([a-z]+)\.(light|dark)(?:;|$)/.exec(document.cookie);
    return match && known(match[1]) ? { theme: match[1], mode: match[2] as ThemeMode } : null;
  };
  const effective = () => {
    const fallback = hubDefault(), theme = storedTheme() ?? fallback?.theme ?? "paper";
    const modes = choices.modes[theme];
    let mode = storedMode() ?? fallback?.mode ?? (media.matches ? "dark" : "light");
    if (!modes.includes(mode)) mode = modes[0];
    return { theme, mode };
  };
  const apply = () => {
    const { theme, mode } = effective(), device = storedTheme(), fallback = hubDefault();
    root.dataset.theme = mode;
    if (theme === "paper") delete root.dataset.kuramiTheme; else root.dataset.kuramiTheme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      // A menu trigger exposes expanded state; a legacy toggle (saved Digest editions) exposes the mode.
      if (!button.hasAttribute("aria-haspopup")) button.setAttribute("aria-pressed", String(mode === "dark"));
      else (button as HTMLElement).dataset.themeMode = mode;
      const icon = button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = mode === "dark" ? "☀" : "◐";
    }
    for (const option of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) {
      const value = option.dataset.themeChoice;
      option.setAttribute("aria-pressed", String(value === "default" ? !device : value === device));
    }
    for (const option of document.querySelectorAll<HTMLButtonElement>("[data-mode-choice]")) {
      const value = option.dataset.modeChoice as ThemeMode;
      option.setAttribute("aria-pressed", String(value === mode));
      option.disabled = !choices.modes[theme].includes(value);
    }
    for (const label of document.querySelectorAll("[data-theme-default-label]")) label.textContent = choices.labels[fallback?.theme ?? "paper"];
    const surface = getComputedStyle(root).getPropertyValue("--surface-page").trim();
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface);
  };
  const place = (panel: HTMLElement) => {
    const trigger = document.querySelector<HTMLElement>(`[popovertarget="${panel.id}"]`);
    if (!trigger || panel.closest("[data-mobile-slot]")) return;
    const rect = trigger.getBoundingClientRect(), width = panel.offsetWidth || 248;
    panel.style.setProperty("--popover-top", `${Math.round(rect.bottom + 8)}px`);
    panel.style.setProperty("--popover-left", `${Math.round(Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)))}px`);
  };
  apply();
  // Pages call this after changing the Hub default (cookie) so the current page follows at once.
  (window as Window & { kuramiThemeRefresh?: () => void }).kuramiThemeRefresh = apply;
  media.addEventListener("change", () => apply());
  addEventListener("storage", event => { if (event.key === modeKey || event.key === themeKey) apply(); });
  document.addEventListener("DOMContentLoaded", apply);
  document.addEventListener("toggle", event => {
    const panel = event.target;
    if (!(panel instanceof HTMLElement) || !panel.matches("[data-theme-panel]")) return;
    const open = (event as ToggleEvent).newState === "open";
    document.querySelector(`[popovertarget="${panel.id}"]`)?.setAttribute("aria-expanded", String(open));
    if (open) place(panel);
  }, true);
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const themeOption = target?.closest<HTMLElement>("[data-theme-choice]"), modeOption = target?.closest<HTMLButtonElement>("[data-mode-choice]");
    if (themeOption) {
      const value = themeOption.dataset.themeChoice!;
      if (value === "default") { write(themeKey, null); write(modeKey, null); }
      else if (known(value)) { const mode = effective().mode; write(themeKey, value); if (!storedMode()) write(modeKey, mode); }
      apply();
      return;
    }
    if (modeOption && !modeOption.disabled) {
      if (!storedTheme()) write(themeKey, effective().theme);
      write(modeKey, modeOption.dataset.modeChoice!);
      apply();
      return;
    }
    const toggle = target?.closest("[data-theme-toggle]");
    if (!toggle || toggle.hasAttribute("aria-haspopup")) return;
    // Legacy toggle: switch the mode; a dark-only theme switches to Paper light.
    const next: ThemeMode = root.dataset.theme === "dark" ? "light" : "dark";
    if (!choices.modes[effective().theme].includes(next)) write(themeKey, "paper");
    write(modeKey, next);
    apply();
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

/**
 * Neon motion, once per page and never with reduced motion: figures count up, the app name glitches when
 * arriving from another Kurami app, and `[data-ui-live]` blocks play a short scan when their content changes.
 */
function kuramiNeonMotion() {
  const root = document.documentElement, reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const active = () => root.dataset.kuramiTheme === "neon" && !reduce.matches;
  const countUp = (element: Element) => {
    const text = element.textContent ?? "", match = /^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/s.exec(text);
    if (!match || element.children.length) return;
    const [, prefix, number, suffix] = match, separator = number.includes(",") ? "," : ".", decimals = (number.split(/[.,]/)[1] ?? "").length;
    const end = Number(number.replace(",", ".")), start = performance.now(), duration = 900;
    if (!Number.isFinite(end) || end === 0) return;
    const step = (now: number) => {
      const t = Math.min((now - start) / duration, 1), value = end * (1 - Math.pow(1 - t, 3));
      element.textContent = prefix + value.toFixed(decimals).replace(".", separator) + suffix;
      if (t < 1) requestAnimationFrame(step); else element.textContent = text;
    };
    requestAnimationFrame(step);
  };
  const app = (path: string) => /^\/(?:ru|en)\/(digest|projects|docs)(?:\/|$)/.exec(path)?.[1] ?? "hub";
  document.addEventListener("DOMContentLoaded", () => {
    if (!active()) return;
    document.querySelectorAll(".stat-card__value, [data-ui-count]").forEach(countUp);
    try {
      const from = document.referrer ? new URL(document.referrer) : null;
      if (from && from.origin === location.origin && app(from.pathname) !== app(location.pathname)) document.querySelector(".site-brand__name")?.classList.add("ui-glitch");
    } catch {}
    const observer = new MutationObserver(records => {
      if (!active()) return;
      for (const record of records) {
        const live = (record.target instanceof Element ? record.target : record.target.parentElement)?.closest<HTMLElement>("[data-ui-live]");
        if (!live || live.classList.contains("ui-live-scan")) continue;
        live.classList.add("ui-live-scan");
        setTimeout(() => live.classList.remove("ui-live-scan"), 1200);
      }
    });
    // Start watching after the count-up, so the page's own first animation is not mistaken for a refresh.
    setTimeout(() => document.querySelectorAll("[data-ui-live]").forEach(live => observer.observe(live, { childList: true, subtree: true, characterData: true })), 1000);
  });
}

const THEME_CHOICES: ThemeChoices = {
  labels: { paper: "Paper", ...Object.fromEntries(themeVariants.map(variant => [variant.name, variant.label])) },
  modes: { paper: ["light", "dark"], ...Object.fromEntries(themeVariants.map(variant => [variant.name, (["dark", "light"] as const).filter(mode => variant.modes[mode])])) },
};

export const THEME_RUNTIME_JS = `(${kuramiThemeRuntime.toString()})(${JSON.stringify(THEME_CHOICES)});\n(${kuramiNeonMotion.toString()})();\n${MOBILE_NAVIGATION_RUNTIME_JS}\n${READING_RUNTIME_JS}`;
export const THEME_SCRIPT_TAG = '<script src="/assets/theme.js"></script>';
