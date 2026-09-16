import { preparePreview } from "./payload-fixtures.ts";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseBriefingPayload } from "./payload-fixtures.ts";
import { captureAddonManifest, renderAddonSlot } from "../../src/briefing/addons/registry.ts";
import { applyLiveAddons, collectLiveAddons, LIVE_ADDONS } from "../../src/briefing/addons/live.ts";
import { newsBatches, section, captureBuiltinAddon } from "../../src/briefing/addons/envelopes.ts";
import { removeArchivedMail } from "../../src/briefing/addons/mail/lifecycle.ts";
import { updatePayload } from "../../src/briefing/poller.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
import { telegramStoryCoverage } from "../../src/briefing/coverage.ts";
import { briefingPaths, openBriefingDatabase, recordTelegramValidation, createTelegramCommitPlan, finalizeEdition, refreshPublishedEdition, loadEdition } from "../../src/briefing/store.ts";
import type { LiveCollectionContext, LiveResults } from "../../src/briefing/addons/live-contract.ts";
import type { ProviderResult } from "../../src/briefing/providers/common.ts";

const at = "2026-09-16T07:00:00Z";
const legacy = parseBriefingPayload({
  schemaVersion: 1,
  edition: { id: "daily:2026-09-16", type: "daily", localDate: "2026-09-16", timezone: "Europe/Vilnius",
    generatedAt: at, status: "complete", retentionUntil: "2026-09-21T07:00:00Z" },
  hero: { title: "Утренний обзор" },
  mail: { state: "ready", count: 1, items: [{ id: "mail-1", provider: "gmail", providerItemId: "message-1", class: "GENERAL", subject: "Письмо" }] },
  calendar: { state: "ready", events: [{ id: "event-1", title: "Встреча", start: "2026-09-16T10:00:00+03:00", end: "2026-09-16T11:00:00+03:00", location: "Vilnius", description: "Описание" }], allDayEvents: [] },
  weather: { state: "ready", temperatureC: 18, location: "Vilnius" },
  news: { state: "ready", pageSize: 10, items: [{ id: "story-1", fingerprint: "story-fp", headline: "Новость для проверки", summary: "Содержание новости для проверки сохранности.", details: ["Подробности новости."], topics: [{ id: "testing", label: "Testing" }, { id: "technology", label: "Technology" }], media: [{ id: "image-1", kind: "image", src: "/media/2026-09-16/story-1/image.jpg", mimeType: "image/jpeg", alt: "Картинка" }] }] },
  sourceBatches: [],
  dataQuality: { state: "ready" },
});
const native = parseBriefingPayload({ ...legacy, addons: captureAddonManifest(legacy) });
assert.equal(renderBriefingPage(native), renderBriefingPage(legacy), "migration must preserve exact HTML");
for (const id of ["mail", "calendar", "weather", "news"] as const) {
  assert.equal(native.addons?.[id]?.version, 2);
  assert.deepEqual(native.addons?.[id]?.data.section, section(native, id));
}
const envelopeOnly = structuredClone(native);
for (const key of ["mail", "calendar", "weather", "news", "sourceBatches"]) delete envelopeOnly[key];
const roundTrip = parseBriefingPayload(envelopeOnly);
assert.equal(renderBriefingPage(roundTrip), renderBriefingPage(native));
assert.deepEqual(newsBatches(roundTrip), newsBatches(native));
assert.throws(() => parseBriefingPayload({ ...native, addons: { ...native.addons, news: { ...native.addons!.news, version: 99 } } }), /addons.news.version must equal 2/);

const complete = <T>(value: T): ProviderResult<T> => ({ state: "ready", value, fetchedAt: at, attempts: 1, issues: [] });
const failed = <T>(): ProviderResult<T> => ({ state: "failed", value: null, fetchedAt: at, attempts: 1, issues: [] });
const results: LiveResults = {
  gmail: { ...complete({ query: "", unreadCount: 0, items: [], pageCount: 1 }), state: "empty" },
  calendar: { ...complete({ localDate: "2026-09-16", localDateEndExclusive: "2026-09-17", timeZone: "Europe/Vilnius", timeMin: at, timeMax: at, items: [], sources: [] }), state: "empty" },
  weather: failed(),
};
const withNotes = parseBriefingPayload({ ...native, notes: [{
  id: "note-1", target: "mail-item:mail-1", text: "нужно ответить", role: "action", tone: "signal", rotation: "none",
}] });
const refreshed = updatePayload(withNotes, at, results.gmail, results.calendar, [], results.weather);
assert.equal(section(refreshed, "mail").state, "empty");
assert.equal(refreshed.notes, undefined);
assert.equal(section(refreshed, "weather")?.state, "stale");
assert.equal(section(refreshed, "weather")?.temperatureC, 18);
assert.deepEqual(section(refreshed, "news"), section(native, "news"));
assert.deepEqual(refreshed.addons?.news, native.addons?.news);
assert.deepEqual(refreshed.addons?.mail?.data.section, section(refreshed, "mail"));
assert.equal(refreshed.live?.lastSuccessAt, undefined, "failed first poll cannot invent a successful timestamp");
const removed = structuredClone(withNotes);
assert.equal(removeArchivedMail(removed, ["message-1"]), true);
const archived = parseBriefingPayload(removed);
assert.deepEqual(archived.addons?.mail?.data.section, section(archived, "mail"));
assert.equal(archived.notes, undefined);
const calendarNote = parseBriefingPayload({ ...native, notes: [{
  id: "note-1", target: "calendar-event:event-1", text: "свободнее к обеду", role: "context", tone: "signal", rotation: "none",
}] });
assert.equal(updatePayload(calendarNote, at, results.gmail, results.calendar, [], results.weather).notes, undefined);

const onlyWeather = parseBriefingPayload({ ...native, addons: { weather: native.addons!.weather } });
assert.doesNotMatch(renderAddonSlot(onlyWeather, "overview"), /Почта|Расписание/);
const frozenMail = JSON.stringify(section(onlyWeather, "mail"));
applyLiveAddons(onlyWeather, results, { refreshedAt: at });
assert.equal(JSON.stringify(section(onlyWeather, "mail")), frozenMail);
assert.equal(onlyWeather.addons?.mail, undefined);

const context: LiveCollectionContext = {
  gmailQuery: "", calendars: [], localDate: "2026-09-16", timeZone: "Europe/Vilnius",
  weatherLocation: { name: "Vilnius", latitude: 54.68, longitude: 25.27, timeZone: "Europe/Vilnius" },
  now: () => new Date(at),
  getCaller: () => { throw new Error("must not request disabled connection"); },
  fetchImpl: async () => { throw new Error("must not request disabled weather"); },
  enabled: { mail: false, calendar: false, weather: false },
};
const off = await collectLiveAddons(context);
assert.equal(off.gmail.attempts, 0);
assert.equal(off.calendar.attempts, 0);
assert.equal(off.weather.attempts, 0);
const calls: string[] = [];
let inMcp = false;
const doubles = LIVE_ADDONS.map(addon => ({ ...addon, collect: async () => {
  calls.push(addon.id);
  if (addon.lane === "mcp") {
    assert.equal(inMcp, false);
    inMcp = true;
    await Promise.resolve();
    inMcp = false;
  }
  if (addon.id === "mail") throw new Error("mail failed");
  return results[addon.providerKey];
} }));
const mixed = await collectLiveAddons({ ...context, enabled: {} }, doubles);
assert.equal(mixed.gmail.state, "failed");
assert.equal(mixed.calendar.state, "empty");
assert.deepEqual(calls.filter(id => id !== "weather"), ["mail", "calendar"]);
const malformed = structuredClone(native);
applyLiveAddons(malformed, { ...results, gmail: complete({ items: null } as never) }, { refreshedAt: at });
assert.equal(section(malformed, "mail").state, "stale");
assert.deepEqual(section(malformed, "mail").items, section(native, "mail").items);
assert.equal(section(malformed, "calendar").state, "empty", "mail normalization failure must not block another add-on");

// Publication with News explicitly off still uses a validated empty ledger/commit plan.
const home = await mkdtemp(resolve(tmpdir(), "kurami-native-addons-"));
const paths = briefingPaths({ KURAMI_HOME: home, BRIEFING_MIGRATIONS_DIR: resolve(import.meta.dirname, "../../migrations/briefing") });
const noNews = parseBriefingPayload({
  ...native, schemaVersion: 2, news: { state: "empty", items: [] }, sourceBatches: [],
  addons: { mail: captureBuiltinAddon(native, "mail"), calendar: captureBuiltinAddon(native, "calendar"), weather: captureBuiltinAddon(native, "weather") },
  notes: [{ id: "note-hero", target: "hero", text: "сегодня без новостей", role: "context", tone: "signal", rotation: "none" }],
});
assert.equal(telegramStoryCoverage(noNews).complete, true);
assert.equal(telegramStoryCoverage({ ...noNews, addons: { news: captureBuiltinAddon(native, "news") } }).complete, false, "enabled news cannot bypass the existing empty capture gate");
await preparePreview(noNews, renderBriefingPage(noNews), paths);
const db = openBriefingDatabase(paths);
try {
  recordTelegramValidation(db, noNews.edition.id, { complete: true, configuredChannels: 0, capturedUnread: 0, fetched: 0, normalized: 0, mediaMessages: 0, skippedNonImageMessages: 0, albumGroups: 0, channels: [] }, { raw: "raw", normalized: "normalized" });
  const plan = createTelegramCommitPlan(db, noNews.edition.id);
  assert.deepEqual(plan.sources, []);
  assert.equal(finalizeEdition(db, noNews.edition.id, [], plan.planDigest).state, "complete");
  const row = loadEdition(db, { id: noNews.edition.id })!;
  const before = parseBriefingPayload(JSON.parse(row.payload_json));
  const after = updatePayload(before, at, results.gmail, results.calendar, [], results.weather);
  await refreshPublishedEdition(after, renderBriefingPage(after), row.content_digest, paths);
  const stored = parseBriefingPayload(JSON.parse(loadEdition(db, { id: noNews.edition.id })!.payload_json));
  assert.deepEqual(stored.addons?.mail?.data.section, section(stored, "mail"));
} finally { db.close(); }
process.stdout.write("native briefing add-on isolation and compatibility verified\n");
