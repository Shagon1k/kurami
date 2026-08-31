import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runDigestCentralPoller } from "../../src/briefing/poller.ts";
import { notifyBriefingRelease } from "../../src/briefing/release-notifier.ts";
import { loadBriefingRuntimeConfig } from "../../src/briefing/runtime-config.ts";
import { parseBriefingPayload } from "../../src/briefing/model.ts";
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
sources:
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
      assert.deepEqual(refreshed.news, original.news);
      assert.equal(refreshed.mail.state, "stale");
      assert.equal(refreshed.mail.staleAt, result.refreshedAt);
      assert.deepEqual(refreshed.mail.items, original.mail.items);
      assert.equal(refreshed.calendar.state, "stale");
      assert.equal(refreshed.calendar.staleAt, result.refreshedAt);
      assert.deepEqual(refreshed.calendar.events, original.calendar.events);
      assert.equal(refreshed.weather?.state, "ready");
      assert.equal(refreshed.weather?.provider, "open-meteo");
      assert.equal(refreshed.weather?.temperatureC, 18.4);
      assert.equal(refreshed.dataQuality.state, "partial");
      assert.match(String(refreshed.dataQuality.summary), /почта, расписание/u);
      assert.doesNotMatch(String(refreshed.dataQuality.summary), /погода/u);
      assert.equal(refreshed.live?.state, "partial");
      assert.equal(refreshed.live?.lastSuccessAt, original.live?.lastSuccessAt);
      assert.equal(loadEdition(persisted, { id: "daily:2026-08-20" }), null);
    } finally {
      persisted.close();
    }
  } finally {
    // The injected provider transport is scoped to this poll only.
  }
}

async function seedPublishedEdition(): Promise<void> {
  await initializeBriefingStore(paths);
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
      "{}",
      "pages/preview/daily-2026-08-31.html",
      "test-content-digest",
      timestamp,
      timestamp,
      "2026-09-05T09:00:00.000Z",
      timestamp,
    );
  } finally {
    database.close();
  }
}

async function verifyReleaseNotifier(): Promise<void> {
  await seedPublishedEdition();
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
    const first = await notifyBriefingRelease("daily:2026-08-31", environment, {
      fetchImpl: mockedFetch,
    });
    assert.deepEqual(first, {
      editionId: "daily:2026-08-31",
      destination: "1543918214835216584",
      messageId: "188888888888888888",
      alreadyComplete: false,
      publicationUrl: "https://digest.shagon1k.win/daily/2026-08-31",
    });
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0]?.url,
      "https://discord.com/api/v10/channels/1543918214835216584/messages",
    );
    assert.equal(requests[0]?.init?.method, "POST");
    const headers = new Headers(requests[0]?.init?.headers);
    assert.equal(headers.get("authorization"), "Bot test-notifier-token");
    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      content: string;
      nonce: string;
      enforce_nonce: boolean;
    };
    assert.equal(
      body.content,
      "☀️ Брифинг за 31 августа готов — https://digest.shagon1k.win/daily/2026-08-31",
    );
    assert.equal(body.content.includes("\n"), false);
    assert.doesNotMatch(body.content, /Cronjob Response|To stop|manage this job|job_id/iu);
    assert.match(body.nonce, /^briefing-[a-f0-9]{20}$/u);
    assert.equal(body.enforce_nonce, true);

    const second = await notifyBriefingRelease("daily:2026-08-31", environment, {
      fetchImpl: mockedFetch,
    });
    assert.equal(second.alreadyComplete, true);
    assert.equal(second.messageId, first.messageId);
    assert.equal(second.publicationUrl, first.publicationUrl);
    assert.equal(requests.length, 1, "completed release must not create a second Discord POST");

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
      assert.deepEqual(JSON.parse(receipt.provider_receipt_json), { id: "188888888888888888" });
      assert.equal(receipt.provider_receipt_json.includes("test-notifier-token"), false);
    } finally {
      database.close();
    }
  } finally {
    // All notifier network I/O is injected and scoped to this verification.
  }
}

await verifyRuntimeConfig();
await verifyEmptyPollerIsLocalAndDeterministic();
await verifyRetainedPollerFailSoft("missing-composio", {});
await verifyRetainedPollerFailSoft("invalid-composio", {
  COMPOSIO_READ_MCP_URL: "http://composio.invalid/mcp",
  COMPOSIO_READ_API_KEY: "test-invalid-connection",
});
await verifyReleaseNotifier();
process.stdout.write("briefing poller and release notifier verified\n");
