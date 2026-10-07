// Offline reading: the saved page holds only the stories (no mail, calendar, notes or images) with a banner
// saying so, and the service worker keeps it only after an explicit opt-in, never creates it by itself,
// and serves it only for Digest when the network fails.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newsOnlyPayload, renderOfflineNews } from "../../src/briefing/ui/offline-news.ts";
import { section } from "../../src/briefing/addons/envelopes.ts";
import { syntheticDailyFilledPayload } from "../../src/ui-library/testing/digest-filled.ts";
import { withDigestLanguage } from "../../src/briefing/i18n.ts";

const payload = syntheticDailyFilledPayload();
const only = newsOnlyPayload(payload);
assert.deepEqual(Object.keys(only.addons), ["news"], "only the news add-on stays");
assert.equal(section(only, "news").items.length, section(payload, "news").items.length);
assert.ok(section(only, "news").items.every(story => (story.media ?? []).length === 0), "no images are kept");
assert.ok(section(payload, "news").items.some(story => (story.media ?? []).length > 0), "the original is untouched");
const html = withDigestLanguage("ru", () => renderOfflineNews(payload, new Date("2026-09-16T05:30:00Z")));
assert.match(html, /<p class="offline-news-banner" role="status">Без сети: сохранённые новости от 16 сент\., 08:30\./);
for (const personal of ["Synthetic inbox message", "Synthetic meeting", "audit-illustration"]) assert.ok(!html.includes(personal), `${personal} is not stored offline`);

const worker = readFileSync(resolve(import.meta.dirname, "../../src/web/sw.js"), "utf8");
assert.match(worker, /caches\.has\(OFFLINE_NEWS\)\.then\(async enabled=>\{\n\s+if\(!enabled\)return;/, "a visit refreshes the copy only when offline reading is on");
assert.match(worker, /data\.enabled\?saveOfflineNews\(data\.lang\):caches\.delete\(OFFLINE_NEWS\)/, "turning it off deletes the copy");
assert.match(worker, /\/\^\\\/\(en\|ru\)\\\/digest\(\\\/\|\$\)\//, "only Digest navigations fall back to the copy");
console.log(JSON.stringify({ ok: true, offlineNews: "news only, no images or personal blocks, banner, opt-in worker rules" }));
