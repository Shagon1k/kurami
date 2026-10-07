import { preparePreview } from "./payload-fixtures.ts";
import { section } from "../../src/briefing/addons/envelopes.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createBriefingServer,
  injectRuntime,
  removeArchivedMailFromRetainedEditions,
} from "../../src/briefing/server.ts";
import { parseBriefingPayload } from "./payload-fixtures.ts";
import { storyNoteDistributionIssues } from "../../src/briefing/editorial-validation.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
import {
  collectAddonMetrics,
  renderAddonSlot,
} from "../../src/briefing/addons/registry.ts";
import type { BriefingAddon } from "../../src/briefing/addons/types.ts";
import { importEditionMedia } from "../../src/briefing/media.ts";
import {
  assertTelegramStoryCoverage,
  telegramStoryCoverage,
} from "../../src/briefing/coverage.ts";
import {
  validateTelegramBatch,
  type TelegramBatchReport,
} from "../../src/briefing/telegram-batch.ts";
import {
  createTelegramCommitPlan,
  recordTelegramValidation,
} from "../../src/briefing/telegram-commit-store.ts";
import { briefingPaths } from "../../src/briefing/paths.ts";
import { readEditionHtml, resolvedHtmlPath, validateRenderedHtml } from "../../src/briefing/html-artifacts.ts";
import {
  cleanupExpired,
  finalizeEdition,
  initializeBriefingStore,
  listAddonSnapshots,
  loadAddonSnapshot,
  loadEdition,
  openBriefingDatabase,
  refreshPreparedPreviewMedia,
  refreshPublishedEdition,
  revisePublishedEdition,
  rerenderPublishedPreview,
  retainedDailyEditions,
  topicProfile,
  upsertAddonSnapshot,
} from "../../src/briefing/store.ts";

const root = resolve(import.meta.dirname, "../..");
const serviceUnit = await readFile(
  resolve(root, "deploy/systemd/kurami-briefing.service"),
  "utf8",
);
assert.match(serviceUnit, /MemoryDenyWriteExecute=true/);
assert.match(serviceUnit, /node --jitless .*\/dist\/briefing\/server\.js/);
assert.doesNotMatch(serviceUnit, /\/src\/briefing\/server\.ts/);
const guardServiceUnit = await readFile(
  resolve(root, "deploy/systemd/kurami-daily-briefing-guard.service"),
  "utf8",
);
const guardTimerUnit = await readFile(
  resolve(root, "deploy/systemd/kurami-daily-briefing-guard.timer"),
  "utf8",
);
assert.match(guardServiceUnit, /dist\/briefing\/cli\.js guard-run/u);
assert.match(guardServiceUnit, /MemoryDenyWriteExecute=true/u);
assert.match(guardTimerUnit, /09:50:00 Europe\/Vilnius/u);
assert.match(guardTimerUnit, /10:50:00 Europe\/Vilnius/u);
const home = await mkdtemp(resolve(tmpdir(), "kurami-briefing-runtime-"));
const paths = briefingPaths({
  KURAMI_HOME: home,
  BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
} as NodeJS.ProcessEnv);
assert.equal(resolvedHtmlPath(paths, "pages/preview/daily.html"), resolve(paths.previewDirectory, "daily.html"));
assert.throws(() => resolvedHtmlPath(paths, "../outside.html"), /Unsafe stored HTML path/);
assert.throws(() => resolvedHtmlPath(paths, "/tmp/outside.html"), /Unsafe stored HTML path/);
assert.throws(() => resolvedHtmlPath(paths, "other/outside.html"), /Stored HTML path escapes briefing pages/);

const payload = {
  schemaVersion: 2,
  edition: {
    id: "daily:2026-08-28",
    type: "daily",
    localDate: "2026-08-28",
    timezone: "Europe/Vilnius",
    generatedAt: "2026-08-28T09:00:00+03:00",
    status: "complete",
    retentionUntil: "2026-09-02T09:00:00+03:00",
  },
  hero: { title: "Доброе утро, Alex." },
  notes: [
    {
      id: "note:hero",
      target: "hero",
      text: "утро без суеты",
      role: "reassurance",
      tone: "ink",
      rotation: "positive",
      mark: "arrow-down-right",
    },
    {
      id: "note:story",
      target: "story:story-1",
      text: "сюда стоит смотреть",
      role: "context",
      tone: "signal",
      rotation: "negative",
      mark: "arrow-down-left",
    },
    {
      id: "note:story-later",
      target: "story:story-6",
      text: "ещё один акцент",
      role: "focus",
      tone: "signal",
      rotation: "positive",
      mark: "arrow-down-left",
    },
  ],
  calendar: {
    state: "ready",
    events: [],
    demoEvents: [{
      id: "demo-calendar-1",
      title: "Проверка расписания",
      displayTime: "11:00",
      calendarLabel: "Demo",
      duration: "45 мин",
      location: "Bernardinų sodas, Vilnius",
      description: "Длинное описание проверяет перенос строк внутри компактной строки события.",
      demo: true,
    }, ...Array.from({ length: 4 }, (_, index) => ({
      id: `demo-calendar-${index + 2}`,
      title: `Демонстрационное событие ${index + 2}`,
      displayTime: `${12 + index}:00`,
      calendarLabel: "Demo",
      demo: true,
    }))],
  },
  mail: {
    state: "ready",
    items: [{
      id: "mail-1",
      provider: "gmail",
      providerItemId: "gmail-message-1",
      subject: "Проверка",
      sender: "Kurami",
      class: "ACTION",
      summary: "Короткая проверка почтового компонента.",
    }, ...Array.from({ length: 4 }, (_, index) => ({
      id: `mail-${index + 2}`,
      subject: `Демонстрационное письмо ${index + 2}`,
      sender: "Demo Sender",
      class: index === 0 ? "IMPORTANT" : "GENERAL",
      summary: "Тестовое содержимое для проверки прокрутки и длинной выборки.",
      demo: true,
    }))],
  },
  news: {
    state: "ready",
    pageSize: 10,
    mainStoryIds: ["story-1"],
    items: Array.from({ length: 11 }, (_, index) => ({
      id: `story-${index + 1}`,
      fingerprint: `fp-story-${index + 1}`,
      headline: index === 0 ? "Тестовая новость" : `Тестовая новость ${index + 1}`,
      summary: `Короткое проверяемое описание для демонстрационной новости ${index + 1}.`,
      details: ["Расширенный проверяемый абзац с фактическими деталями новости."],
      topics: [
        { id: "ai", label: "AI" },
        {
          id: ["privacy", "security", "design", "software-development"][index % 4],
          label: ["Privacy", "Security", "Design", "Software Development"][index % 4],
        },
      ],
      ...(index === 0 ? {
        sources: [{
          sourceKey: "telegram:test",
          itemIds: ["100", "105", "110"],
          mediaMessageIds: ["100"],
        }],
      } : {}),
    })),
  },
  dataQuality: { state: "ready" },
  sourceBatches: [{
    sourceKey: "telegram:test",
    provider: "telegram",
    providerSourceId: "-1001234567890",
    minItemId: "100",
    maxItemId: "110",
    itemIds: ["100", "105", "110"],
  }],
};

const parsedPayload = parseBriefingPayload(payload);
const distributedStoryNotes = ["story-1", "story-6", "story-11"].map((storyId, index) => ({
  id: `note:distributed-${index + 1}`,
  target: `story:${storyId}`,
  text: "важная деталь",
  role: "context",
  tone: "signal",
  rotation: index % 2 === 0 ? "negative" : "positive",
  mark: "arrow-down-left",
}));
assert.doesNotThrow(() => parseBriefingPayload({ ...payload, notes: distributedStoryNotes }));
assert.deepEqual(
  storyNoteDistributionIssues(parseBriefingPayload({ ...payload, notes: distributedStoryNotes })),
  [],
);
assert.deepEqual(
  storyNoteDistributionIssues(parseBriefingPayload({
    ...payload,
    notes: [distributedStoryNotes[0]!, { ...distributedStoryNotes[1]!, target: "story:story-2" }, distributedStoryNotes[2]!],
  })),
  ["Story notes must target different five-story bands"],
);
assert.deepEqual(
  storyNoteDistributionIssues(parseBriefingPayload({ ...payload, notes: [distributedStoryNotes[0]!] })),
  ["Kurami Notes must contain exactly 3 notes for 11 stories"],
);
const explicitCompositionPayload = parseBriefingPayload({
  ...payload,
  addons: {
    calendar: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} },
    news: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} },
    weather: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} },
  },
});
const explicitFullCompositionPayload = parseBriefingPayload({
  ...payload,
  addons: {
    calendar: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} },
    mail: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} },
    news: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} },
    weather: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} },
  },
});
assert.equal(renderBriefingPage(explicitFullCompositionPayload), renderBriefingPage(parsedPayload));
const explicitCompositionHtml = renderBriefingPage(explicitCompositionPayload);
assert.doesNotMatch(explicitCompositionHtml, /id="mail-heading"/);
assert.doesNotMatch(explicitCompositionHtml, /data-metric="mail"/);
assert.match(explicitCompositionHtml, /id="calendar-heading">Расписание/);
assert.match(explicitCompositionHtml, /data-paginated-feed/);
validateRenderedHtml(explicitCompositionHtml, explicitCompositionPayload);
assert.throws(
  () => parseBriefingPayload({
    ...payload,
    addons: { invalid_addon: { version: 1, state: "ready", capturedAt: payload.edition.generatedAt, data: {} } },
  }),
  /invalid ID/,
);
assert.throws(
  () => parseBriefingPayload({
    ...payload,
    addons: { news: { version: 0, state: "ready", capturedAt: payload.edition.generatedAt, data: {} } },
  }),
  /positive safe integer/,
);
const addonCalls: string[] = [];
const testAddons: BriefingAddon[] = [
  {
    id: "later",
    failurePolicy: "isolate",
    enabled: () => true,
    sections: [{
      slot: "main",
      order: 20,
      render: () => {
        addonCalls.push("later");
        return "<section>later</section>";
      },
    }],
    metrics: [{
      order: 20,
      build: () => ({ key: "later", label: "Later", value: "2", chip: "ok", context: "test" }),
    }],
  },
  {
    id: "disabled",
    failurePolicy: "isolate",
    enabled: () => false,
    sections: [{
      slot: "main",
      order: 1,
      render: () => {
        addonCalls.push("disabled");
        return "<section>disabled</section>";
      },
    }],
  },
  {
    id: "earlier",
    failurePolicy: "isolate",
    enabled: () => true,
    sections: [{
      slot: "main",
      order: 10,
      render: () => {
        addonCalls.push("earlier");
        return "<section>earlier</section>";
      },
    }],
    metrics: [{
      order: 10,
      build: () => ({ key: "earlier", label: "Earlier", value: "1", chip: "ok", context: "test" }),
    }],
  },
];
assert.equal(
  renderAddonSlot(parsedPayload, "main", testAddons),
  "<section>earlier</section>\n      <section>later</section>",
);
assert.deepEqual(addonCalls, ["earlier", "later"]);
assert.deepEqual(
  collectAddonMetrics(parsedPayload, testAddons).map((value) => value.card.key),
  ["earlier", "later"],
);
const isolatedFailure: BriefingAddon = {
  id: "optional-failure",
  failurePolicy: "isolate",
  enabled: () => true,
  sections: [{ slot: "after-main", order: 10, render: () => { throw new Error("optional boom"); } }],
  renderFailure: (error) => `<aside>${error instanceof Error ? error.message : "failed"}</aside>`,
};
assert.equal(
  renderAddonSlot(parsedPayload, "after-main", [isolatedFailure]),
  "<aside>optional boom</aside>",
);
const requiredFailure: BriefingAddon = {
  ...isolatedFailure,
  id: "required-failure",
  failurePolicy: "propagate",
};
assert.throws(
  () => renderAddonSlot(parsedPayload, "after-main", [requiredFailure]),
  /optional boom/,
);
assert.throws(
  () => renderAddonSlot(parsedPayload, "main", [testAddons[0]!, { ...testAddons[0]! }]),
  /duplicate briefing add-on ID/,
);
assert.equal(
  renderAddonSlot(parsedPayload, "main", [{
    id: "optional-enabled-failure",
    failurePolicy: "isolate",
    enabled: () => { throw new Error("toggle unavailable"); },
    sections: [{ slot: "main", order: 1, render: () => "must not render" }],
  }]),
  "",
);
assert.throws(
  () => renderAddonSlot(parsedPayload, "main", [{
    id: "required-enabled-failure",
    failurePolicy: "propagate",
    enabled: () => { throw new Error("required toggle unavailable"); },
  }]),
  /required toggle unavailable/,
);
assert.throws(
  () => renderAddonSlot(parsedPayload, "main", [{
    id: "invalid_addon",
    failurePolicy: "isolate",
    enabled: () => false,
  }]),
  /Invalid or duplicate briefing add-on ID/,
);
const html = renderBriefingPage(parsedPayload);
assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg">/);
const legacyHtml = injectRuntime("<!doctype html><html><head><title>Legacy</title></head><body></body></html>");
assert.match(legacyHtml, /<meta name="theme-color" content="#fbfbf8"><link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"><\/head>/);
assert.equal(injectRuntime(html).match(/href="\/favicon\.svg"/g)?.length, 1);
const providerWeatherPayload = parseBriefingPayload({
  ...payload,
  weather: {
    state: "ready",
    provider: "open-meteo",
    location: "Vilnius, Lithuania",
    observedAt: "2026-08-28T09:00",
    temperatureCelsius: 20.3,
    apparentTemperatureCelsius: 21,
    condition: { code: 3, label: "Пасмурно", emoji: "☁️" },
    maximumCelsius: 22.4,
    precipitationProbabilityPercent: 100,
  },
});
assert.equal(section(providerWeatherPayload, "weather")?.temperatureC, 20.3);
assert.equal(section(providerWeatherPayload, "weather")?.feelsLikeC, 21);
assert.equal(section(providerWeatherPayload, "weather")?.condition, "☁️ Пасмурно");
assert.equal(section(providerWeatherPayload, "weather")?.summary, "до 22° · осадки 100%");
assert.match(renderBriefingPage(providerWeatherPayload), /metric-card__value" data-ui-figure>\+20°<\/strong>/);
assert.match(html, /\[hidden\]\s*\{\s*display:\s*none !important/);
assert.match(html, /class="topic-chip"/);
assert.match(html, /сюда стоит смотреть <span aria-hidden="true">↙<\/span>/);
assert(
  html.indexOf("сюда стоит смотреть") < html.indexOf("<h3>Тестовая новость</h3>"),
  "Story note must render above the story headline",
);
assert.match(html, /class="story-disclosure__body"/);
assert.match(html, /data-story-toggle/);
assert.match(html, /class="metric-strip"/);
assert.match(html, /class="briefing-overview"/);
assert.match(html, /id="calendar-heading">Расписание/);
assert.match(html, /class="agenda-row__badge is-demo">DEMO/);
assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\//);
assert.match(html, /aria-label="Все события на сегодня"/);
assert.match(html, /role="region" tabindex="0"/);
assert.match(html, /id="mail-heading">Почта/);
assert.match(html, /data-mail-class="action"/);
assert.match(html, /class="mail-row__demo">DEMO/);
assert.match(html, /aria-label="Все непрочитанные письма"/);
assert.match(html, /class="mail-row__select"/);
assert.match(html, /class="mail-row__select-placeholder"/);
assert.match(html, /data-mail-archive disabled>Прочитать и архивировать/);
assert.match(html, /data-site-header/);
assert.match(html, /site-header__inner/);
assert.match(html, /data-media-dialog/);
assert.doesNotMatch(html, /data-read-state/);
const legacyVideoPayload = parseBriefingPayload({
  ...payload,
  news: {
    ...payload.news,
    items: payload.news.items.map((story, index) => index === 0 ? {
      ...story,
      media: [{
        id: "legacy-video",
        kind: "video",
        src: "/media/daily/2026-08-28/story-1/legacy.mp4",
        alt: "Legacy Telegram video",
        mimeType: "video/mp4",
        sourceKey: "telegram:test",
        providerItemId: "100",
      }],
    } : story),
  },
});
assert.match(renderBriefingPage(legacyVideoPayload), /<video controls/);
const readStateHtml = renderBriefingPage(parseBriefingPayload({
  ...payload,
  news: {
    ...payload.news,
    items: payload.news.items.map((story, index) => index === 0
      ? { ...story, readState: "read" as const }
      : story),
  },
}));
assert.match(readStateHtml, /data-item-id="story-1"[\s\S]*?data-read-state>Прочитано/);
assert.equal((readStateHtml.match(/data-read-state/g) ?? []).length, 1);
assert.match(html, /font-family: "Caveat";[^}]*url\("\/assets\/caveat-cyrillic\.woff2"\)/);
assert.match(html, /data-feed-pagination/);
assert.match(html, /data-page-range/);
assert.match(html, /data-page="2"/);
assert.match(html, /data-page-prev/);
assert.match(html, /data-page-next/);
assert.match(html, /input[^>]+data-page-input/);
assert.match(html, /aria-label="Больше такого"[^>]+data-reaction="like"/);
assert.match(html, /aria-label="Меньше такого"[^>]+data-reaction="dislike"/);
assert.match(html, /data-reaction="like"[^>]*><svg class="button__svg"[^>]*><path d="M12 19V5 M6 11l6-6 6 6"\/><\/svg><\/button>/);
assert.match(html, /data-reaction="dislike"[^>]*><svg class="button__svg"[^>]*><path d="M12 5v14 m-6-6 6 6 6-6"\/><\/svg><\/button>/);
assert.doesNotMatch(html, /🔔|🔕/);
assert.match(html, /data-note-id="note:hero"[^>]*>утро без суеты/);
assert.match(html, /data-note-id="note:story"[^>]*>сюда стоит смотреть/);
assert.doesNotMatch(html, /kurami-note--ink/);
assert.match(html, /\.kurami-note \{ color: var\(--accent-primary\);/);
assert.doesNotMatch(html, /спокойно, всё собрано|главное — рядом/);
assert.doesNotMatch(html, /<script\b/i);

await assert.rejects(
  preparePreview(
    { ...payload, schemaVersion: 1 },
    html,
    paths,
  ),
  /new daily production editions require schemaVersion 2/,
);

assert.throws(
  () => parseBriefingPayload({
    ...payload,
    mail: {
      ...payload.mail,
      items: [{
        id: "mail-without-provider",
        class: "GENERAL",
        subject: "Real mail without provider ID",
      }],
    },
  }),
  /requires provider and providerItemId unless demo is true/,
);

assert.throws(
  () => parseBriefingPayload({ ...payload, notes: [{ ...payload.notes[0], text: "раз два три четыре пять" }] }),
  /one to four words/,
);

assert.throws(
  () => parseBriefingPayload({
    ...payload,
    notes: [{ ...payload.notes[0], role: "personality", text: "кофе всё видел" }],
  }),
  /at least one informative note/,
);

const albumInput = resolve(home, "telegram-batch.json");
const albumOutput = resolve(home, "telegram-batch-normalized.json");
await writeFile(albumInput, JSON.stringify({
  items: [7915, 7907, 7912].map((messageId, index) => ({
    metadata: {
      hasMedia: true,
      mediaType: index === 1 ? "video" : index === 2 ? "document" : "photo",
      ...(index === 2 ? { mediaMimeType: "image/gif" } : {}),
      telegramChatId: -1001033871555,
      telegramMessageId: messageId,
      telegramGroupId: "9223372036854775000",
    },
  })),
}));
const normalizedAlbum = spawnSync("python3", [
  resolve(root, "integrations/hermes/skills/kurami-daily-briefing/scripts/normalize_telegram_albums.py"),
  "--input",
  albumInput,
  "--output",
  albumOutput,
], { encoding: "utf8" });
assert.equal(normalizedAlbum.status, 0, normalizedAlbum.stderr);
const albumBatch = JSON.parse(await readFile(albumOutput, "utf8")) as {
  items: Array<{ metadata: {
    allMediaMessageIds: number[];
    mediaMessageIds: number[];
    nonImageMediaMessageIds: number[];
  } }>;
};
assert.deepEqual(albumBatch.items[0]?.metadata.allMediaMessageIds, [7907, 7912, 7915]);
assert.deepEqual(albumBatch.items[0]?.metadata.mediaMessageIds, [7912, 7915]);
assert.deepEqual(albumBatch.items[0]?.metadata.nonImageMediaMessageIds, [7907]);

const telegramConfig = resolve(home, "briefing.yaml");
await writeFile(telegramConfig, `
sources:
  news:
    enabled: true
    channels:
      - key: tea-workshop
        id: -1001033871555
        label: Tea Workshop
        enabled: true
      - key: empty-channel
        id: -1001000000001
        label: Empty Channel
        enabled: true
`);
const telegramRaw = resolve(home, "telegram-raw.json");
const rawItems = [7915, 7907, 7912].map((messageId, index) => ({
  metadata: {
    hasMedia: true,
    mediaType: index === 1 ? "video" : index === 2 ? "document" : "photo",
    ...(index === 2 ? { mediaMimeType: "image/gif" } : {}),
    telegramChatId: -1001033871555,
    telegramMessageId: messageId,
    telegramGroupId: "9223372036854775000",
  },
}));
await writeFile(telegramRaw, JSON.stringify({
  sourceKey: "news",
  profile: "telegram-user",
  status: "ready",
  capture: {
    channels: [
      {
        sourceKey: "tea-workshop",
        channelId: -1001033871555,
        label: "Tea Workshop",
        status: "ready",
        capturedUnreadCount: 3,
        upperMessageId: 7915,
        fetchedMessageIds: [7915, 7907, 7912],
      },
      {
        sourceKey: "empty-channel",
        channelId: -1001000000001,
        label: "Empty Channel",
        status: "empty",
        capturedUnreadCount: 0,
        upperMessageId: null,
        fetchedMessageIds: [],
      },
    ],
  },
  items: rawItems,
}));
const telegramNormalized = resolve(home, "telegram-normalized.json");
await writeFile(telegramNormalized, JSON.stringify({
  items: rawItems.map((item) => ({
    metadata: {
      ...item.metadata,
      allMediaMessageIds: [7907, 7912, 7915],
      mediaMessageIds: [7912, 7915],
      nonImageMediaMessageIds: [7907],
    },
  })),
}));
const telegramReport = await validateTelegramBatch(telegramConfig, telegramRaw, telegramNormalized);
assert.deepEqual({
  complete: telegramReport.complete,
  configuredChannels: telegramReport.configuredChannels,
  capturedUnread: telegramReport.capturedUnread,
  fetched: telegramReport.fetched,
  normalized: telegramReport.normalized,
  mediaMessages: telegramReport.mediaMessages,
  skippedNonImageMessages: telegramReport.skippedNonImageMessages,
  albumGroups: telegramReport.albumGroups,
}, {
  complete: true,
  configuredChannels: 2,
  capturedUnread: 3,
  fetched: 3,
  normalized: 3,
  mediaMessages: 2,
  skippedNonImageMessages: 1,
  albumGroups: 1,
});
assert.deepEqual(telegramReport.channels[0]?.mediaItemIds, [7912, 7915]);
assert.deepEqual(telegramReport.channels[0]?.nonImageMediaItemIds, [7907]);
await writeFile(telegramRaw, JSON.stringify({
  sourceKey: "news",
  profile: "telegram-user",
  status: "ready",
  capture: {
    channels: [
      {
        sourceKey: "tea-workshop",
        channelId: -1001033871555,
        label: "Tea Workshop",
        status: "ready",
        capturedUnreadCount: 4,
        upperMessageId: 7915,
        fetchedMessageIds: [7915, 7907, 7912],
      },
      {
        sourceKey: "empty-channel",
        channelId: -1001000000001,
        label: "Empty Channel",
        status: "empty",
        capturedUnreadCount: 0,
        upperMessageId: null,
        fetchedMessageIds: [],
      },
    ],
  },
  items: rawItems,
}));
await assert.rejects(
  validateTelegramBatch(telegramConfig, telegramRaw, telegramNormalized),
  /claims ready but fetched 3 of 4/,
);

const onlyVideoItem = {
  metadata: {
    hasMedia: true,
    mediaType: "video",
    telegramChatId: -1001033871555,
    telegramMessageId: 8000,
    telegramGroupId: null,
  },
};
await writeFile(telegramRaw, JSON.stringify({
  sourceKey: "news",
  profile: "telegram-user",
  status: "ready",
  capture: {
    channels: [
      {
        sourceKey: "tea-workshop",
        channelId: -1001033871555,
        label: "Tea Workshop",
        status: "ready",
        capturedUnreadCount: 1,
        upperMessageId: 8000,
        fetchedMessageIds: [8000],
      },
      {
        sourceKey: "empty-channel",
        channelId: -1001000000001,
        label: "Empty Channel",
        status: "empty",
        capturedUnreadCount: 0,
        upperMessageId: null,
        fetchedMessageIds: [],
      },
    ],
  },
  items: [onlyVideoItem],
}));
await writeFile(telegramNormalized, JSON.stringify({
  items: [{
    metadata: {
      ...onlyVideoItem.metadata,
      allMediaMessageIds: [8000],
      mediaMessageIds: [],
      nonImageMediaMessageIds: [8000],
    },
  }],
}));
const onlyVideoReport = await validateTelegramBatch(telegramConfig, telegramRaw, telegramNormalized);
assert.equal(onlyVideoReport.mediaMessages, 0);
assert.equal(onlyVideoReport.skippedNonImageMessages, 1);
assert.deepEqual(onlyVideoReport.channels[0]?.mediaItemIds, []);
assert.deepEqual(onlyVideoReport.channels[0]?.nonImageMediaItemIds, [8000]);

const capturedIds = Array.from({ length: 58 }, (_, index) => String(1_001 + index));
const makeSchemaV2Payload = (claimedItemIds: string[]) => ({
  schemaVersion: 2 as const,
  edition: {
    id: "daily:2026-08-29",
    type: "daily" as const,
    localDate: "2026-08-29",
    timezone: "Europe/Vilnius",
    generatedAt: "2026-08-29T09:00:00+03:00",
    status: "complete" as const,
    retentionUntil: "2026-09-03T09:00:00+03:00",
  },
  hero: { title: "Доброе утро, Alex." },
  calendar: { state: "empty" as const, events: [] },
  mail: { state: "empty" as const, items: [] },
  news: {
    state: "ready" as const,
    pageSize: 10,
    mainStoryIds: ["story-v2"],
    items: [{
      id: "story-v2",
      fingerprint: "fp-story-v2",
      headline: "Пятьдесят восемь сообщений объединены в один сюжет",
      summary: "Один сюжет может корректно ссылаться на множество исходных сообщений.",
      details: ["Все исходные сообщения остаются явно учтёнными в источниках сюжета."],
      topics: [
        { id: "technology", label: "Technology" },
        { id: "software-development", label: "Software Development" },
      ],
      sources: [{
        sourceKey: "telegram:test",
        itemIds: claimedItemIds,
        mediaMessageIds: [capturedIds[0]],
      }],
    }],
  },
  notes: [{
    id: "note:story-v2",
    target: "story:story-v2",
    text: "один важный сюжет",
    role: "context" as const,
    tone: "signal" as const,
    rotation: "none" as const,
    mark: "arrow-down-left" as const,
  }],
  dataQuality: { state: "ready" as const },
  sourceBatches: [{
    sourceKey: "telegram:test",
    provider: "telegram" as const,
    providerSourceId: "-1001234567890",
    minItemId: capturedIds[0],
    maxItemId: capturedIds.at(-1)!,
    itemIds: capturedIds,
  }],
});

const missingCoveragePayload = parseBriefingPayload(makeSchemaV2Payload(capturedIds.slice(0, 14)));
const missingCoverage = telegramStoryCoverage(missingCoveragePayload);
assert.deepEqual({
  complete: missingCoverage.complete,
  capturedItems: missingCoverage.capturedItems,
  storyItems: missingCoverage.storyItems,
  excludedItems: missingCoverage.excludedItems,
  missing: missingCoverage.issues.filter((issue) => issue.reason === "missing").length,
}, {
  complete: false,
  capturedItems: 58,
  storyItems: 14,
  excludedItems: 0,
  missing: 44,
});
assert.throws(
  () => assertTelegramStoryCoverage(missingCoveragePayload),
  /58 captured, 14 in stories, 0 excluded; 44 issue\(s\)/,
);

const duplicateAndUnknownPayload = parseBriefingPayload({
  ...makeSchemaV2Payload(capturedIds),
  news: {
    ...makeSchemaV2Payload(capturedIds).news,
    items: [
      makeSchemaV2Payload(capturedIds).news.items[0],
      {
        id: "story-v2-duplicate",
        fingerprint: "fp-story-v2-duplicate",
        headline: "Некорректная повторная ссылка",
        summary: "Проверка двойного владения одним исходным сообщением.",
        details: ["Тест также заявляет сообщение, отсутствующее в capture ledger."],
        topics: [
          { id: "technology", label: "Technology" },
          { id: "security", label: "Security" },
        ],
        sources: [{ sourceKey: "telegram:test", itemIds: [capturedIds[0], "9999"] }],
      },
    ],
  },
});
const duplicateAndUnknown = telegramStoryCoverage(duplicateAndUnknownPayload);
assert.equal(duplicateAndUnknown.complete, false);
assert.deepEqual(
  duplicateAndUnknown.issues.map((issue) => ({ key: issue.key, reason: issue.reason })),
  [
    { key: `telegram:test:${capturedIds[0]}`, reason: "duplicate" },
    { key: "telegram:test:9999", reason: "unknown" },
  ],
);

const exactCoveragePayload = parseBriefingPayload(makeSchemaV2Payload(capturedIds));
assert.deepEqual(telegramStoryCoverage(exactCoveragePayload), {
  complete: true,
  capturedItems: 58,
  storyItems: 58,
  excludedItems: 0,
  issues: [],
});

const gateHome = await mkdtemp(resolve(tmpdir(), "kurami-briefing-ingestion-gates-"));
const gatePaths = briefingPaths({
  KURAMI_HOME: gateHome,
  BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
} as NodeJS.ProcessEnv);
await assert.rejects(
  preparePreview(
    missingCoveragePayload,
    renderBriefingPage(missingCoveragePayload),
    gatePaths,
  ),
  /Telegram source coverage is incomplete/,
);
await preparePreview(
  exactCoveragePayload,
  renderBriefingPage(exactCoveragePayload),
  gatePaths,
);

const exactReport: TelegramBatchReport = {
  complete: true,
  configuredChannels: 1,
  capturedUnread: capturedIds.length,
  fetched: capturedIds.length,
  normalized: capturedIds.length,
  mediaMessages: 1,
  skippedNonImageMessages: 1,
  albumGroups: 1,
  channels: [{
    sourceKey: "test",
    channelId: -1001234567890,
    label: "Test",
    state: "ready",
    capturedUnread: capturedIds.length,
    fetched: capturedIds.length,
    normalized: capturedIds.length,
    upperMessageId: Number(capturedIds.at(-1)),
    mediaMessages: 1,
    skippedNonImageMessages: 1,
    albumGroups: 1,
    itemIds: capturedIds.map(Number),
    mediaItemIds: [Number(capturedIds[0])],
    nonImageMediaItemIds: [Number(capturedIds[1])],
  }],
};

const onlyVideoStoryPayload = parseBriefingPayload({
  ...makeSchemaV2Payload(["8000"]),
  edition: {
    ...makeSchemaV2Payload(["8000"]).edition,
    id: "daily:2026-08-30",
    localDate: "2026-08-30",
    generatedAt: "2026-08-30T09:00:00+03:00",
    retentionUntil: "2026-09-04T09:00:00+03:00",
  },
  news: {
    ...makeSchemaV2Payload(["8000"]).news,
    items: [{
      ...makeSchemaV2Payload(["8000"]).news.items[0],
      id: "story-video-only",
      fingerprint: "fp-story-video-only",
      headline: "Видео остаётся доступно через Telegram",
      sources: [{ sourceKey: "telegram:test", itemIds: ["8000"], url: "https://t.me/c/123/8000" }],
    }],
    mainStoryIds: ["story-video-only"],
  },
  notes: [{ ...makeSchemaV2Payload(["8000"]).notes[0], target: "story:story-video-only" }],
  sourceBatches: [{
    sourceKey: "telegram:test",
    provider: "telegram",
    providerSourceId: "-1001234567890",
    minItemId: "8000",
    maxItemId: "8000",
    itemIds: ["8000"],
  }],
});
await preparePreview(
  onlyVideoStoryPayload,
  renderBriefingPage(onlyVideoStoryPayload),
  gatePaths,
);
const onlyVideoStoryReport: TelegramBatchReport = {
  complete: true,
  configuredChannels: 1,
  capturedUnread: 1,
  fetched: 1,
  normalized: 1,
  mediaMessages: 0,
  skippedNonImageMessages: 1,
  albumGroups: 1,
  channels: [{
    sourceKey: "test",
    channelId: -1001234567890,
    label: "Test",
    state: "ready",
    capturedUnread: 1,
    fetched: 1,
    normalized: 1,
    upperMessageId: 8000,
    mediaMessages: 0,
    skippedNonImageMessages: 1,
    albumGroups: 1,
    itemIds: [8000],
    mediaItemIds: [],
    nonImageMediaItemIds: [8000],
  }],
};

let gateDatabase = openBriefingDatabase(gatePaths);
try {
  recordTelegramValidation(
    gateDatabase,
    onlyVideoStoryPayload.edition.id,
    onlyVideoStoryReport,
    { raw: "only-video-raw", normalized: "only-video-normalized" },
  );
  const onlyVideoPlan = createTelegramCommitPlan(gateDatabase, onlyVideoStoryPayload.edition.id);
  assert.equal(onlyVideoPlan.sources.length, 1);
  assert.throws(
    () => createTelegramCommitPlan(gateDatabase, exactCoveragePayload.edition.id),
    /persisted raw\/normalized validation receipt/,
  );
  const mismatchedBoundaryReport: TelegramBatchReport = {
    ...exactReport,
    channels: exactReport.channels.map((channel) => ({
      ...channel,
      upperMessageId: channel.upperMessageId! + 1,
    })),
  };
  assert.throws(
    () => recordTelegramValidation(
      gateDatabase,
      exactCoveragePayload.edition.id,
      mismatchedBoundaryReport,
      { raw: "boundary-raw-digest", normalized: "boundary-normalized-digest" },
    ),
    /upper boundary differs for telegram:test/,
  );
  const incompleteReport: TelegramBatchReport = {
    ...exactReport,
    complete: false,
    capturedUnread: exactReport.capturedUnread + 1,
    channels: exactReport.channels.map((channel) => ({
      ...channel,
      state: "partial",
      capturedUnread: channel.capturedUnread + 1,
    })),
  };
  recordTelegramValidation(
    gateDatabase,
    exactCoveragePayload.edition.id,
    incompleteReport,
    { raw: "incomplete-raw-digest", normalized: "incomplete-normalized-digest" },
  );
  assert.throws(
    () => createTelegramCommitPlan(gateDatabase, exactCoveragePayload.edition.id),
    /requires a complete raw\/normalized capture/,
  );
  recordTelegramValidation(
    gateDatabase,
    exactCoveragePayload.edition.id,
    exactReport,
    { raw: "raw-digest", normalized: "normalized-digest" },
  );
  assert.throws(
    () => createTelegramCommitPlan(gateDatabase, exactCoveragePayload.edition.id),
    /imported 0 of 1 expected media assets/,
  );
} finally {
  gateDatabase.close();
}

await mkdir(gatePaths.mediaInboxDirectory, { recursive: true });
const gateMediaAsset = resolve(gatePaths.mediaInboxDirectory, "story-v2.jpg");
const originalGateMediaBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
await writeFile(gateMediaAsset, originalGateMediaBytes);
await importEditionMedia({
  editionId: exactCoveragePayload.edition.id,
  stories: [{
    itemId: "story-v2",
    assets: [{
      sourcePath: gateMediaAsset,
      alt: "Тестовая Telegram-иллюстрация",
      sourceKey: "telegram:test",
      providerItemId: capturedIds[0],
    }],
  }],
}, gatePaths);

let issuedPlanDigest = "";
gateDatabase = openBriefingDatabase(gatePaths);
try {
  assert.throws(
    () => createTelegramCommitPlan(gateDatabase, exactCoveragePayload.edition.id),
    /persisted raw\/normalized validation receipt/,
  );
  recordTelegramValidation(
    gateDatabase,
    exactCoveragePayload.edition.id,
    exactReport,
    { raw: "raw-digest-after-media", normalized: "normalized-digest-after-media" },
  );
  const commitPlan = createTelegramCommitPlan(gateDatabase, exactCoveragePayload.edition.id);
  issuedPlanDigest = commitPlan.planDigest;
  assert.deepEqual(commitPlan.sources, [{
    sourceKey: "telegram:test",
    chatId: -1001234567890,
    maxId: 1058,
  }]);
  assert.match(commitPlan.planDigest, /^[a-f0-9]{64}$/);
} finally {
  gateDatabase.close();
}

const replacementAsset = resolve(gatePaths.mediaInboxDirectory, "story-v2-replacement.jpg");
const rejectedAsset = resolve(gatePaths.mediaInboxDirectory, "story-v2-rejected.txt");
const replacementBytes = Buffer.from([0xff, 0xd8, 0x44, 0x55, 0xff, 0xd9]);
await writeFile(replacementAsset, replacementBytes);
await writeFile(rejectedAsset, "not supported media");
await assert.rejects(
  importEditionMedia({
    editionId: exactCoveragePayload.edition.id,
    stories: [{
      itemId: "story-v2",
      assets: [
        {
          sourcePath: replacementAsset,
          alt: "Замена успела попасть в частичную копию",
          sourceKey: "telegram:test",
          providerItemId: capturedIds[0],
        },
        {
          sourcePath: rejectedAsset,
          alt: "Неподдерживаемый второй файл",
          sourceKey: "telegram:test",
          providerItemId: capturedIds[0],
        },
      ],
    }],
  }, gatePaths),
  /unsupported media extension \.txt/,
);
assert.deepEqual(
  await readFile(resolve(gatePaths.mediaDirectory, "daily/2026-08-29/story-v2/01.jpg")),
  originalGateMediaBytes,
);
assert.deepEqual(
  await readdir(resolve(gatePaths.mediaDirectory, "daily/2026-08-29")),
  ["story-v2"],
);
assert.equal(
  (await readdir(gatePaths.mediaInboxDirectory)).some((entry) => entry.startsWith(".media-import-")),
  false,
);
gateDatabase = openBriefingDatabase(gatePaths);
try {
  const stalePlan = gateDatabase.prepare(`
    SELECT commit_plan_digest AS planDigest
    FROM telegram_validation_receipts WHERE edition_id = ?
  `).get(exactCoveragePayload.edition.id) as { planDigest: string } | undefined;
  assert.equal(stalePlan, undefined);
  assert.notEqual(issuedPlanDigest, "");
  assert.throws(
    () => createTelegramCommitPlan(gateDatabase, exactCoveragePayload.edition.id),
    /persisted raw\/normalized validation receipt/,
  );
} finally {
  gateDatabase.close();
}

const initialized = await initializeBriefingStore(paths);
assert.equal(initialized.integrity, "ok");
assert.deepEqual(initialized.applied, [
  "001_initial.sql",
  "002_source_provider_ids.sql",
  "003_ingestion_gates.sql",
  "004_deterministic_runs.sql",
  "005_addon_snapshots.sql",
  "006_discord_run_cards.sql",
  "007_recovery_windows.sql",
  "008_interest_profile.sql",
  "009_weekly_review.sql",
  "010_stocks_budget.sql",
  "011_stocks_discovery.sql",
  "012_weekly_persistence_failures.sql",
  "013_weekly_mail_observation_failures.sql",
  "014_mail_learning.sql",
]);
const snapshotDatabase = openBriefingDatabase(paths);
try {
  const storedSnapshot = upsertAddonSnapshot(snapshotDatabase, "cinema", {
    version: 1,
    state: "ready",
    capturedAt: "2026-08-28T06:00:00.000Z",
    data: { title: "Cinema weekly", items: [{ id: "film-1" }] },
  });
  assert.equal(storedSnapshot.addonId, "cinema");
  assert.equal(storedSnapshot.contentDigest.length, 64);
  assert.deepEqual(loadAddonSnapshot(snapshotDatabase, "cinema")?.envelope.data, {
    title: "Cinema weekly",
    items: [{ id: "film-1" }],
  });
  const reorderedSnapshot = upsertAddonSnapshot(snapshotDatabase, "cinema", {
    version: 1,
    state: "ready",
    capturedAt: "2026-08-28T06:00:00.000Z",
    data: { items: [{ id: "film-1" }], title: "Cinema weekly" },
  });
  assert.equal(reorderedSnapshot.contentDigest, storedSnapshot.contentDigest);
  assert.deepEqual(listAddonSnapshots(snapshotDatabase).map((snapshot) => snapshot.addonId), ["cinema"]);
  assert.throws(
    () => upsertAddonSnapshot(snapshotDatabase, "invalid_addon", storedSnapshot.envelope),
    /Invalid briefing add-on ID/,
  );
} finally {
  snapshotDatabase.close();
}

await initializeBriefingStore(paths);
const firstCommitFault = openBriefingDatabase(paths);
try {
  firstCommitFault.exec(`
    CREATE TABLE preview_commit_fault_parent (id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE preview_commit_fault_child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES preview_commit_fault_parent(id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TRIGGER preview_commit_fault AFTER INSERT ON editions BEGIN
      INSERT INTO preview_commit_fault_child (id, parent_id) VALUES (1, 42);
    END;
  `);
} finally {
  firstCommitFault.close();
}
try {
  await assert.rejects(preparePreview(payload, html, paths), /FOREIGN KEY constraint failed/);
} finally {
  const faultCleanup = openBriefingDatabase(paths);
  try {
    faultCleanup.exec(`
      DROP TRIGGER preview_commit_fault;
      DROP TABLE preview_commit_fault_child;
      DROP TABLE preview_commit_fault_parent;
    `);
    assert.equal(loadEdition(faultCleanup, { id: "daily:2026-08-28" }), null);
  } finally {
    faultCleanup.close();
  }
}
await assert.rejects(
  readFile(resolve(paths.previewDirectory, "daily-2026-08-28.html"), "utf8"),
  { code: "ENOENT" },
);

const prepared = await preparePreview(payload, html, paths);
assert.equal(prepared.editionId, "daily:2026-08-28");
assert.equal(prepared.previewPath, "/preview/daily/2026-08-28");
assert.equal(prepared.state, "prepared");

const preparedHtmlPath = resolve(paths.previewDirectory, "daily-2026-08-28.html");
const originalPreparedHtml = await readFile(preparedHtmlPath, "utf8");
let originalPreparedRow: { payload_json: string; content_digest: string; prepared_at: string };
const faultSetup = openBriefingDatabase(paths);
try {
  originalPreparedRow = faultSetup.prepare(`
    SELECT payload_json, content_digest, prepared_at FROM editions WHERE id = ?
  `).get(prepared.editionId) as typeof originalPreparedRow;
  faultSetup.exec(`
    CREATE TABLE preview_commit_fault_parent (id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE preview_commit_fault_child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES preview_commit_fault_parent(id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TRIGGER preview_commit_fault AFTER UPDATE ON editions BEGIN
      INSERT INTO preview_commit_fault_child (id, parent_id) VALUES (1, 42);
    END;
  `);
} finally {
  faultSetup.close();
}
try {
  await assert.rejects(
    preparePreview(payload, `${html}<!-- commit-failure-probe -->`, paths),
    /FOREIGN KEY constraint failed/,
  );
  await assert.rejects(
    refreshPreparedPreviewMedia(parseBriefingPayload(payload), `${html}<!-- media-commit-failure-probe -->`, paths),
    /FOREIGN KEY constraint failed/,
  );
} finally {
  const faultCleanup = openBriefingDatabase(paths);
  try {
    faultCleanup.exec(`
      DROP TRIGGER preview_commit_fault;
      DROP TABLE preview_commit_fault_child;
      DROP TABLE preview_commit_fault_parent;
    `);
  } finally {
    faultCleanup.close();
  }
}
const afterFault = openBriefingDatabase(paths);
try {
  assert.deepEqual(afterFault.prepare(`
    SELECT payload_json, content_digest, prepared_at FROM editions WHERE id = ?
  `).get(prepared.editionId), originalPreparedRow);
} finally {
  afterFault.close();
}
assert.equal(await readFile(preparedHtmlPath, "utf8"), originalPreparedHtml);

const inboxAsset = resolve(paths.mediaInboxDirectory, "story-1.jpg");
await mkdir(paths.mediaInboxDirectory, { recursive: true });
await writeFile(inboxAsset, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
const rejectedVideoAsset = resolve(paths.mediaInboxDirectory, "story-1.mp4");
await writeFile(rejectedVideoAsset, Buffer.from("legacy video must not be imported"));
await assert.rejects(
  importEditionMedia({
    editionId: "daily:2026-08-28",
    stories: [{
      itemId: "story-1",
      assets: [{ sourcePath: rejectedVideoAsset }],
    }],
  }, paths),
  /unsupported media extension \.mp4/,
);
const importedMedia = await importEditionMedia({
  editionId: "daily:2026-08-28",
  stories: [{
    itemId: "story-1",
    assets: [{
      sourcePath: inboxAsset,
      alt: "Тестовая иллюстрация",
      sourceKey: "telegram:test",
      providerItemId: "100",
    }],
  }],
}, paths);
assert.equal(importedMedia.imported, 1);
assert.equal(importedMedia.previewPath, prepared.previewPath);

const runtimeTelegramReport: TelegramBatchReport = {
  complete: true,
  configuredChannels: 1,
  capturedUnread: 3,
  fetched: 3,
  normalized: 3,
  mediaMessages: 1,
  skippedNonImageMessages: 0,
  albumGroups: 1,
  channels: [{
    sourceKey: "test",
    channelId: -1001234567890,
    label: "Test",
    state: "ready",
    capturedUnread: 3,
    fetched: 3,
    normalized: 3,
    upperMessageId: 110,
    mediaMessages: 1,
    skippedNonImageMessages: 0,
    albumGroups: 1,
    itemIds: [100, 105, 110],
    mediaItemIds: [100],
    nonImageMediaItemIds: [],
  }],
};
let preparedPayloadWithMedia = parsedPayload;

const database = openBriefingDatabase(paths);
try {
  const edition = loadEdition(database, { id: "daily:2026-08-28" });
  assert(edition);
  assert.equal(edition.state, "prepared");
  assert.equal(edition.is_current, 0);
  assert.equal(edition.retention_until, "2026-09-04T00:00:00.000Z");
  const itemCounts = database
    .prepare("SELECT item_type, COUNT(*) AS count FROM edition_items GROUP BY item_type ORDER BY item_type")
    .all()
    .map((item) => ({ ...item }));
  assert.deepEqual(itemCounts, [
    { item_type: "mail", count: 5 },
    { item_type: "story", count: 11 },
  ]);
  const storedPayload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  preparedPayloadWithMedia = storedPayload;
  assert.equal(storedPayload.edition.retentionUntil, "2026-09-04T00:00:00.000Z");
  assert.equal(section(storedPayload, "news").items[0]?.media?.[0]?.src, "/media/daily/2026-08-28/story-1/01.jpg");
  assert.equal((storedPayload.dataQuality.telegramCollection as { imported: number }).imported, 1);
  assert.match(String(storedPayload.dataQuality.summary), /1 медиафайлов сохранено/);
} finally {
  database.close();
}

assert.throws(
  () => validateRenderedHtml("<!doctype html><html><body><script>alert(1)</script></body></html>"),
  /forbidden script elements/,
);
assert.throws(
  () => validateRenderedHtml("<!doctype html><html><body><button data-theme-toggle onclick=\"alert(1)\">Тема</button></body></html>"),
  /forbidden inline event handlers/,
);
assert.doesNotThrow(
  () => validateRenderedHtml("<!doctype html><html><body><button data-theme-toggle>Тема</button><p>const onClick = () =&gt; undefined</p></body></html>"),
);
assert.throws(
  () => validateRenderedHtml("<!doctype html><html><body><p>Без темы</p></body></html>"),
  /visible theme toggle/,
);
await assert.rejects(
  preparePreview(
    payload,
    '<!doctype html><html><body><button data-theme-toggle>Тема</button></body></html>',
    paths,
  ),
  /missing feed item story-1/,
);

const mailActions: Array<{ actionId: string; messageIds: string[] }> = [];
const server = await createBriefingServer(paths, {
  mailActionExecutor: async (input) => {
    mailActions.push(input);
    return { receipt: { provider: "test", count: input.messageIds.length } };
  },
});
await new Promise<void>((resolvePromise, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolvePromise);
});
const address = server.address() as AddressInfo;
const base = `http://127.0.0.1:${address.port}`;

try {
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    ok: true,
    database: "ok",
    editions: 1,
    externalMutations: true,
    currentEdition: null,
    latestAttempt: null,
    live: null,
  });

  const preview = await fetch(`${base}${prepared.previewPath}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const previewHtml = await preview.text();
  assert.match(previewHtml, /\/assets\/briefing\.js/);
  assert.match(previewHtml, /href="\/favicon\.svg"/);
  assert.match(previewHtml, /class="story-cover"/);
  assert.match(previewHtml, /class="story-media"/);
  assert.match(previewHtml, /\.news-story \{[^}]*grid-template-columns: 36px 176px minmax\(0, 1fr\) auto/);
  assert.match(previewHtml, /\.story-media__grid \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(previewHtml, /@media \(max-width: 620px\) \{[\s\S]*?\.story-cover, \.news-story__copy, \.news-story__actions \{ grid-column: 1 \/ -1; \}/);
  assert.match(previewHtml, /@media \(max-width: 620px\) \{[\s\S]*?\.news-story__actions \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 6px; \}/);
  assert.match(previewHtml, /\.story-toggle \{ grid-column: 1 \/ -1; width: 100%; \}/);
  assert.match(previewHtml, /\.news-story__source, \.news-story__actions \.reaction-button \{ width: 100%; min-width: 0; padding-inline: 0; \}/);

  const mediaResponse = await fetch(`${base}/media/daily/2026-08-28/story-1/01.jpg`, {
    headers: { range: "bytes=0-1" },
  });
  assert.equal(mediaResponse.status, 206);
  assert.equal(mediaResponse.headers.get("content-type"), "image/jpeg");
  assert.equal(mediaResponse.headers.get("content-range"), "bytes 0-1/4");
  assert.deepEqual(new Uint8Array(await mediaResponse.arrayBuffer()), new Uint8Array([0xff, 0xd8]));

  const script = await fetch(`${base}/assets/briefing.js`);
  assert.equal(script.status, 200);
  const clientScript = await script.text();
  assert.match(clientScript, /\/api\/items\/read|data-reaction/);
  assert.match(clientScript, /data-page-next|URLSearchParams|data-story-details|is-scrolled/);
  assert.match(clientScript, /data-overflow|PageDown|region\.scrollBy/);
  assert.match(clientScript, /api\/mail\/read-and-archive|data-mail-select-all/);
  for (const hook of ["data-chart", "data-chart-key", "data-chart-zoom-in", "data-chart-point"]) {
    assert(clientScript.includes(hook), `Missing shared chart hook ${hook}`);
  }

  const favicon = await fetch(`${base}/favicon.svg`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.equal(favicon.headers.get("x-content-type-options"), "nosniff");
  const faviconSvg = await favicon.text();
  assert.match(faviconSvg, /<title id="title">Kurami fox<\/title>/);
  assert.match(faviconSvg, /fill="#f05a28"/);
  assert.doesNotMatch(faviconSvg, /<script|(?:href|src)="https?:\/\//);

  const faviconHead = await fetch(`${base}/favicon.svg`, { method: "HEAD" });
  assert.equal(faviconHead.status, 200);
  assert.equal(await faviconHead.text(), "");

  const archiveMail = await fetch(`${base}/api/mail/read-and-archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ editionId: "daily:2026-08-28", itemIds: ["mail-1"] }),
  });
  assert.equal(archiveMail.status, 200);
  assert.deepEqual(mailActions.map((action) => action.messageIds), [["gmail-message-1"]]);
  const archiveMailRetry = await fetch(`${base}/api/mail/read-and-archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ editionId: "daily:2026-08-28", itemIds: ["mail-1"] }),
  });
  assert.equal(archiveMailRetry.status, 200);
  assert.equal((await archiveMailRetry.json() as { alreadyComplete: boolean }).alreadyComplete, true);
  assert.equal(mailActions.length, 1);

  const read = await fetch(`${base}/api/items/read`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ editionId: "daily:2026-08-28", itemId: "story-1" }),
  });
  assert.equal(read.status, 200);
  assert.equal((await read.json() as { ok: boolean }).ok, true);

  const reaction = await fetch(`${base}/api/stories/reaction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      editionId: "daily:2026-08-28",
      itemId: "story-1",
      reaction: "like",
    }),
  });
  assert.equal(reaction.status, 200);

  const refreshedPreview = await fetch(`${base}${prepared.previewPath}`);
  assert.equal(refreshedPreview.status, 200);
  const refreshedHtml = await refreshedPreview.text();
  assert.match(refreshedHtml, /id="briefing-state"/);
  assert.match(refreshedHtml, /"itemId":"story-1","read":true,"reaction":"like"/);

  const profileResponse = await fetch(`${base}/api/profile/topics`);
  assert.equal(profileResponse.status, 200);
  assert.deepEqual(await profileResponse.json(), {
    topics: [
      { topicId: "ai", label: "AI", likes: 1, dislikes: 0 },
      { topicId: "privacy", label: "Privacy", likes: 1, dislikes: 0 },
    ],
    pairs: [],
  });
} finally {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

let persisted = openBriefingDatabase(paths);
try {
  const item = persisted
    .prepare("SELECT read_at, reaction FROM edition_items WHERE edition_id = ? AND item_id = ?")
    .get("daily:2026-08-28", "story-1") as {
    read_at: string | null;
    reaction: string | null;
  };
  assert(item.read_at);
  assert.equal(item.reaction, "like");
  assert.deepEqual(topicProfile(persisted), [
    { topicId: "ai", label: "AI", likes: 1, dislikes: 0 },
    { topicId: "privacy", label: "Privacy", likes: 1, dislikes: 0 },
  ]);
  recordTelegramValidation(
    persisted,
    "daily:2026-08-28",
    runtimeTelegramReport,
    { raw: "runtime-raw-digest", normalized: "runtime-normalized-digest" },
  );
  const partialPlan = createTelegramCommitPlan(persisted, "daily:2026-08-28");
  const originalBatch = persisted.prepare(`
    SELECT state, committed_at, error_code FROM source_batches
    WHERE edition_id = ? AND source_key = ?
  `).get("daily:2026-08-28", "telegram:test");
  const originalCheckpoint = persisted.prepare(`
    SELECT * FROM source_checkpoints WHERE source_key = ?
  `).get("telegram:test");
  persisted.exec(`
    CREATE TABLE finalization_fault_parent (id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE finalization_fault_child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES finalization_fault_parent(id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TRIGGER finalization_fault AFTER UPDATE OF state ON editions BEGIN
      INSERT INTO finalization_fault_child (id, parent_id) VALUES (1, 42);
    END;
  `);
  try {
    assert.throws(
      () => finalizeEdition(persisted, "daily:2026-08-28", [
        { sourceKey: "telegram:test", status: "committed" },
      ], partialPlan.planDigest),
      /FOREIGN KEY constraint failed/,
    );
    assert.equal(loadEdition(persisted, { id: "daily:2026-08-28" })?.state, "prepared");
    assert.deepEqual(persisted.prepare(`
      SELECT state, committed_at, error_code FROM source_batches
      WHERE edition_id = ? AND source_key = ?
    `).get("daily:2026-08-28", "telegram:test"), originalBatch);
    assert.deepEqual(persisted.prepare(`
      SELECT * FROM source_checkpoints WHERE source_key = ?
    `).get("telegram:test"), originalCheckpoint);
  } finally {
    persisted.exec(`
      DROP TRIGGER finalization_fault;
      DROP TABLE finalization_fault_child;
      DROP TABLE finalization_fault_parent;
    `);
  }
  const partial = finalizeEdition(persisted, "daily:2026-08-28", [
    { sourceKey: "telegram:test", status: "failed", errorCode: "calendar_gate_blocked" },
  ], partialPlan.planDigest);
  assert.deepEqual(partial, {
    editionId: "daily:2026-08-28",
    state: "partial",
    publicationPath: "/daily/2026-08-28",
  });
} finally {
  persisted.close();
}

const retried = await preparePreview(
  preparedPayloadWithMedia,
  renderBriefingPage(preparedPayloadWithMedia),
  paths,
);
assert.equal(retried.state, "prepared");
persisted = openBriefingDatabase(paths);
try {
  const retriedItem = persisted
    .prepare("SELECT read_at, reaction FROM edition_items WHERE edition_id = ? AND item_id = ?")
    .get("daily:2026-08-28", "story-1") as {
    read_at: string | null;
    reaction: string | null;
  };
  assert(retriedItem.read_at);
  assert.equal(retriedItem.reaction, "like");
  const retriedBatch = persisted
    .prepare("SELECT state, error_code FROM source_batches WHERE edition_id = ? AND source_key = ?")
    .get("daily:2026-08-28", "telegram:test") as {
    state: string;
    error_code: string | null;
  };
  assert.equal(retriedBatch.state, "prepared");
  assert.equal(retriedBatch.error_code, "calendar_gate_blocked");
  recordTelegramValidation(
    persisted,
    "daily:2026-08-28",
    runtimeTelegramReport,
    { raw: "retry-raw-digest", normalized: "retry-normalized-digest" },
  );
  const retryPlan = createTelegramCommitPlan(persisted, "daily:2026-08-28");
  const finalized = finalizeEdition(persisted, "daily:2026-08-28", [
    { sourceKey: "telegram:test", status: "committed" },
  ], retryPlan.planDigest);
  assert.deepEqual(finalized, {
    editionId: "daily:2026-08-28",
    state: "complete",
    publicationPath: "/daily/2026-08-28",
  });
  assert.equal(loadEdition(persisted, { type: "daily", current: true })?.id, "daily:2026-08-28");
  assert.deepEqual(
    await removeArchivedMailFromRetainedEditions(
      persisted,
      paths,
      ["gmail-message-1"],
      "2026-08-30T00:00:00.000Z",
    ),
    ["daily:2026-08-28"],
  );
  const refreshedEdition = loadEdition(persisted, { id: "daily:2026-08-28" });
  assert(refreshedEdition);
  const refreshedPayload = parseBriefingPayload(JSON.parse(refreshedEdition.payload_json) as unknown);
  assert.equal(section(refreshedPayload, "mail").items.some((item) => item.providerItemId === "gmail-message-1"), false);
  assert.doesNotMatch(await readEditionHtml(refreshedEdition, paths), /gmail-message-1/);
  await assert.rejects(
    preparePreview(payload, html, paths),
    /already published/,
  );
  const rerendered = await rerenderPublishedPreview(parseBriefingPayload(payload), html, paths);
  assert.equal(rerendered.state, "complete");
  assert.equal(rerendered.previewPath, "/preview/daily/2026-08-28");
  assert.equal(loadEdition(persisted, { id: "daily:2026-08-28" })?.state, "complete");
} finally {
  persisted.close();
}

const revisionPayload = parseBriefingPayload({
  ...preparedPayloadWithMedia,
  notes: [{
    id: "note:revised-story",
    target: "story:story-1",
    text: "обновлённый контекст",
    role: "context",
    tone: "signal",
    rotation: "negative",
    mark: "arrow-down-right",
  }],
  news: {
    ...section(preparedPayloadWithMedia, "news"),
    items: section(preparedPayloadWithMedia, "news").items.map((story) => story.id === "story-1" ? {
      ...story,
      headline: "Редакционный заголовок обновлён без повторного сбора",
      summary: "Краткий пересказ теперь сообщает конкретный факт и остаётся независимым от полного текста.",
      details: ["Подробный пересказ также обновлён, но исходные сообщения, медиа и пользовательское состояние не меняются."],
    } : story),
  },
});
const revised = await revisePublishedEdition(revisionPayload, renderBriefingPage, paths);
assert.equal(revised.state, "complete");
persisted = openBriefingDatabase(paths);
try {
  const edition = loadEdition(persisted, { id: "daily:2026-08-28" });
  assert(edition);
  const revisedStored = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  const revisedStory = section(revisedStored, "news").items.find((story) => story.id === "story-1");
  assert.equal(revisedStory?.headline, "Редакционный заголовок обновлён без повторного сбора");
  assert.equal(revisedStory?.media?.[0]?.src, "/media/daily/2026-08-28/story-1/01.jpg");
  assert.equal(revisedStory?.readState, "read");
  assert.equal(revisedStory?.reaction, "like");
  assert.equal(revisedStored.notes?.[0]?.mark, "arrow-down-left");
  assert.match(await readEditionHtml(edition, paths), /обновлённый контекст <span aria-hidden="true">↙<\/span>/u);
} finally {
  persisted.close();
}

const publishedHtmlPath = resolve(paths.previewDirectory, "daily-2026-08-28.html");
const originalPublishedHtml = await readFile(publishedHtmlPath, "utf8");
const publishedFault = openBriefingDatabase(paths);
let originalPublishedRow: { payload_json: string; content_digest: string; updated_at: string };
let originalStoryState: unknown[];
let originalOccurrences: unknown[];
let publishedPayload: ReturnType<typeof parseBriefingPayload>;
try {
  originalPublishedRow = publishedFault.prepare(`
    SELECT payload_json, content_digest, updated_at FROM editions WHERE id = ?
  `).get(revised.editionId) as typeof originalPublishedRow;
  publishedPayload = parseBriefingPayload(JSON.parse(originalPublishedRow.payload_json) as unknown);
  originalStoryState = publishedFault.prepare(`
    SELECT item_id, story_fingerprint, topic_ids_json, read_at, reaction
    FROM edition_items WHERE edition_id = ? ORDER BY item_id
  `).all(revised.editionId);
  originalOccurrences = publishedFault.prepare(`
    SELECT topic_id, story_fingerprint, source_key
    FROM topic_story_occurrences WHERE edition_id = ? ORDER BY topic_id, story_fingerprint, source_key
  `).all(revised.editionId);
  publishedFault.exec(`
    CREATE TABLE published_commit_fault_parent (id INTEGER PRIMARY KEY) STRICT;
    CREATE TABLE published_commit_fault_child (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER NOT NULL REFERENCES published_commit_fault_parent(id)
        DEFERRABLE INITIALLY DEFERRED
    ) STRICT;
    CREATE TRIGGER published_commit_fault AFTER UPDATE ON editions BEGIN
      INSERT INTO published_commit_fault_child (id, parent_id) VALUES (1, 42);
    END;
  `);
} finally {
  publishedFault.close();
}
try {
  await assert.rejects(
    revisePublishedEdition(revisionPayload, (candidate) =>
      `${renderBriefingPage(candidate)}<!-- revision-commit-failure-probe -->`, paths),
    /FOREIGN KEY constraint failed/,
  );
  await assert.rejects(
    refreshPublishedEdition(
      publishedPayload,
      `${renderBriefingPage(publishedPayload)}<!-- refresh-commit-failure-probe -->`,
      originalPublishedRow.content_digest,
      paths,
    ),
    /FOREIGN KEY constraint failed/,
  );
} finally {
  const publishedCleanup = openBriefingDatabase(paths);
  try {
    publishedCleanup.exec(`
      DROP TRIGGER published_commit_fault;
      DROP TABLE published_commit_fault_child;
      DROP TABLE published_commit_fault_parent;
    `);
    assert.deepEqual(publishedCleanup.prepare(`
      SELECT payload_json, content_digest, updated_at FROM editions WHERE id = ?
    `).get(revised.editionId), originalPublishedRow);
    assert.deepEqual(publishedCleanup.prepare(`
      SELECT item_id, story_fingerprint, topic_ids_json, read_at, reaction
      FROM edition_items WHERE edition_id = ? ORDER BY item_id
    `).all(revised.editionId), originalStoryState);
    assert.deepEqual(publishedCleanup.prepare(`
      SELECT topic_id, story_fingerprint, source_key
      FROM topic_story_occurrences WHERE edition_id = ? ORDER BY topic_id, story_fingerprint, source_key
    `).all(revised.editionId), originalOccurrences);
  } finally {
    publishedCleanup.close();
  }
}
assert.equal(await readFile(publishedHtmlPath, "utf8"), originalPublishedHtml);

const cleanup = await cleanupExpired("2030-01-01T00:00:00.000Z", paths);
assert.deepEqual(cleanup.deleted, ["daily:2026-08-28"]);

const retentionHome = await mkdtemp(resolve(tmpdir(), "kurami-briefing-retention-"));
const retentionPaths = briefingPaths({
  KURAMI_HOME: retentionHome,
  BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
} as NodeJS.ProcessEnv);
await initializeBriefingStore(retentionPaths);
let retentionDatabase = openBriefingDatabase(retentionPaths);
try {
  const insert = retentionDatabase.prepare(`
    INSERT INTO editions (
      id, edition_type, local_date, timezone, state, payload_json,
      html_path, content_digest, preview_enabled, is_current,
      prepared_at, published_at, retention_until, updated_at
    ) VALUES (?, 'daily', ?, 'Europe/Vilnius', 'complete', '{}', ?, ?, 1, 0, ?, ?, ?, ?)
  `);
  const insertCard = retentionDatabase.prepare(`
    INSERT INTO briefing_run_cards (
      edition_id, attempt_id, provider, destination, provider_message_id,
      card_state, delivery_state, content_digest, provider_receipt_json,
      created_at, updated_at
    ) VALUES (?, NULL, 'discord', '1543918214835216584', ?,
              'success', 'complete', ?, '{}', ?, ?)
  `);
  for (const localDate of [
    "2026-08-23",
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
    "2026-08-30",
  ]) {
    const timestamp = `${localDate}T06:00:00.000Z`;
    insert.run(
      `daily:${localDate}`,
      localDate,
      `pages/preview/daily-${localDate}.html`,
      `digest-${localDate}`,
      timestamp,
      timestamp,
      "2099-01-01T00:00:00.000Z",
      timestamp,
    );
    insertCard.run(
      `daily:${localDate}`,
      `message-${localDate}`,
      `card-${localDate}`,
      timestamp,
      timestamp,
    );
  }
  const expiredRun = resolve(retentionPaths.runsDirectory, "run-expired");
  const outsideRun = resolve(retentionHome, "outside-runs", "run-expired");
  const retainedHtml = resolve(retentionPaths.previewDirectory, "daily-2026-08-24.html");
  await mkdir(expiredRun, { recursive: true });
  await mkdir(outsideRun, { recursive: true });
  await mkdir(resolve(retentionPaths.mediaDirectory, "daily", "2026-08-23"), { recursive: true });
  await mkdir(resolve(retentionPaths.recoveryDirectory, "daily-2026-08-23-legacy"), { recursive: true });
  await mkdir(resolve(retentionPaths.recoveryDirectory, "daily-2026-08-24-keep"), { recursive: true });
  await writeFile(resolve(retentionPaths.previewDirectory, "daily-2026-08-23.html"), "expired page");
  await writeFile(retainedHtml, "retained page");
  await writeFile(resolve(expiredRun, "probe"), "expired run");
  await writeFile(resolve(outsideRun, "probe"), "outside run");
  await writeFile(resolve(retentionPaths.mediaDirectory, "daily", "2026-08-23", "probe"), "expired media");
  const insertAttempt = retentionDatabase.prepare(`
    INSERT INTO briefing_run_attempts (
      attempt_id, edition_id, mode, state, run_directory, created_at, updated_at
    ) VALUES (?, 'daily:2026-08-23', 'manual', 'created', ?, ?, ?)
  `);
  const attemptTime = "2026-08-23T06:00:00.000Z";
  insertAttempt.run("retention-safe-run", expiredRun, attemptTime, attemptTime);
  insertAttempt.run("retention-outside-run", outsideRun, attemptTime, attemptTime);
  assert.deepEqual(
    retainedDailyEditions(retentionDatabase, "2026-08-31T00:00:00.000Z")
      .map((edition) => edition.local_date),
    ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"],
  );
} finally {
  retentionDatabase.close();
}
const boundedCleanup = await cleanupExpired("2026-08-31T00:00:00.000Z", retentionPaths);
assert.deepEqual(boundedCleanup.deleted, ["daily:2026-08-23"]);
await assert.rejects(readFile(resolve(retentionPaths.previewDirectory, "daily-2026-08-23.html"), "utf8"), { code: "ENOENT" });
await assert.rejects(readdir(resolve(retentionPaths.mediaDirectory, "daily", "2026-08-23")), { code: "ENOENT" });
await assert.rejects(readdir(resolve(retentionPaths.runsDirectory, "run-expired")), { code: "ENOENT" });
await assert.rejects(readdir(resolve(retentionPaths.recoveryDirectory, "daily-2026-08-23-legacy")), { code: "ENOENT" });
assert.equal(await readFile(resolve(retentionHome, "outside-runs", "run-expired", "probe"), "utf8"), "outside run");
assert.equal(await readFile(resolve(retentionPaths.previewDirectory, "daily-2026-08-24.html"), "utf8"), "retained page");
assert.deepEqual(await readdir(resolve(retentionPaths.recoveryDirectory, "daily-2026-08-24-keep")), []);
retentionDatabase = openBriefingDatabase(retentionPaths);
try {
  assert.equal(
    (retentionDatabase.prepare("SELECT COUNT(*) AS count FROM editions").get() as { count: number }).count,
    7,
  );
  assert.equal(
    (retentionDatabase.prepare("SELECT COUNT(*) AS count FROM briefing_run_cards").get() as { count: number }).count,
    7,
  );

  const legacyPayload = parseBriefingPayload({
    ...payload,
    schemaVersion: 1,
    edition: {
      ...payload.edition,
      id: "daily:2026-09-01",
      localDate: "2026-09-01",
      generatedAt: "2026-09-01T09:00:00+03:00",
      retentionUntil: "2026-09-06T09:00:00+03:00",
    },
  });
  const timestamp = "2026-09-01T06:00:00.000Z";
  retentionDatabase.prepare(`
    INSERT INTO editions (
      id, edition_type, local_date, timezone, state, payload_json,
      html_path, content_digest, preview_enabled, is_current,
      prepared_at, published_at, retention_until, updated_at
    ) VALUES (?, 'daily', ?, ?, 'prepared', ?, ?, 'legacy-digest', 1, 0, ?, NULL, ?, ?)
  `).run(
    legacyPayload.edition.id,
    legacyPayload.edition.localDate,
    legacyPayload.edition.timezone,
    JSON.stringify(legacyPayload),
    "pages/preview/daily-2026-09-01.html",
    timestamp,
    legacyPayload.edition.retentionUntil,
    timestamp,
  );
  retentionDatabase.prepare(`
    INSERT INTO source_batches (
      edition_id, source_key, source_provider, provider_source_id,
      min_item_id, max_item_id, item_ids_json, state, committed_at, error_code
    ) VALUES (?, 'telegram:test', 'telegram', '-1001234567890', '100', '110', '["100","105","110"]', 'prepared', NULL, NULL)
  `).run(legacyPayload.edition.id);
  assert.throws(
    () => finalizeEdition(
      retentionDatabase,
      legacyPayload.edition.id,
      [{ sourceKey: "telegram:test", status: "committed" }],
    ),
    /new daily production editions require schemaVersion 2/,
  );
} finally {
  retentionDatabase.close();
}
const afterCleanup = openBriefingDatabase(paths);
try {
  assert.equal(loadEdition(afterCleanup, { id: "daily:2026-08-28" }), null);
  assert.equal(topicProfile(afterCleanup).length, 2);
} finally {
  afterCleanup.close();
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    isolated: true,
    migrations: initialized.applied.length,
    preview: true,
    themeToggleRequired: true,
    storyDetailsRequired: true,
    paginationRuntime: true,
    schemaV2ExactCoverageRequired: true,
    telegramCommitPlanRequiresValidation: true,
    telegramCommitPlanRequiresMedia: true,
    mediaImportInvalidatesCommitPlanBeforeCopy: true,
    mediaStoryDirectorySwapIsAtomic: true,
    deterministicComponents: true,
    hiddenItemsCannotOverrideLayout: true,
    csp: true,
    scriptInjectionBlocked: true,
    readState: true,
    reactions: true,
    topicProfileSurvivesRetention: true,
    externalMutations: false,
    hardenedJitlessService: true,
  })}\n`,
);
