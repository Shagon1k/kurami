import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBriefingServer } from "../../src/briefing/server.ts";
import { parseBriefingPayload } from "../../src/briefing/model.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
import { importEditionMedia } from "../../src/briefing/media.ts";
import { validateTelegramBatch } from "../../src/briefing/telegram-batch.ts";
import {
  briefingPaths,
  cleanupExpired,
  finalizeEdition,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
  preparePreview,
  topicProfile,
  validateRenderedHtml,
} from "../../src/briefing/store.ts";

const root = resolve(import.meta.dirname, "../..");
const serviceUnit = await readFile(
  resolve(root, "deploy/systemd/kurami-briefing.service"),
  "utf8",
);
assert.match(serviceUnit, /MemoryDenyWriteExecute=true/);
assert.match(serviceUnit, /node --jitless .*\/dist\/briefing\/server\.js/);
assert.doesNotMatch(serviceUnit, /\/src\/briefing\/server\.ts/);
const home = await mkdtemp(resolve(tmpdir(), "kurami-briefing-runtime-"));
const paths = briefingPaths({
  KURAMI_HOME: home,
  BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
} as NodeJS.ProcessEnv);

const payload = {
  schemaVersion: 1,
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
      tone: "signal",
      rotation: "positive",
      mark: "arrow-down-right",
    },
    {
      id: "note:news",
      target: "news",
      text: "главное в одной пачке",
      role: "focus",
      tone: "ink",
      rotation: "none",
      mark: "arrow-down",
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
      summary: "Короткое проверяемое описание.",
      details: ["Расширенный проверяемый абзац с фактическими деталями новости."],
      topics: [
        { id: "ai", label: "AI" },
        { id: "technology", label: "Technology" },
      ],
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
const html = renderBriefingPage(parsedPayload);
assert.match(html, /\[hidden\]\s*\{\s*display:\s*none !important/);
assert.match(html, /class="topic-chip"/);
assert.match(html, /class="story-disclosure__body"/);
assert.match(html, /data-story-toggle/);
assert.match(html, /class="metric-strip"/);
assert.match(html, /class="briefing-overview"/);
assert.match(html, /id="calendar-heading">Сегодня/);
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
assert.match(html, /data-utility-header/);
assert.match(html, /utility-header__inner/);
assert.match(html, /data-media-dialog/);
assert.match(html, /data-read-state/);
assert.match(html, /family=Caveat/);
assert.match(html, /data-feed-pagination/);
assert.match(html, /data-page-range/);
assert.match(html, /data-page="2"/);
assert.match(html, /data-page-prev/);
assert.match(html, /data-page-next/);
assert.match(html, /data-note-id="note:hero"[^>]*>утро без суеты/);
assert.match(html, /data-note-id="note:news"[^>]*>главное в одной пачке/);
assert.doesNotMatch(html, /спокойно, всё собрано|главное — рядом/);
assert.doesNotMatch(html, /<script\b/i);

assert.throws(
  () => parseBriefingPayload({
    ...payload,
    mail: {
      ...payload.mail,
      items: [{ id: "mail-without-provider", subject: "Real mail without provider ID" }],
    },
  }),
  /requires provider and providerItemId unless demo is true/,
);

assert.throws(
  () => parseBriefingPayload({ ...payload, notes: [{ ...payload.notes[0], text: "раз два три четыре пять" }] }),
  /one to four words/,
);

const albumInput = resolve(home, "telegram-batch.json");
const albumOutput = resolve(home, "telegram-batch-normalized.json");
await writeFile(albumInput, JSON.stringify({
  items: [7915, 7907, 7912].map((messageId) => ({
    metadata: {
      hasMedia: true,
      telegramChatId: -1001033871555,
      telegramMessageId: messageId,
      telegramGroupId: 444,
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
  items: Array<{ metadata: { mediaMessageIds: number[] } }>;
};
assert.deepEqual(albumBatch.items[0]?.metadata.mediaMessageIds, [7907, 7912, 7915]);

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
const rawItems = [7915, 7907, 7912].map((messageId) => ({
  metadata: {
    hasMedia: true,
    telegramChatId: -1001033871555,
    telegramMessageId: messageId,
    telegramGroupId: 444,
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
    metadata: { ...item.metadata, mediaMessageIds: [7907, 7912, 7915] },
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
  albumGroups: telegramReport.albumGroups,
}, {
  complete: true,
  configuredChannels: 2,
  capturedUnread: 3,
  fetched: 3,
  normalized: 3,
  mediaMessages: 3,
  albumGroups: 1,
});
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

const initialized = await initializeBriefingStore(paths);
assert.equal(initialized.integrity, "ok");
assert.deepEqual(initialized.applied, ["001_initial.sql", "002_source_provider_ids.sql"]);

const prepared = await preparePreview(payload, html, paths);
assert.equal(prepared.editionId, "daily:2026-08-28");
assert.equal(prepared.previewPath, "/preview/daily/2026-08-28");
assert.equal(prepared.state, "prepared");

const inboxAsset = resolve(paths.mediaInboxDirectory, "story-1.jpg");
await mkdir(paths.mediaInboxDirectory, { recursive: true });
await writeFile(inboxAsset, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
const importedMedia = await importEditionMedia({
  editionId: "daily:2026-08-28",
  stories: [{ itemId: "story-1", assets: [{ sourcePath: inboxAsset, alt: "Тестовая иллюстрация" }] }],
}, paths);
assert.equal(importedMedia.imported, 1);
assert.equal(importedMedia.previewPath, prepared.previewPath);

const database = openBriefingDatabase(paths);
try {
  const edition = loadEdition(database, { id: "daily:2026-08-28" });
  assert(edition);
  assert.equal(edition.state, "prepared");
  assert.equal(edition.is_current, 0);
  const itemCounts = database
    .prepare("SELECT item_type, COUNT(*) AS count FROM edition_items GROUP BY item_type ORDER BY item_type")
    .all()
    .map((item) => ({ ...item }));
  assert.deepEqual(itemCounts, [
    { item_type: "mail", count: 5 },
    { item_type: "story", count: 11 },
  ]);
  const storedPayload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  assert.equal(storedPayload.news.items[0]?.media?.[0]?.src, "/media/daily/2026-08-28/story-1/01.jpg");
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
  });

  const preview = await fetch(`${base}${prepared.previewPath}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  const previewHtml = await preview.text();
  assert.match(previewHtml, /\/assets\/briefing\.js/);
  assert.match(previewHtml, /class="story-cover"/);
  assert.match(previewHtml, /class="story-media"/);
  assert.match(previewHtml, /\.news-story \{[^}]*grid-template-columns: 36px 176px minmax\(0, 1fr\) auto/);
  assert.match(previewHtml, /\.story-media__grid \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);

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
      { topicId: "technology", label: "Technology", likes: 1, dislikes: 0 },
    ],
  });
} finally {
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
}

const persisted = openBriefingDatabase(paths);
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
    { topicId: "technology", label: "Technology", likes: 1, dislikes: 0 },
  ]);
  const finalized = finalizeEdition(persisted, "daily:2026-08-28", [
    { sourceKey: "telegram:test", status: "committed" },
  ]);
  assert.deepEqual(finalized, {
    editionId: "daily:2026-08-28",
    state: "complete",
    publicationPath: "/daily/2026-08-28",
  });
  assert.equal(loadEdition(persisted, { type: "daily", current: true })?.id, "daily:2026-08-28");
} finally {
  persisted.close();
}

const cleanup = await cleanupExpired("2030-01-01T00:00:00.000Z", paths);
assert.deepEqual(cleanup.deleted, ["daily:2026-08-28"]);
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
