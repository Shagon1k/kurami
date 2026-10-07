// Daily hero mood: dayparts by local hour, weather kinds from the stored condition, the markup carries the
// greetings for the browser, and the script switches greeting and daypart in the edition's time zone.
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { daypart, GREETINGS, HERO_MOOD_SCRIPT, weatherKind } from "../../src/briefing/ui/components/hero-mood.ts";
import type { BriefingPayload } from "../../src/briefing/model.ts";

assert.deepEqual([4, 5, 11, 12, 17, 18, 22, 23].map(daypart), ["night", "morning", "morning", "day", "day", "evening", "evening", "night"]);
const payload = (condition: string) => ({ addons: { weather: { version: 2, state: "ready", capturedAt: "2026-10-07T05:00:00Z", data: { section: { state: "ready", condition } } } } }) as unknown as BriefingPayload;
assert.deepEqual(["⛈️ Гроза", "🌨️ Снег", "🌧️ Дождь", "🌦️ Морось", "🌫️ Туман", "☁️ Пасмурно", "⛅ Переменная облачность", "☀️ Ясно", ""].map(value => weatherKind(payload(value))),
  ["storm", "snow", "rain", "rain", "fog", "cloudy", "cloudy", "clear", null]);

const title = { textContent: GREETINGS.morning[0] };
const hero = { dataset: { timezone: "Europe/Vilnius", greetings: JSON.stringify(Object.fromEntries(Object.entries(GREETINGS).map(([part, [ru]]) => [part, ru]))) } as Record<string, string>, querySelector: () => title };
class FixedDate extends Date { constructor() { super("2026-10-07T16:30:00Z"); } }
runInNewContext(HERO_MOOD_SCRIPT, { document: { querySelector: () => hero }, Date: FixedDate, Intl, JSON, Number, setInterval: () => 0 });
assert.equal(hero.dataset.daypart, "evening", "19:30 in Vilnius is evening");
assert.equal(title.textContent, "Добрый вечер, Alex.");
console.log(JSON.stringify({ ok: true, heroMood: "dayparts, weather kinds, evening greeting in the edition's zone" }));
