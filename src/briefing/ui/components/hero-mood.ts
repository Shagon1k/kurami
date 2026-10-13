// The Daily hero follows the reader's moment: the greeting changes with the time of day (the page is read
// all day, not only at 7:00), and a quiet tint in the hero's corner follows the daypart and today's weather.
// The weather kind is decided at render time from the stored condition; the daypart in the browser, in the
// edition's time zone. Without script the morning greeting and tint stay.
import type { BriefingPayload } from "../../model.ts";
import { section } from "../../addons/envelopes.ts";

export type Daypart = "morning" | "day" | "evening" | "night";
export type WeatherKind = "clear" | "cloudy" | "rain" | "snow" | "storm" | "fog";

/** Hours (local) where each daypart starts. */
export function daypart(hour: number): Daypart {
  return hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "day" : hour >= 18 && hour < 23 ? "evening" : "night";
}

export const GREETINGS: Record<Daypart, [string, string]> = {
  morning: ["Доброе утро, Alex.", "Good morning, Alex."],
  day: ["Добрый день, Alex.", "Good afternoon, Alex."],
  evening: ["Добрый вечер, Alex.", "Good evening, Alex."],
  night: ["Доброй ночи, Alex.", "Good night, Alex."],
};

export function weatherKind(payload: BriefingPayload): WeatherKind | null {
  let condition = "";
  try { condition = String((section(payload, "weather") as { condition?: unknown } | undefined)?.condition ?? ""); } catch { return null; }
  if (/⛈/.test(condition)) return "storm";
  if (/🌨|❄/.test(condition)) return "snow";
  if (/🌧|🌦/.test(condition)) return "rain";
  if (/🌫/.test(condition)) return "fog";
  if (/☁|⛅/.test(condition)) return "cloudy";
  if (/☀|🌤/.test(condition)) return "clear";
  return null;
}

/** Sets the greeting and `data-daypart` from the reader's clock in the edition's time zone. */
export const HERO_MOOD_SCRIPT = String.raw`
(()=>{
  const hero=document.querySelector('[data-hero-mood]');if(!hero)return;
  const greetings=JSON.parse(hero.dataset.greetings||'{}');
  const update=()=>{
    let hour=new Date().getHours();
    try{hour=Number(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',hourCycle:'h23',timeZone:hero.dataset.timezone}).format(new Date()));}catch{}
    const part=hour>=5&&hour<12?'morning':hour>=12&&hour<18?'day':hour>=18&&hour<23?'evening':'night';
    hero.dataset.daypart=part;
    const title=hero.querySelector('h1');if(title&&greetings[part])title.textContent=greetings[part];
  };
  update();setInterval(update,600000);
})();
`;

export const HERO_MOOD_STYLES = `
.hero[data-hero-mood] { --hero-tint: color-mix(in srgb, var(--status-warning) 22%, transparent); isolation: isolate; }
.hero[data-hero-mood][data-daypart="day"] { --hero-tint: color-mix(in srgb, var(--status-info) 18%, transparent); }
.hero[data-hero-mood][data-daypart="evening"] { --hero-tint: color-mix(in srgb, var(--status-failure) 16%, transparent); }
.hero[data-hero-mood][data-daypart="night"] { --hero-tint: color-mix(in srgb, var(--text-accent, var(--status-info)) 20%, transparent); }
.hero[data-hero-mood]::before { content: ""; position: absolute; inset: 0 0 0 40%; z-index: -1; pointer-events: none;
  background: radial-gradient(ellipse closest-side at 65% 35%, var(--hero-tint), transparent); }
.hero[data-weather="cloudy"]::before { filter: saturate(.6); }
.hero[data-weather="rain"]::after, .hero[data-weather="storm"]::after, .hero[data-weather="snow"]::after, .hero[data-weather="fog"]::after {
  content: ""; position: absolute; inset: 0 0 0 55%; z-index: -1; pointer-events: none; opacity: .5;
  mask-image: radial-gradient(ellipse closest-side at 65% 35%, black, transparent); }
.hero[data-weather="rain"]::after, .hero[data-weather="storm"]::after { background: repeating-linear-gradient(105deg, transparent 0 14px, color-mix(in srgb, var(--status-info) 35%, transparent) 14px 15px); }
.hero[data-weather="storm"]::after { opacity: .7; }
.hero[data-weather="snow"]::after { background: radial-gradient(circle, color-mix(in srgb, var(--text-muted) 55%, transparent) 1.2px, transparent 1.8px) 0 0 / 18px 18px; }
.hero[data-weather="fog"]::after { background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--surface-panel) 80%, transparent) 60%); opacity: .8; }
/* Retained editions also receive this override at request time. */
@media (min-width: 601px) { .hero[data-hero-mood]::before, .hero[data-hero-mood]::after { content: none; } }
@media (forced-colors: active) { .hero[data-hero-mood]::before, .hero[data-hero-mood]::after { display: none; } }
`;
