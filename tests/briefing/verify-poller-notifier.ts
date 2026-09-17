import { section } from "../../src/briefing/addons/envelopes.ts";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runDigestCentralPoller } from "../../src/briefing/poller.ts";
import { notifyBriefingRelease, syncBriefingRunCard } from "../../src/briefing/release-notifier.ts";
import { recordBriefingRunStage } from "../../src/briefing/run-attempt.ts";
import { startBriefingAttempt } from "../../src/briefing/run-attempt.ts";
import { guardBriefingRun } from "../../src/briefing/run-guard.ts";
import {
  loadBriefingRuntimeConfig,
  loadTelegramCaptureConfig,
} from "../../src/briefing/runtime-config.ts";
import { parseBriefingPayload } from "./payload-fixtures.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
import {
  briefingPaths,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
} from "../../src/briefing/store.ts";

const root = resolve(import.meta.dirname, "../..");
const home = await mkdtemp(resolve(tmpdir(), "kurami-briefing-poller-notifier-"));
const configPath = resolve(home, "briefing.yaml");
const environment = {
  KURAMI_HOME: home,
  BRIEFING_CONFIG_PATH: configPath,
  BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
  BRIEFING_PUBLIC_BASE_URL: "https://digest.shagon1k.win/",
  DISCORD_BOT_TOKEN: "test-notifier-token",
} as NodeJS.ProcessEnv;
const paths = briefingPaths(environment);

const validConfig = `
edition:
  timezone: Europe/Vilnius
  daily_retention_days: 5
notification:
  destination: "1543918214835216584"
safety:
  production_mutations_enabled: true
  initial_channel_cleanup_confirmed: true
  require_bounded_telegram_commit: true
sources:
  news:
    profile: telegram-user
    enabled: true
    settings:
      page_size: 100
      discovery_limit: 200
    channels:
      - key: test-news
        id: -1001234567890
        label: Test News
        enabled: true
      - key: ignored-news
        id: -1001234567891
        label: Disabled News
        enabled: false
  mail:
    settings:
      query: "in:inbox is:unread category:primary"
      page_size: 75
  calendar:
    settings:
      calendars:
        - key: personal
          id: primary
          label: Aliaksei Hurynovich
          role: personal
          enabled: true
        - key: family
          id: family-calendar
          label: G-Fam
          role: family
          enabled: true
        - key: ignored
          id: ignored-calendar
          label: Disabled
          role: test
          enabled: false
  weather:
    settings:
      location: Vilnius, Lithuania
      latitude: 54.6872
      longitude: 25.2797
`;

async function verifyRuntimeConfig(): Promise<void> {
  await writeFile(configPath, validConfig);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  assert.equal(config.configPath, configPath);
  assert.equal(config.timeZone, "Europe/Vilnius");
  assert.equal(config.retentionDays, 5);
  assert.equal(config.gmailQuery, "in:inbox is:unread category:primary");
  assert.equal(config.gmailPageSize, 75);
  assert.deepEqual(config.safety, {
    productionMutationsEnabled: true,
    initialChannelCleanupConfirmed: true,
    requireBoundedTelegramCommit: true,
  });
  assert.deepEqual(config.calendars, [
    { key: "personal", id: "primary", label: "Aliaksei Hurynovich", role: "personal" },
    { key: "family", id: "family-calendar", label: "G-Fam", role: "family" },
  ]);
  assert.deepEqual(config.weatherLocation, {
    name: "Vilnius, Lithuania",
    latitude: 54.6872,
    longitude: 25.2797,
    timeZone: "Europe/Vilnius",
  });
  assert.equal(config.discordChannelId, "1543918214835216584");
  const telegram = await loadTelegramCaptureConfig(paths, environment);
  assert.deepEqual(telegram, {
    configPath,
    profile: "telegram-user",
    pageSize: 100,
    discoveryLimit: 200,
    channels: [{ key: "test-news", id: -1001234567890, label: "Test News" }],
  });

  await writeFile(configPath, validConfig.replace("daily_retention_days: 5", "daily_retention_days: 15"));
  await assert.rejects(
    loadBriefingRuntimeConfig(paths, environment),
    /daily retention must equal 5 days/,
  );

  await writeFile(configPath, validConfig.replace("timezone: Europe/Vilnius", "timezone: Invalid/Zone"));
  await assert.rejects(
    loadBriefingRuntimeConfig(paths, environment),
    /edition\.timezone is invalid/,
  );

  await writeFile(configPath, validConfig.replace(
    "- key: family",
    "- key: personal",
  ));
  await assert.rejects(
    loadBriefingRuntimeConfig(paths, environment),
    /enabled calendar keys must be unique/,
  );

  await writeFile(configPath, validConfig.replace(
    'destination: "1543918214835216584"',
    'destination: "general"',
  ));
  await assert.rejects(
    loadBriefingRuntimeConfig(paths, environment),
    /Discord destination must be a channel ID/,
  );

  await writeFile(configPath, validConfig.replace("page_size: 75", "page_size: 101"));
  await assert.rejects(
    loadBriefingRuntimeConfig(paths, environment),
    /mail page size must be between 1 and 100/,
  );

  await writeFile(configPath, validConfig);
}

async function verifyEmptyPollerIsLocalAndDeterministic(): Promise<void> {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  const deniedFetch: typeof fetch = async () => {
    networkCalls += 1;
    throw new Error("Empty poller must not contact providers");
  };
  globalThis.fetch = deniedFetch;
  try {
    const result = await runDigestCentralPoller(environment);
    assert.deepEqual(result.editions, []);
    assert.deepEqual(result.providers, {
      gmail: "empty",
      calendar: "empty",
      weather: "empty",
    });
    assert.deepEqual(result.deleted, []);
    assert.match(result.refreshedAt, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(networkCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function verifyRetainedPollerFailSoft(
  name: string,
  composioEnvironment: NodeJS.ProcessEnv,
): Promise<void> {
  const caseHome = await mkdtemp(resolve(tmpdir(), `kurami-briefing-poller-${name}-`));
  const caseConfigPath = resolve(caseHome, "briefing.yaml");
  await writeFile(caseConfigPath, validConfig);
  const caseEnvironment = {
    KURAMI_HOME: caseHome,
    BRIEFING_CONFIG_PATH: caseConfigPath,
    BRIEFING_MIGRATIONS_DIR: resolve(root, "migrations/briefing"),
    ...composioEnvironment,
  } as NodeJS.ProcessEnv;
  const casePaths = briefingPaths(caseEnvironment);
  await initializeBriefingStore(casePaths);
  const original = parseBriefingPayload({
    schemaVersion: 1,
    edition: {
      id: "daily:2026-08-31",
      type: "daily",
      localDate: "2026-08-31",
      timezone: "Europe/Vilnius",
      generatedAt: "2026-08-31T09:00:00+03:00",
      status: "complete",
      retentionUntil: "2099-09-05T09:00:00.000Z",
    },
    hero: { title: "Доброе утро, Alex." },
    live: {
      refreshedAt: "2026-08-31T09:00:00.000Z",
      lastSuccessAt: "2026-08-31T09:00:00.000Z",
      state: "ready",
    },
    weather: {
      state: "ready",
      provider: "open-meteo",
      location: "Vilnius, Lithuania",
      temperatureC: 12,
      condition: "☁️ Пасмурно",
      summary: "до 14°",
    },
    calendar: {
      state: "ready",
      events: [{
        id: "calendar-existing",
        title: "Сохранённая встреча",
        start: "2026-08-31T10:00:00.000Z",
        end: "2026-08-31T10:30:00.000Z",
      }],
    },
    mail: {
      state: "ready",
      count: 1,
      items: [{
        id: "mail-existing",
        provider: "gmail",
        providerItemId: "gmail-existing",
        class: "IMPORTANT",
        subject: "Сохранённое письмо",
        sender: "Kurami",
        summary: "Письмо должно остаться при недоступном Composio.",
      }],
    },
    news: {
      state: "ready",
      pageSize: 10,
      mainStoryIds: ["story-frozen"],
      items: [{
        id: "story-frozen",
        fingerprint: "fp-story-frozen",
        headline: "Замороженный утренний сюжет",
        summary: "Poller не должен менять новости.",
        details: ["Новостной срез остаётся идентичным утренней публикации."],
        topics: [
          { id: "technology", label: "Technology" },
          { id: "media", label: "Media" },
        ],
      }],
    },
    dataQuality: { state: "ready" },
    addons: {
      calendar: { version: 1, state: "ready", capturedAt: "2026-08-31T09:00:00.000Z", data: {} },
      mail: { version: 1, state: "ready", capturedAt: "2026-08-31T09:00:00.000Z", data: {} },
      news: { version: 1, state: "ready", capturedAt: "2026-08-31T09:00:00.000Z", data: {} },
      weather: { version: 1, state: "ready", capturedAt: "2026-08-31T09:00:00.000Z", data: {} },
    },
  });
  const initialHtml = renderBriefingPage(original);
  const retainedHtmlPath = "pages/preview/daily-2026-08-31.html";
  const expiredHtmlPath = "pages/preview/daily-2026-08-20.html";
  await writeFile(resolve(casePaths.stateDirectory, retainedHtmlPath), initialHtml);
  await writeFile(resolve(casePaths.stateDirectory, expiredHtmlPath), initialHtml);
  const database = openBriefingDatabase(casePaths);
  try {
    const insert = database.prepare(`
      INSERT INTO editions (
        id, edition_type, local_date, timezone, state,
        payload_json, html_path, content_digest, preview_enabled,
        is_current, prepared_at, published_at, retention_until, updated_at
      ) VALUES (?, 'daily', ?, 'Europe/Vilnius', 'complete', ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `);
    insert.run(
      original.edition.id,
      original.edition.localDate,
      JSON.stringify(original),
      retainedHtmlPath,
      "retained-content-digest",
      1,
      "2026-08-31T09:00:00.000Z",
      "2026-08-31T09:00:00.000Z",
      original.edition.retentionUntil,
      "2026-08-31T09:00:00.000Z",
    );
    insert.run(
      "daily:2026-08-20",
      "2026-08-20",
      "{}",
      expiredHtmlPath,
      "expired-content-digest",
      0,
      "2026-08-20T09:00:00.000Z",
      "2026-08-20T09:00:00.000Z",
      "2026-08-21T09:00:00.000Z",
      "2026-08-20T09:00:00.000Z",
    );
  } finally {
    database.close();
  }

  let weatherCalls = 0;
  const weatherFetch: typeof fetch = async (input) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(target.hostname, "api.open-meteo.com");
    weatherCalls += 1;
    return new Response(JSON.stringify({
      latitude: 54.6872,
      longitude: 25.2797,
      timezone: "Europe/Vilnius",
      current: {
        time: "2026-08-31T12:00",
        temperature_2m: 18.4,
        apparent_temperature: 18,
        relative_humidity_2m: 61,
        precipitation: 0,
        weather_code: 1,
        wind_speed_10m: 8,
      },
      daily: {
        time: ["2026-08-31"],
        weather_code: [1],
        temperature_2m_max: [21],
        temperature_2m_min: [11],
        precipitation_probability_max: [10],
        sunrise: ["2026-08-31T06:18"],
        sunset: ["2026-08-31T20:14"],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await runDigestCentralPoller(caseEnvironment, { weatherFetch });
    assert.deepEqual(result.providers, {
      gmail: "failed",
      calendar: "failed",
      weather: "ready",
    });
    assert.deepEqual(result.editions, [{ id: original.edition.id, state: "updated" }]);
    assert.deepEqual(result.deleted, ["daily:2026-08-20"]);
    assert.equal(weatherCalls, 1);

    const persisted = openBriefingDatabase(casePaths);
    try {
      const retained = loadEdition(persisted, { id: original.edition.id });
      assert(retained);
      const refreshed = parseBriefingPayload(JSON.parse(retained.payload_json) as unknown);
      assert.deepEqual(section(refreshed, "news"), section(original, "news"));
      assert.equal(section(refreshed, "mail").state, "stale");
      assert.equal(section(refreshed, "mail").staleAt, result.refreshedAt);
      assert.deepEqual(section(refreshed, "mail").items, section(original, "mail").items);
      assert.equal(section(refreshed, "calendar").state, "stale");
      assert.equal(section(refreshed, "calendar").staleAt, result.refreshedAt);
      assert.deepEqual(section(refreshed, "calendar").events, section(original, "calendar").events);
      assert.equal(section(refreshed, "weather")?.state, "ready");
      assert.equal(section(refreshed, "weather")?.provider, "open-meteo");
      assert.equal(section(refreshed, "weather")?.temperatureC, 18.4);
      assert.equal(refreshed.dataQuality.state, "partial");
      assert.match(String(refreshed.dataQuality.summary), /почта, расписание/u);
      assert.doesNotMatch(String(refreshed.dataQuality.summary), /погода/u);
      assert.equal(refreshed.live?.state, "partial");
      assert.equal(refreshed.live?.lastSuccessAt, original.live?.lastSuccessAt);
      assert.equal(refreshed.addons?.mail?.state, "stale");
      assert.equal(refreshed.addons?.mail?.capturedAt, result.refreshedAt);
      assert.equal(refreshed.addons?.calendar?.state, "stale");
      assert.equal(refreshed.addons?.weather?.state, "ready");
      assert.equal(refreshed.addons?.news?.capturedAt, original.addons?.news?.capturedAt);
      assert.deepEqual(refreshed.addons?.news?.data, original.addons?.news?.data);
      assert.equal(loadEdition(persisted, { id: "daily:2026-08-20" }), null);
    } finally {
      persisted.close();
    }
  } finally {
    // The injected provider transport is scoped to this poll only.
  }
}

async function seedPublishedEdition(): Promise<string> {
  await initializeBriefingStore(paths);
  const payload = parseBriefingPayload({
    schemaVersion: 1,
    edition: {
      id: "daily:2026-08-31",
      type: "daily",
      localDate: "2026-08-31",
      timezone: "Europe/Vilnius",
      generatedAt: "2026-08-31T09:00:00+03:00",
      status: "complete",
      retentionUntil: "2026-09-05T09:00:00.000Z",
    },
    hero: { title: "Доброе утро, Alex." },
    calendar: { state: "empty", events: [] },
    mail: { state: "empty", items: [] },
    news: {
      state: "ready",
      pageSize: 10,
      mainStoryIds: ["story-notifier"],
      items: [{
        id: "story-notifier",
        fingerprint: "fp-story-notifier",
        headline: "Карточка выпуска готова к проверке",
        summary: "Один Discord-пост сопровождает выпуск от старта до публикации.",
        details: ["Повторный запуск редактирует то же сообщение и не создаёт дубликат."],
        topics: [
          { id: "technology", label: "Technology" },
          { id: "media", label: "Media" },
        ],
      }],
    },
    dataQuality: { state: "ready" },
    addons: {
      cinema: { version: 1, state: "ready", capturedAt: "2026-08-31T06:00:00.000Z", data: {} },
      news: { version: 1, state: "ready", capturedAt: "2026-08-31T06:00:00.000Z", data: {} },
    },
  });
  const database = openBriefingDatabase(paths);
  try {
    const timestamp = "2026-08-31T09:00:00.000Z";
    database.prepare(`
      INSERT INTO editions (
        id, edition_type, local_date, timezone, state,
        payload_json, html_path, content_digest, preview_enabled,
        is_current, prepared_at, published_at, retention_until, updated_at
      ) VALUES (?, 'daily', ?, ?, 'complete', ?, ?, ?, 1, 1, ?, ?, ?, ?)
    `).run(
      "daily:2026-08-31",
      "2026-08-31",
      "Europe/Vilnius",
      JSON.stringify(payload),
      "pages/preview/daily-2026-08-31.html",
      "test-content-digest",
      timestamp,
      timestamp,
      "2026-09-05T09:00:00.000Z",
      timestamp,
    );
    database.prepare(`
      INSERT INTO briefing_run_attempts (
        attempt_id, edition_id, mode, state, run_directory,
        created_at, updated_at, completed_at
      ) VALUES (?, ?, 'scheduled', 'created', ?, ?, ?, NULL)
    `).run(
      "daily-2026-08-31--scheduled",
      "daily:2026-08-31",
      resolve(paths.runsDirectory, "daily-2026-08-31--scheduled"),
      timestamp,
      timestamp,
    );
  } finally {
    database.close();
  }
  return "daily-2026-08-31--scheduled";
}

async function verifyReleaseNotifier(): Promise<void> {
  const attemptId = await seedPublishedEdition();
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const mockedFetch: typeof fetch = async (input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      init,
    });
    return new Response(JSON.stringify({ id: "188888888888888888" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const started = await syncBriefingRunCard(attemptId, environment, {
      fetchImpl: mockedFetch,
    });
    assert.equal(started.action, "created");
    assert.equal(started.cardState, "running");
    const stages = [
      "live-collected",
      "telegram-captured",
      "capture-validated",
      "editorialized",
      "prepared",
      "media-ready",
      "commit-planned",
      "telegram-committed",
      "published",
    ] as const;
    const lifecycle = openBriefingDatabase(paths);
    try {
      for (const stage of stages) recordBriefingRunStage(lifecycle, { attemptId, stage });
    } finally {
      lifecycle.close();
    }
    const first = await notifyBriefingRelease("daily:2026-08-31", environment, {
      fetchImpl: mockedFetch,
      attemptId,
    });
    assert.deepEqual(first, {
      editionId: "daily:2026-08-31",
      destination: "1543918214835216584",
      messageId: "188888888888888888",
      alreadyComplete: false,
      publicationUrl: "https://digest.shagon1k.win/daily/2026-08-31",
    });
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.url,
      "https://discord.com/api/v10/channels/1543918214835216584/messages",
    );
    assert.equal(requests[0]?.init?.method, "POST");
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get("authorization"), "Bot test-notifier-token");
    const startedBody = JSON.parse(String(requests[0]?.init?.body)) as {
      content: string;
      embeds: Array<{ title: string; description: string }>;
      components: unknown[];
      nonce: string;
      enforce_nonce: boolean;
    };
    assert.equal(startedBody.content, "");
    assert.equal(startedBody.embeds[0]?.title, "Daily Digest · 31 августа");
    assert.match(startedBody.embeds[0]?.description ?? "", /Подключаю источники/u);
    assert.deepEqual(startedBody.components, []);
    assert.match(startedBody.nonce, /^\d{1,20}$/u);
    assert.equal(startedBody.enforce_nonce, true);
    assert.equal(
      requests[1]?.url,
      "https://discord.com/api/v10/channels/1543918214835216584/messages/188888888888888888",
    );
    assert.equal(requests[1]?.init?.method, "PATCH");
    const completedBody = JSON.parse(String(requests[1]?.init?.body)) as {
      embeds: Array<{ description: string; fields: Array<{ name: string; value: string }> }>;
      components: Array<{ components: Array<{ label: string; url: string }> }>;
    };
    assert.match(completedBody.embeds[0]?.description ?? "", /Выпуск опубликован/u);
    assert.deepEqual(completedBody.embeds[0]?.fields.slice(0, 3), [
      { name: "Новости", value: "1 сюжет", inline: true },
      { name: "Почта", value: "0 писем", inline: true },
      { name: "Расписание", value: "0 событий", inline: true },
    ]);
    assert.deepEqual(completedBody.components[0]?.components, [
      { type: 2, style: 5, label: "Открыть выпуск", url: "https://digest.shagon1k.win/daily/2026-08-31" },
      { type: 2, style: 5, label: "🎬 Cinema", url: "https://digest.shagon1k.win/cinema" },
    ]);
    assert.doesNotMatch(JSON.stringify(completedBody), /Cronjob Response|To stop|manage this job|job_id/iu);

    const second = await notifyBriefingRelease("daily:2026-08-31", environment, {
      fetchImpl: mockedFetch,
      attemptId,
    });
    assert.equal(second.alreadyComplete, true);
    assert.equal(second.messageId, first.messageId);
    assert.equal(second.publicationUrl, first.publicationUrl);
    assert.equal(requests.length, 2, "completed release must not create or edit Discord again");

    const database = openBriefingDatabase(paths);
    try {
      const receipt = database.prepare(`
        SELECT provider, destination, provider_message_id, state, provider_receipt_json
        FROM release_notification_receipts WHERE edition_id = ?
      `).get("daily:2026-08-31") as {
        provider: string;
        destination: string;
        provider_message_id: string;
        state: string;
        provider_receipt_json: string;
      };
      assert.deepEqual({
        provider: receipt.provider,
        destination: receipt.destination,
        messageId: receipt.provider_message_id,
        state: receipt.state,
      }, {
        provider: "discord",
        destination: "1543918214835216584",
        messageId: "188888888888888888",
        state: "complete",
      });
      assert.deepEqual(JSON.parse(receipt.provider_receipt_json), { id: "188888888888888888", runCard: true });
      assert.equal(receipt.provider_receipt_json.includes("test-notifier-token"), false);
      const card = database.prepare(`
        SELECT attempt_id, provider_message_id, card_state, delivery_state
        FROM briefing_run_cards WHERE edition_id = ?
      `).get("daily:2026-08-31");
      assert.deepEqual({ ...card as Record<string, unknown> }, {
        attempt_id: attemptId,
        provider_message_id: "188888888888888888",
        card_state: "success",
        delivery_state: "complete",
      });
    } finally {
      database.close();
    }
  } finally {
    // All notifier network I/O is injected and scoped to this verification.
  }
}

async function verifyFailureAndRecoveryReuseOneCard(): Promise<void> {
  const scheduled = "daily-2026-09-01--scheduled";
  const recovery = "daily-2026-09-01--recovery-abcdef1234";
  const database = openBriefingDatabase(paths);
  try {
    const insert = database.prepare(`
      INSERT INTO briefing_run_attempts (
        attempt_id, edition_id, mode, state, run_directory,
        created_at, updated_at, completed_at
      ) VALUES (?, 'daily:2026-09-01', ?, 'created', ?, ?, ?, NULL)
    `);
    insert.run(
      scheduled,
      "scheduled",
      resolve(paths.runsDirectory, scheduled),
      "2026-09-01T06:00:00.000Z",
      "2026-09-01T06:00:00.000Z",
    );
  } finally {
    database.close();
  }
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const mockedFetch: typeof fetch = async (input, init) => {
    requests.push({ url: input instanceof Request ? input.url : String(input), init });
    return new Response(JSON.stringify({ id: "199999999999999999" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  await syncBriefingRunCard(scheduled, environment, { fetchImpl: mockedFetch });
  const failed = openBriefingDatabase(paths);
  try {
    recordBriefingRunStage(failed, { attemptId: scheduled, stage: "live-collected" });
    recordBriefingRunStage(failed, {
      attemptId: scheduled,
      stage: "failed",
      errorCode: "telegram_capture_unavailable",
    });
  } finally {
    failed.close();
  }
  const failure = await syncBriefingRunCard(scheduled, environment, { fetchImpl: mockedFetch });
  assert.equal(failure.action, "updated");
  assert.equal(failure.cardState, "failure");
  const failureBody = JSON.parse(String(requests[1]?.init?.body)) as {
    embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
  };
  assert.deepEqual(failureBody.embeds[0]?.fields, [
    { name: "Последний завершённый этап", value: "Почта, расписание и погода собраны", inline: false },
    { name: "Причина", value: "telegram capture unavailable", inline: false },
  ]);

  const recoveryDatabase = openBriefingDatabase(paths);
  try {
    recoveryDatabase.prepare(`
      INSERT INTO briefing_run_attempts (
        attempt_id, edition_id, mode, state, run_directory,
        created_at, updated_at, completed_at
      ) VALUES (?, 'daily:2026-09-01', 'recovery', 'created', ?, ?, ?, NULL)
    `).run(
      recovery,
      resolve(paths.runsDirectory, recovery),
      "2026-09-01T07:00:00.000Z",
      "2026-09-01T07:00:00.000Z",
    );
  } finally {
    recoveryDatabase.close();
  }
  const resumed = await syncBriefingRunCard(recovery, environment, { fetchImpl: mockedFetch });
  assert.equal(resumed.action, "updated");
  assert.equal(resumed.cardState, "running");
  assert.equal(requests.length, 3);
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests[1]?.init?.method, "PATCH");
  assert.equal(requests[2]?.init?.method, "PATCH");
  assert.equal(requests[1]?.url, requests[2]?.url);
  const guardedRecovery = await guardBriefingRun(environment, {
    at: new Date("2026-09-01T08:30:00.000Z"),
    fetchImpl: mockedFetch,
  });
  assert.equal(guardedRecovery.attemptId, recovery);
  assert.equal(guardedRecovery.phase, "recovery");
  assert.equal(guardedRecovery.status, "failed");
}

async function verifyEarlyAgentExit(): Promise<void> {
  await initializeBriefingStore(paths);
  const hermes = resolve(home, "hermes-observer");
  await mkdir(resolve(hermes, "cron"), {recursive:true});
  await writeFile(resolve(hermes, "cron/jobs.json"), JSON.stringify([{id:"test-daily",name:"kurami-daily-briefing"}]));
  const executions = new DatabaseSync(resolve(hermes, "cron/executions.db"));
  executions.exec("CREATE TABLE executions(job_id TEXT,status TEXT,claimed_at TEXT,finished_at TEXT)");
  executions.exec("INSERT INTO executions VALUES('test-daily','running','2026-09-03T06:00:00Z',NULL)");
  const database = openBriefingDatabase(paths);
  const {attempt} = await startBriefingAttempt(database,paths,{editionId:"daily:2026-09-03",mode:"scheduled",timeZone:"Europe/Vilnius",at:new Date("2026-09-03T06:00:00Z")});
  database.close();
  const calls: string[] = [];
  const options = {at:new Date("2026-09-03T06:15:00Z"),fetchImpl:async(input:Parameters<typeof fetch>[0])=>{
    calls.push(String(input));
    return new Response(JSON.stringify({id:"188888888888888888"}),{status:200});
  }};
  const env = {...environment,HERMES_HOME:hermes};
  assert.equal((await guardBriefingRun(env,options)).status,"skipped");
  assert.equal(calls.length,0,"running model is not interrupted by an early probe");
  executions.exec("UPDATE executions SET status='completed',finished_at='2026-09-03T06:12:00Z'");
  const stopped = await guardBriefingRun(env,options);
  assert.equal(stopped.state,"failed");
  const check = openBriefingDatabase(paths);
  assert.equal(check.prepare("SELECT error_code FROM briefing_run_attempts WHERE attempt_id=?").get(attempt.attemptId)?.error_code,"agent_returned_incomplete");
  check.close(); executions.close();
}

async function verifyDeterministicCompletionGuard(): Promise<void> {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const mockedFetch: typeof fetch = async (input, init) => {
    requests.push({ url: input instanceof Request ? input.url : String(input), init });
    return new Response(JSON.stringify({ id: "177777777777777777" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const primary = await guardBriefingRun(environment, {
    at: new Date("2026-09-02T06:50:00.000Z"),
    fetchImpl: mockedFetch,
  });
  assert.deepEqual(primary, {
    editionId: "daily:2026-09-02",
    attemptId: "daily-2026-09-02--scheduled",
    phase: "primary",
    status: "incomplete",
    state: "created",
  });
  const database = openBriefingDatabase(paths);
  let attemptId = "";
  try {
    const recovery = await startBriefingAttempt(database, paths, {
      editionId: "daily:2026-09-02",
      mode: "scheduled",
      timeZone: "Europe/Vilnius",
      at: new Date("2026-09-02T07:00:00.000Z"),
    });
    assert.equal(recovery.shouldRun, true);
    assert.equal(recovery.reason, "scheduled_recovery_window");
    attemptId = recovery.attempt.attemptId;
    recordBriefingRunStage(database, { attemptId, stage: "live-collected" });
  } finally {
    database.close();
  }
  const recoveryGuard = await guardBriefingRun(environment, {
    at: new Date("2026-09-02T07:50:00.000Z"),
    fetchImpl: mockedFetch,
  });
  assert.equal(recoveryGuard.phase, "recovery");
  assert.equal(recoveryGuard.status, "failed");
  assert.equal(recoveryGuard.state, "failed");
  assert.equal(recoveryGuard.attemptId, attemptId);
  assert.equal(requests[0]?.init?.method, "POST");
  assert.equal(requests.at(-1)?.init?.method, "PATCH");
  const delayedPersistentGuard = await guardBriefingRun(environment, {
    at: new Date("2026-09-02T08:30:00.000Z"),
    fetchImpl: mockedFetch,
  });
  assert.equal(delayedPersistentGuard.phase, "recovery");
  assert.equal(delayedPersistentGuard.status, "failed");
}

await verifyRuntimeConfig();
await verifyEarlyAgentExit();
await verifyEmptyPollerIsLocalAndDeterministic();
await verifyRetainedPollerFailSoft("missing-composio", {});
await verifyRetainedPollerFailSoft("invalid-composio", {
  COMPOSIO_READ_MCP_URL: "http://composio.invalid/mcp",
  COMPOSIO_READ_API_KEY: "test-invalid-connection",
});
await verifyReleaseNotifier();
await verifyFailureAndRecoveryReuseOneCard();
await verifyDeterministicCompletionGuard();
process.stdout.write("briefing poller and release notifier verified\n");
