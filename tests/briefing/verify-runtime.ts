import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createBriefingServer } from "../../src/briefing/server.ts";
import { parseBriefingPayload } from "../../src/briefing/model.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
import {
  briefingPaths,
  cleanupExpired,
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
  calendar: { state: "ready", events: [] },
  mail: {
    state: "ready",
    items: [{ id: "mail-1", subject: "Проверка" }],
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
};

const parsedPayload = parseBriefingPayload(payload);
const html = renderBriefingPage(parsedPayload);
assert.match(html, /\[hidden\]\s*\{\s*display:\s*none !important/);
assert.match(html, /class="topic-chip"/);
assert.match(html, /class="story-disclosure__body"/);
assert.match(html, /data-story-toggle/);
assert.match(html, /class="metric-strip"/);
assert.match(html, /data-utility-header/);
assert.match(html, /data-read-state/);
assert.match(html, /family=Caveat/);
assert.match(html, /data-feed-pagination/);
assert.match(html, /data-page-range/);
assert.match(html, /data-page="2"/);
assert.match(html, /data-page-prev/);
assert.match(html, /data-page-next/);
assert.doesNotMatch(html, /<script\b/i);

const initialized = await initializeBriefingStore(paths);
assert.equal(initialized.integrity, "ok");
assert.deepEqual(initialized.applied, ["001_initial.sql"]);

const prepared = await preparePreview(payload, html, paths);
assert.equal(prepared.editionId, "daily:2026-08-28");
assert.equal(prepared.previewPath, "/preview/daily/2026-08-28");
assert.equal(prepared.state, "prepared");

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
    { item_type: "mail", count: 1 },
    { item_type: "story", count: 11 },
  ]);
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

const server = await createBriefingServer(paths);
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
    externalMutations: false,
  });

  const preview = await fetch(`${base}${prepared.previewPath}`);
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get("content-security-policy") ?? "", /default-src 'self'/);
  assert.match(await preview.text(), /\/assets\/briefing\.js/);

  const script = await fetch(`${base}/assets/briefing.js`);
  assert.equal(script.status, 200);
  const clientScript = await script.text();
  assert.match(clientScript, /\/api\/items\/read|data-reaction/);
  assert.match(clientScript, /data-page-next|URLSearchParams|data-story-details|is-scrolled/);

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
