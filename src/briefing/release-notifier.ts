import { section } from "./addons/envelopes.ts";
import {publicDigestUrl} from "./public-url.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseBriefingPayload, type BriefingPayload } from "./model.ts";
import {
  briefingPaths,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
} from "./store.ts";
import { loadBriefingAttempt, type BriefingRunAttempt, type BriefingRunState } from "./run-attempt.ts";
import { nodeHttpFetch } from "./providers/node-http-fetch.ts";
import type { FetchLike } from "./providers/common.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";

type JsonRecord = Record<string, unknown>;
type CardState = "running" | "success" | "failure";
type DiscordMessage = { content: string; embeds: JsonRecord[]; components: JsonRecord[] };

type NotificationResult = {
  editionId: string;
  destination: string;
  messageId: string;
  alreadyComplete: boolean;
  publicationUrl: string;
};

export type RunCardResult = {
  editionId: string;
  attemptId: string;
  destination: string;
  messageId: string | null;
  cardState: CardState;
  action: "created" | "updated" | "unchanged" | "skipped";
};

type RunCardOptions = { fetchImpl?: FetchLike; failureCode?: string };
type RunCardRow = {
  provider_message_id: string | null;
  card_state: CardState;
  delivery_state: "prepared" | "complete" | "failed";
  content_digest: string;
};

const PROGRESS: Record<BriefingRunState, { step: number; label: string }> = {
  created: { step: 1, label: "Подключаю источники" },
  "live-collected": { step: 2, label: "Почта, расписание и погода собраны" },
  "telegram-captured": { step: 3, label: "Telegram-пачка получена" },
  "capture-validated": { step: 4, label: "Проверяю и объединяю материалы" },
  editorialized: { step: 5, label: "Сюжеты подготовлены" },
  prepared: { step: 6, label: "Собираю изображения" },
  "media-ready": { step: 7, label: "Изображения готовы" },
  "commit-planned": { step: 8, label: "Завершаю Telegram-гигиену" },
  "telegram-committed": { step: 9, label: "Публикую страницу" },
  published: { step: 10, label: "Выпуск готов" },
  notified: { step: 10, label: "Выпуск готов" },
  failed: { step: 0, label: "Сборка остановлена" },
  skipped: { step: 0, label: "Запуск не потребовался" },
};

const ADDON_LINKS: Record<string, { label: string; path: string; emoji: string }> = {
  cinema: { label: "Cinema", path: "/cinema", emoji: "🎬" },
  weekly: { label: "Неделя", path: "/weekly", emoji: "📊" },
};

function parseEnvValue(text: string, key: string): string | null {
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(line);
    if (!match || match[1] !== key) continue;
    const raw = match[2]!.trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw.split(/\s+#/u, 1)[0]!.trim();
  }
  return null;
}

async function discordToken(home: string, environment: NodeJS.ProcessEnv): Promise<string> {
  const scoped = environment.DISCORD_BOT_TOKEN?.trim();
  if (scoped) return scoped;
  const envPath = environment.HERMES_ENV_PATH?.trim()
    ? resolve(environment.HERMES_ENV_PATH)
    : resolve(home, "../_core/.env");
  const token = parseEnvValue(await readFile(envPath, "utf8"), "DISCORD_BOT_TOKEN");
  if (!token) throw new Error("Discord delivery credential is unavailable");
  return token;
}

function displayDate(localDate: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(`${localDate}T12:00:00Z`));
}

function displayTime(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(timestamp));
}

function localDateFromEditionId(editionId: string): string {
  const match = /^daily:(\d{4}-\d{2}-\d{2})$/u.exec(editionId);
  if (!match) throw new Error("Run card requires a Daily edition ID");
  return match[1]!;
}

function safeErrorCode(value: string | null): string {
  if (!value) return "Запуск завершился до финальной публикации";
  const readable = value.replace(/[_-]+/gu, " ").trim().slice(0, 100);
  return readable || "Запуск завершился до финальной публикации";
}

function payloadCounts(payload: BriefingPayload | null): { stories: number; mail: number; events: number } {
  return {
    stories: section(payload, "news").items.length ?? 0,
    mail: section(payload, "mail").items.length ?? 0,
    events: Array.isArray(section(payload, "calendar").events) ? (section(payload, "calendar").events as unknown[]).length : 0,
  };
}

function russianCount(value: number, one: string, few: string, many: string): string {
  const modulo100 = Math.abs(value) % 100;
  const modulo10 = modulo100 % 10;
  const noun = modulo100 >= 11 && modulo100 <= 19
    ? many
    : modulo10 === 1
      ? one
      : modulo10 >= 2 && modulo10 <= 4
        ? few
        : many;
  return `${value} ${noun}`;
}

function addonButtons(payload: BriefingPayload | null, baseUrl: string): JsonRecord[] {
  return Object.keys(payload?.addons ?? {}).sort().flatMap((addonId) => {
    if(addonId==="weekly"&&!payload?.addons.weekly?.data.review)return [];
    const addon = ADDON_LINKS[addonId];
    return addon ? [{
      type: 2,
      style: 5,
      label: `${addon.emoji} ${addon.label}`,
      url: publicDigestUrl(addon.path,"ru",{BRIEFING_PUBLIC_BASE_URL:baseUrl}),
    }] : [];
  });
}

function runCardMessage(input: {
  attempt: BriefingRunAttempt;
  payload: BriefingPayload | null;
  timeZone: string;
  baseUrl: string;
  lastCompletedStage?: BriefingRunState;
}): { body: DiscordMessage; state: CardState; publicationUrl: string } {
  const { attempt, payload, timeZone, baseUrl, lastCompletedStage } = input;
  const localDate = localDateFromEditionId(attempt.editionId);
  const publicationUrl = publicDigestUrl(`/daily/${localDate}`,"ru",{BRIEFING_PUBLIC_BASE_URL:baseUrl});
  const progress = PROGRESS[attempt.state];
  const success = attempt.state === "published" || attempt.state === "notified";
  const failure = attempt.state === "failed";
  const state: CardState = success ? "success" : failure ? "failure" : "running";
  const counts = payloadCounts(payload);
  const fields: JsonRecord[] = success
    ? [
        { name: "Новости", value: russianCount(counts.stories, "сюжет", "сюжета", "сюжетов"), inline: true },
        { name: "Почта", value: russianCount(counts.mail, "письмо", "письма", "писем"), inline: true },
        { name: "Расписание", value: russianCount(counts.events, "событие", "события", "событий"), inline: true },
      ]
    : failure
      ? [
          {
            name: "Последний завершённый этап",
            value: lastCompletedStage ? PROGRESS[lastCompletedStage].label : "Запуск только начался",
            inline: false,
          },
          { name: "Причина", value: safeErrorCode(attempt.errorCode), inline: false },
        ]
      : [{ name: "Прогресс", value: `${progress.step} / 10`, inline: true }];
  const addonNames = Object.keys(payload?.addons ?? {}).sort()
    .filter(id=>id!=="weekly"||Boolean(payload?.addons.weekly?.data.review))
    .flatMap((id) => ADDON_LINKS[id] ? [`${ADDON_LINKS[id]!.emoji} ${ADDON_LINKS[id]!.label}`] : []);
  if (success && addonNames.length) {
    fields.push({ name: "Дополнения", value: addonNames.join(" · "), inline: false });
  }
  const description = success
    ? attempt.recoveryStartedAt
      ? "✅ Выпуск восстановлен автоматически"
      : "✅ Выпуск опубликован"
    : failure
      ? "❌ Выпуск не опубликован. Карточка обновится при восстановлении."
      : `⏳ ${progress.label}`;
  const components = success
    ? [{
        type: 1,
        components: [
          { type: 2, style: 5, label: "Открыть выпуск", url: publicationUrl },
          ...addonButtons(payload, baseUrl),
        ].slice(0, 5),
      }]
    : [];
  return {
    state,
    publicationUrl,
    body: {
      content: "",
      embeds: [{
        title: `Daily Digest · ${displayDate(localDate, timeZone)}`,
        description,
        color: success ? 0x2f855a : failure ? 0xe11d1d : 0xd97706,
        fields,
        footer: { text: `Обновлено ${displayTime(attempt.updatedAt, timeZone)} · Europe/Vilnius` },
      }],
      components,
    },
  };
}

async function discordRequest(
  token: string,
  url: string,
  method: "POST" | "PATCH",
  body: DiscordMessage & { nonce?: string; enforce_nonce?: boolean },
  fetchImpl: FetchLike,
): Promise<JsonRecord> {
  let lastError = "Discord delivery failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status === 429) {
        const value = await response.json().catch(() => ({})) as { retry_after?: number };
        await new Promise((resolveDelay) => setTimeout(
          resolveDelay,
          Math.min(5_000, Math.max(200, Number(value.retry_after ?? 1) * 1_000)),
        ));
        continue;
      }
      if (response.status >= 500 && attempt < 3) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 300));
        continue;
      }
      if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}`);
      const value = await response.json() as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("Discord returned an invalid receipt");
      }
      const receipt = value as JsonRecord;
      if (typeof receipt.id !== "string" || !/^\d{10,20}$/u.test(receipt.id)) {
        throw new Error("Discord receipt has no message ID");
      }
      return receipt;
    } catch (error) {
      lastError = error instanceof Error && error.name === "AbortError"
        ? "Discord delivery timed out"
        : error instanceof Error ? error.message : "Discord delivery failed";
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 300));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(lastError);
}

function nonceFor(editionId: string): string {
  return BigInt(`0x${createHash("sha256").update(`run-card:${editionId}`).digest("hex").slice(0, 16)}`)
    .toString(10);
}

export async function syncBriefingRunCard(
  attemptId: string,
  environment: NodeJS.ProcessEnv = process.env,
  options: RunCardOptions = {},
): Promise<RunCardResult> {
  const paths = briefingPaths(environment);
  await initializeBriefingStore(paths);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  const baseUrl = publicDigestUrl("/","ru",environment).replace(/\/$/u, "");
  const database = openBriefingDatabase(paths);
  let attempt: BriefingRunAttempt;
  let payload: BriefingPayload | null = null;
  let existing: RunCardRow | undefined;
  let lastCompletedStage: BriefingRunState | undefined;
  try {
    const loaded = loadBriefingAttempt(database, attemptId);
    if (!loaded) throw new Error(`Unknown briefing attempt ${attemptId}`);
    attempt = options.failureCode
      ? { ...loaded, state: "failed", errorCode: options.failureCode }
      : loaded;
    if (attempt.mode === "dry-run") {
      return {
        editionId: attempt.editionId,
        attemptId,
        destination: config.discordChannelId,
        messageId: null,
        cardState: "running",
        action: "skipped",
      };
    }
    const edition = loadEdition(database, { id: attempt.editionId });
    if (edition) payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
    existing = database.prepare(`
      SELECT provider_message_id, card_state, delivery_state, content_digest
      FROM briefing_run_cards WHERE edition_id = ?
    `).get(attempt.editionId) as RunCardRow | undefined;
    if (!existing) {
      const legacy = database.prepare(`
        SELECT provider_message_id, state
        FROM release_notification_receipts WHERE edition_id = ?
      `).get(attempt.editionId) as { provider_message_id: string | null; state: string } | undefined;
      if (legacy?.provider_message_id) {
        existing = {
          provider_message_id: legacy.provider_message_id,
          card_state: legacy.state === "complete" ? "success" : "running",
          delivery_state: "complete",
          content_digest: "legacy-release-message",
        };
      }
    }
    if (attempt.state === "failed") {
      const completed = database.prepare(`
        SELECT stage FROM briefing_run_stage_receipts
        WHERE attempt_id = ? AND state = 'complete'
      `).all(attemptId) as Array<{ stage: BriefingRunState }>;
      lastCompletedStage = completed
        .map((receipt) => receipt.stage)
        .filter((stage) => PROGRESS[stage] && PROGRESS[stage].step > 0)
        .sort((left, right) => PROGRESS[right].step - PROGRESS[left].step)[0];
    }
  } finally {
    database.close();
  }

  const rendered = runCardMessage({
    attempt,
    payload,
    timeZone: config.timeZone,
    baseUrl,
    ...(lastCompletedStage ? { lastCompletedStage } : {}),
  });
  const contentDigest = createHash("sha256").update(JSON.stringify(rendered.body)).digest("hex");
  if (existing?.delivery_state === "complete" && existing.content_digest === contentDigest) {
    return {
      editionId: attempt.editionId,
      attemptId,
      destination: config.discordChannelId,
      messageId: existing.provider_message_id,
      cardState: rendered.state,
      action: "unchanged",
    };
  }

  const timestamp = new Date().toISOString();
  const prepared = openBriefingDatabase(paths);
  try {
    prepared.prepare(`
      INSERT INTO briefing_run_cards (
        edition_id, attempt_id, provider, destination, provider_message_id,
        card_state, delivery_state, content_digest, provider_receipt_json,
        created_at, updated_at
      ) VALUES (?, ?, 'discord', ?, ?, ?, 'prepared', ?, NULL, ?, ?)
      ON CONFLICT(edition_id) DO UPDATE SET
        attempt_id = excluded.attempt_id,
        provider = 'discord', destination = excluded.destination,
        card_state = excluded.card_state, delivery_state = 'prepared',
        content_digest = excluded.content_digest, provider_receipt_json = NULL,
        updated_at = excluded.updated_at
    `).run(
      attempt.editionId,
      attemptId,
      config.discordChannelId,
      existing?.provider_message_id ?? null,
      rendered.state,
      contentDigest,
      timestamp,
      timestamp,
    );
  } finally {
    prepared.close();
  }

  const token = await discordToken(paths.home, environment);
  const fetchImpl = options.fetchImpl ?? nodeHttpFetch;
  const messageId = existing?.provider_message_id;
  const url = messageId
    ? `https://discord.com/api/v10/channels/${config.discordChannelId}/messages/${messageId}`
    : `https://discord.com/api/v10/channels/${config.discordChannelId}/messages`;
  const body = messageId
    ? rendered.body
    : { ...rendered.body, nonce: nonceFor(attempt.editionId), enforce_nonce: true };
  try {
    const receipt = await discordRequest(token, url, messageId ? "PATCH" : "POST", body, fetchImpl);
    const deliveredId = receipt.id as string;
    const completed = openBriefingDatabase(paths);
    try {
      completed.prepare(`
        UPDATE briefing_run_cards
        SET provider_message_id = ?, delivery_state = 'complete',
            provider_receipt_json = ?, updated_at = ?
        WHERE edition_id = ?
      `).run(deliveredId, JSON.stringify({ id: deliveredId }), new Date().toISOString(), attempt.editionId);
    } finally {
      completed.close();
    }
    return {
      editionId: attempt.editionId,
      attemptId,
      destination: config.discordChannelId,
      messageId: deliveredId,
      cardState: rendered.state,
      action: messageId ? "updated" : "created",
    };
  } catch (error) {
    const failed = openBriefingDatabase(paths);
    try {
      failed.prepare(`
        UPDATE briefing_run_cards
        SET delivery_state = 'failed', provider_receipt_json = ?, updated_at = ?
        WHERE edition_id = ?
      `).run(
        JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 180) : "delivery_failed" }),
        new Date().toISOString(),
        attempt.editionId,
      );
    } finally {
      failed.close();
    }
    throw error;
  }
}

export async function syncBriefingRunCardFailSoft(
  attemptId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  await syncBriefingRunCard(attemptId, environment).catch(() => undefined);
}

export async function syncBriefingRunFailureCardFailSoft(
  attemptId: string,
  command: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const failureCode = `${command.replace(/[^a-z0-9]+/gu, "_").replace(/^_+|_+$/gu, "") || "runtime"}_failed`
    .slice(0, 80);
  await syncBriefingRunCard(attemptId, environment, { failureCode }).catch(() => undefined);
}

export async function notifyBriefingRelease(
  editionId: string,
  environment: NodeJS.ProcessEnv = process.env,
  options: RunCardOptions & { attemptId?: string } = {},
): Promise<NotificationResult> {
  const paths = briefingPaths(environment);
  await initializeBriefingStore(paths);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  const database = openBriefingDatabase(paths);
  let attemptId = options.attemptId;
  let localDate = "";
  let existingRelease: { provider_message_id: string | null; state: string } | undefined;
  try {
    const edition = loadEdition(database, { id: editionId });
    if (!edition || (edition.state !== "complete" && edition.state !== "partial")) {
      throw new Error("Only a published briefing edition can be announced");
    }
    localDate = edition.local_date;
    if (!attemptId) {
      attemptId = (database.prepare(`
        SELECT attempt_id FROM briefing_run_attempts
        WHERE edition_id = ? ORDER BY updated_at DESC LIMIT 1
      `).get(editionId) as { attempt_id: string } | undefined)?.attempt_id;
    }
    if (!attemptId) throw new Error("Published briefing has no run attempt");
    existingRelease = database.prepare(`
      SELECT provider_message_id, state FROM release_notification_receipts WHERE edition_id = ?
    `).get(editionId) as { provider_message_id: string | null; state: string } | undefined;
  } finally {
    database.close();
  }
  const publicationUrl = publicDigestUrl(`/daily/${localDate}`,"ru",environment);
  const card = await syncBriefingRunCard(attemptId, environment, options);
  if (!card.messageId) throw new Error("Release run card has no Discord message ID");
  const alreadyComplete = existingRelease?.state === "complete"
    && existingRelease.provider_message_id === card.messageId
    && card.action === "unchanged";
  const timestamp = new Date().toISOString();
  const persisted = openBriefingDatabase(paths);
  try {
    persisted.prepare(`
      INSERT INTO release_notification_receipts (
        edition_id, provider, destination, provider_message_id,
        state, provider_receipt_json, created_at, updated_at
      ) VALUES (?, 'discord', ?, ?, 'complete', ?, ?, ?)
      ON CONFLICT(edition_id) DO UPDATE SET
        provider = 'discord', destination = excluded.destination,
        provider_message_id = excluded.provider_message_id,
        state = 'complete', provider_receipt_json = excluded.provider_receipt_json,
        updated_at = excluded.updated_at
    `).run(
      editionId,
      config.discordChannelId,
      card.messageId,
      JSON.stringify({ id: card.messageId, runCard: true }),
      timestamp,
      timestamp,
    );
  } finally {
    persisted.close();
  }
  return {
    editionId,
    destination: config.discordChannelId,
    messageId: card.messageId,
    alreadyComplete,
    publicationUrl,
  };
}
