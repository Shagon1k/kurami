import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { composeBriefingPayload } from "../../src/briefing/composer.ts";
import { rankBriefingStories } from "../../src/briefing/ranking.ts";
import {
  loadBriefingAttempt,
  recordBriefingRunStage,
  startBriefingAttempt,
} from "../../src/briefing/run-attempt.ts";
import {
  briefingPaths,
  initializeBriefingStore,
  openBriefingDatabase,
} from "../../src/briefing/store.ts";
import type { NewsItem } from "../../src/briefing/model.ts";

const root = resolve(import.meta.dirname, "../..");
const home = await mkdtemp(resolve(tmpdir(), "kurami-deterministic-workflow-"));
const environment = {
  KURAMI_HOME: home,
  BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
} as NodeJS.ProcessEnv;
const paths = briefingPaths(environment);
await initializeBriefingStore(paths);
const database = openBriefingDatabase(paths);
try {
  const beforeWindow = await startBriefingAttempt(database, paths, {
    editionId: "daily:2026-09-01",
    mode: "scheduled",
    timeZone: "Europe/Vilnius",
    at: new Date("2026-09-01T05:00:00Z"),
  });
  assert.equal(beforeWindow.shouldRun, false);
  assert.equal(loadBriefingAttempt(database, beforeWindow.attempt.attemptId), null);

  const scheduled = await startBriefingAttempt(database, paths, {
    editionId: "daily:2026-09-01",
    mode: "scheduled",
    timeZone: "Europe/Vilnius",
    at: new Date("2026-09-01T06:00:00Z"),
  });
  assert.equal(scheduled.shouldRun, true);
  assert.equal(scheduled.attempt.state, "created");
  const duplicate = await startBriefingAttempt(database, paths, {
    editionId: "daily:2026-09-01",
    mode: "scheduled",
    timeZone: "Europe/Vilnius",
    at: new Date("2026-09-01T07:00:00Z"),
  });
  assert.equal(duplicate.shouldRun, false);
  assert.equal(duplicate.attempt.attemptId, scheduled.attempt.attemptId);
  assert.throws(
    () => recordBriefingRunStage(database, { attemptId: scheduled.attempt.attemptId, stage: "telegram-captured" }),
    /Invalid briefing run transition/,
  );
  recordBriefingRunStage(database, { attemptId: scheduled.attempt.attemptId, stage: "live-collected" });
  recordBriefingRunStage(database, { attemptId: scheduled.attempt.attemptId, stage: "telegram-captured" });
  recordBriefingRunStage(database, { attemptId: scheduled.attempt.attemptId, stage: "capture-validated" });
} finally {
  database.close();
}

const configPath = resolve(home, "capture.yaml");
const rawPath = resolve(home, "raw.json");
const normalizedPath = resolve(home, "normalized.json");
const livePath = resolve(home, "live.json");
const draftPath = resolve(home, "draft.json");
const outputPath = resolve(home, "payload.json");
await writeFile(configPath, `sources:\n  news:\n    enabled: true\n    channels:\n      - key: test\n        id: -1001\n        label: Test channel\n`);
const telegramItem = {
  id: "telegram:test:10",
  kind: "news",
  source: "Telegram",
  sourceProfile: "telegram-user",
  sourceDetail: "Test channel",
  sourceItemId: "-1001:10",
  title: "Provider title copied from the first source line",
  content: "A complete source message about a concrete event.",
  publishedAt: "2026-09-01T05:55:00Z",
  externalUrl: "https://t.me/test/10",
  metadata: {
    telegramChatId: -1001,
    telegramMessageId: 10,
    hasMedia: false,
  },
};
const raw = {
  sourceKey: "news",
  profile: "telegram-user",
  status: "ready",
  fetchedAt: "2026-09-01T06:00:00Z",
  capture: {
    channels: [{
      sourceKey: "test",
      channelId: -1001,
      label: "Test channel",
      status: "ready",
      capturedUnreadCount: 1,
      upperMessageId: 10,
      fetchedMessageIds: [10],
    }],
  },
  items: [telegramItem],
};
await writeFile(rawPath, JSON.stringify(raw));
await writeFile(normalizedPath, JSON.stringify({ ...raw, items: [telegramItem] }));
await writeFile(livePath, JSON.stringify({
  state: "ready",
  refreshedAt: "2026-09-01T06:00:00Z",
  localDate: "2026-09-01",
  gmail: {
    state: "empty",
    value: { query: "category:primary", items: [], unreadCount: 0, pageCount: 1 },
    fetchedAt: "2026-09-01T06:00:00Z",
    attempts: 1,
    issues: [],
  },
  calendar: {
    state: "empty",
    value: {
      localDate: "2026-09-01",
      localDateEndExclusive: "2026-09-02",
      timeZone: "Europe/Vilnius",
      timeMin: "2026-08-31T21:00:00Z",
      timeMax: "2026-09-01T21:00:00Z",
      items: [],
      sources: [],
    },
    fetchedAt: "2026-09-01T06:00:00Z",
    attempts: 1,
    issues: [],
  },
  weather: {
    state: "ready",
    value: {
      provider: "open-meteo",
      location: "Vilnius",
      latitude: 54.6872,
      longitude: 25.2797,
      timeZone: "Europe/Vilnius",
      observedAt: "2026-09-01T09:00:00+03:00",
      condition: { code: 1, label: "Преимущественно ясно", emoji: "🌤️" },
      temperatureCelsius: 18,
      apparentTemperatureCelsius: 18,
      humidityPercent: 60,
      precipitationMillimeters: 0,
      precipitationProbabilityPercent: 10,
      windSpeedKph: 8,
      minimumCelsius: 12,
      maximumCelsius: 21,
      sunrise: "2026-09-01T06:15:00+03:00",
      sunset: "2026-09-01T20:10:00+03:00",
    },
    fetchedAt: "2026-09-01T06:00:00Z",
    attempts: 1,
    issues: [],
  },
  issues: [],
}));
await writeFile(draftPath, JSON.stringify({
  editionId: "daily:2026-09-01",
  generatedAt: "2026-09-01T06:01:00Z",
  stories: [{
    sourceItemIds: ["telegram:test:10"],
    headline: "Новый факт без копирования provider title",
    summary: "Самостоятельное краткое описание события.",
    details: ["Полный полезный контекст сообщения без искусственного обрезания."],
    topics: [
      { id: "technology", label: "Technology" },
      { id: "policy", label: "Policy" },
    ],
    signals: {
      importance: "high",
      urgency: "today",
      publicInterest: "medium",
      confidence: "high",
      publishedAt: "2026-09-01T05:55:00Z",
    },
  }],
}));
const composed = await composeBriefingPayload({
  draftPath,
  livePath,
  configPath,
  rawPath,
  normalizedPath,
  outputPath,
});
assert.equal(composed.report.complete, true);
const composedSource = (composed.payload.news.items[0]!.sources as Array<{ itemIds: string[] }>)[0]!;
assert.equal(composedSource.itemIds[0], "10");
assert.equal(composed.payload.sourceBatches?.[0]!.maxItemId, "10");
assert.equal(composed.payload.news.items[0]!.rankingPolicy, "deterministic-v1");
assert.equal(composed.payload.weather?.temperatureC, 18);
assert.equal(await readFile(outputPath, "utf8"), `${JSON.stringify(composed.payload, null, 2)}\n`);

const copiedDraft = JSON.parse(await readFile(draftPath, "utf8"));
copiedDraft.stories[0].headline = telegramItem.title;
await writeFile(draftPath, JSON.stringify(copiedDraft));
await assert.rejects(
  composeBriefingPayload({ draftPath, livePath, configPath, rawPath, normalizedPath }),
  /must not copy the provider title verbatim/,
);

const unsignalled = [
  { id: "one", fingerprint: "one", headline: "One", summary: "One", details: ["One"], topics: [{ id: "same", label: "Same" }] },
  { id: "two", fingerprint: "two", headline: "Two", summary: "Two", details: ["Two"], topics: [{ id: "different", label: "Different" }] },
] as NewsItem[];
assert.deepEqual(rankBriefingStories(unsignalled).map((story) => story.id), ["one", "two"]);

process.stdout.write("deterministic briefing workflow verified\n");
