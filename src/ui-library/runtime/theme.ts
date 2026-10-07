// One theme runtime for every Kurami page. Sites serve THEME_RUNTIME_JS as /assets/theme.js and load it
// synchronously in <head>, so the stored or system theme applies before first paint.
import {MOBILE_NAVIGATION_RUNTIME_JS} from "./mobile-navigation.ts";
import {READING_RUNTIME_JS} from './reading.ts';
import {BRAND_MOMENTS_RUNTIME_JS} from './brand-moments.ts';
import {themeVariants} from "../themes/index.ts";
type ThemeMode = "light" | "dark";
type ThemeChoices = { modes: Record<string, ThemeMode[]> };

/**
 * The theme comes from Hub → Controls → Appearance: the web gateway sends it as the `kurami-theme-default`
 * cookie ("<theme>.<mode>"); without it Paper follows the system mode. The header menu switches theme or
 * mode only for this session (sessionStorage: until the app or tab closes, shared by every Kurami app in it).
 * `data-theme` keeps the mode (light/dark); `data-kurami-theme` names a non-Paper theme.
 */
function kuramiThemeRuntime(choices: ThemeChoices) {
  const root = document.documentElement, modeKey = "kurami-theme", themeKey = "kurami-theme-name", media = matchMedia("(prefers-color-scheme: dark)");
  const known = (theme: string | null | undefined): theme is string => !!theme && Object.hasOwn(choices.modes, theme);
  // Choices used to persist per device; they now last one session, so drop any that are left.
  try { localStorage.removeItem(modeKey); localStorage.removeItem(themeKey); } catch {}
  const read = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const write = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch {} };
  const sessionTheme = () => { const value = read(themeKey); return known(value) ? value : null; };
  const sessionMode = (): ThemeMode | null => { const value = read(modeKey); return value === "dark" || value === "light" ? value : null; };
  const hubDefault = () => {
    const match = /(?:^|;\s*)kurami-theme-default=([a-z]+)\.(light|dark)(?:;|$)/.exec(document.cookie);
    return match && known(match[1]) ? { theme: match[1], mode: match[2] as ThemeMode } : null;
  };
  const defaults = () => hubDefault() ?? { theme: "paper", mode: (media.matches ? "dark" : "light") as ThemeMode };
  /** The mode a theme opens in: Paper keeps the current mode; a variant takes the default's mode when it is the default, otherwise its first mode (Neon: dark). */
  const openingMode = (theme: string): ThemeMode => {
    const base = defaults();
    if (theme === "paper") return root.dataset.theme === "dark" ? "dark" : "light";
    return theme === base.theme ? base.mode : choices.modes[theme][0];
  };
  const effective = () => {
    const theme = sessionTheme() ?? defaults().theme, modes = choices.modes[theme];
    let mode = sessionMode() ?? (sessionTheme() ? openingMode(theme) : defaults().mode);
    if (!modes.includes(mode)) mode = modes[0];
    return { theme, mode };
  };
  const apply = () => {
    const { theme, mode } = effective();
    root.dataset.theme = mode;
    if (theme === "paper") delete root.dataset.kuramiTheme; else root.dataset.kuramiTheme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      // A menu trigger exposes expanded state; a legacy toggle (saved Digest editions) exposes the mode.
      if (!button.hasAttribute("aria-haspopup")) button.setAttribute("aria-pressed", String(mode === "dark"));
      else (button as HTMLElement).dataset.themeMode = mode;
      const icon = button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = mode === "dark" ? "☀" : "◐";
    }
    for (const option of document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")) option.setAttribute("aria-pressed", String(option.dataset.themeChoice === theme));
    for (const option of document.querySelectorAll<HTMLButtonElement>("[data-mode-choice]")) {
      const value = option.dataset.modeChoice as ThemeMode;
      option.setAttribute("aria-pressed", String(value === mode));
      option.disabled = !choices.modes[theme].includes(value);
    }
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
  // Hub calls this after changing the default (cookie): the session override ends and the page shows the new default.
  (window as Window & { kuramiThemeRefresh?: () => void }).kuramiThemeRefresh = () => {
    try { sessionStorage.removeItem(modeKey); sessionStorage.removeItem(themeKey); } catch {}
    apply();
  };
  media.addEventListener("change", () => apply());
  document.addEventListener("DOMContentLoaded", apply);
  document.addEventListener("toggle", event => {
    const panel = event.target;
    if (!(panel instanceof HTMLElement) || !panel.matches("[data-theme-panel]")) return;
    const open = (event as ToggleEvent).newState === "open";
    document.querySelector(`[popovertarget="${panel.id}"]`)?.setAttribute("aria-expanded", String(open));
    if (open) place(panel);
  }, true);
  // Info tips: the "i" button shows or hides its note; Escape hides the open ones.
  document.addEventListener("click", event => {
    const info = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-ui-info]") : null;
    const note = info && document.getElementById(info.getAttribute("aria-controls") ?? "");
    if (!info || !note) return;
    note.hidden = !note.hidden; info.setAttribute("aria-expanded", String(!note.hidden));
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    for (const info of document.querySelectorAll<HTMLButtonElement>('[data-ui-info][aria-expanded="true"]')) {
      const note = document.getElementById(info.getAttribute("aria-controls") ?? "");
      if (note) note.hidden = true;
      info.setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const themeOption = target?.closest<HTMLElement>("[data-theme-choice]"), modeOption = target?.closest<HTMLButtonElement>("[data-mode-choice]");
    if (themeOption && known(themeOption.dataset.themeChoice)) {
      const theme = themeOption.dataset.themeChoice;
      write(themeKey, theme); write(modeKey, openingMode(theme));
      apply();
      return;
    }
    if (modeOption && !modeOption.disabled) {
      write(themeKey, effective().theme); write(modeKey, modeOption.dataset.modeChoice!);
      apply();
      return;
    }
    const toggle = target?.closest("[data-theme-toggle]");
    if (!toggle || toggle.hasAttribute("aria-haspopup")) return;
    // Legacy toggle: switch the mode for this session; a theme without that mode switches to Paper.
    const next: ThemeMode = root.dataset.theme === "dark" ? "light" : "dark", theme = effective().theme;
    write(themeKey, choices.modes[theme].includes(next) ? theme : "paper"); write(modeKey, next);
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
 * Neon motion, never with reduced motion: figures count up on load, a ring spreads from the finger inside a
 * pressed button, a figure inside `[data-ui-live]` flashes when a refresh changed its value, and the app
 * name glitches when arriving from another Kurami app.
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
  document.addEventListener("pointerdown", event => {
    if (!active() || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLElement>(".button:not(:disabled):not([aria-busy=\"true\"])");
    if (!button) return;
    const rect = button.getBoundingClientRect(), layer = document.createElement("span"), ring = document.createElement("span");
    layer.className = "ui-ripple"; layer.setAttribute("aria-hidden", "true");
    ring.style.left = `${event.clientX - rect.left}px`; ring.style.top = `${event.clientY - rect.top}px`;
    // Large enough to reach the far corner of the button.
    ring.style.setProperty("--ripple-scale", String(Math.ceil(Math.hypot(rect.width, rect.height) / 6)));
    layer.append(ring); button.append(layer);
    ring.addEventListener("animationend", () => layer.remove(), { once: true });
    setTimeout(() => layer.remove(), 800);
  }, { passive: true });
  // A figure is known by its card: the metric key or the stat label. Clocks tick on their own and never flash.
  const figures = (live: Element) => {
    const found = new Map<string, Element>();
    for (const figure of live.querySelectorAll(".stat-card__value, [data-ui-figure]")) {
      if (figure.closest("[data-live-clock]") || figure.matches("[data-live-clock]")) continue;
      const card = figure.closest("[data-metric], .stat-card, .metric-card");
      const key = card?.getAttribute("data-metric") ?? card?.querySelector(".stat-card__label, .metric-card__label")?.textContent?.trim();
      if (key && !found.has(key)) found.set(key, figure);
    }
    return found;
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (!active()) return;
    document.querySelectorAll(".stat-card__value, [data-ui-count]").forEach(countUp);
    try {
      const from = document.referrer ? new URL(document.referrer) : null;
      if (from && from.origin === location.origin && app(from.pathname) !== app(location.pathname)) document.querySelector(".site-brand__name")?.classList.add("ui-glitch");
    } catch {}
    const regions = [...document.querySelectorAll("[data-ui-live]")], known = new Map<Element, Map<string, string>>();
    const remember = (live: Element) => known.set(live, new Map([...figures(live)].map(([key, figure]) => [key, figure.textContent ?? ""])));
    let frame = 0;
    const compare = () => {
      frame = 0;
      for (const live of regions) {
        const before = known.get(live), now = figures(live);
        if (before && active()) for (const [key, figure] of now) {
          const previous = before.get(key);
          if (previous === undefined || previous === figure.textContent) continue;
          figure.classList.remove("ui-figure-blip"); void (figure as HTMLElement).offsetWidth; figure.classList.add("ui-figure-blip");
          setTimeout(() => figure.classList.remove("ui-figure-blip"), 1000);
        }
        remember(live);
      }
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(compare); });
    // Start after the count-up, so the page's own first animation is not mistaken for a refresh.
    setTimeout(() => { for (const live of regions) { remember(live); observer.observe(live, { childList: true, subtree: true, characterData: true }); } }, 1000);
  });
}

const THEME_CHOICES: ThemeChoices = {
  modes: { paper: ["light", "dark"], ...Object.fromEntries(themeVariants.map(variant => [variant.name, (["dark", "light"] as const).filter(mode => variant.modes[mode])])) },
};

export const THEME_RUNTIME_JS = `(${kuramiThemeRuntime.toString()})(${JSON.stringify(THEME_CHOICES)});\n(${kuramiNeonMotion.toString()})();\n${MOBILE_NAVIGATION_RUNTIME_JS}\n${READING_RUNTIME_JS}\n${BRAND_MOMENTS_RUNTIME_JS}`;
export const THEME_SCRIPT_TAG = '<script src="/assets/theme.js"></script>';
