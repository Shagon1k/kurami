import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  briefingPaths,
  initializeBriefingStore,
  loadEdition,
  openBriefingDatabase,
} from "./store.ts";
import { loadBriefingRuntimeConfig } from "./runtime-config.ts";

type JsonRecord = Record<string, unknown>;

type NotificationResult = {
  editionId: string;
  destination: string;
  messageId: string;
  alreadyComplete: boolean;
  publicationUrl: string;
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

async function discordPost(
  token: string,
  channelId: string,
  content: string,
  nonce: string,
): Promise<JsonRecord> {
  let lastError = "Discord delivery failed";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ content, nonce, enforce_nonce: true }),
        signal: controller.signal,
      });
      if (response.status === 429) {
        const body = await response.json().catch(() => ({})) as { retry_after?: number };
        await new Promise((resolveDelay) => setTimeout(
          resolveDelay,
          Math.min(5_000, Math.max(200, Number(body.retry_after ?? 1) * 1_000)),
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

export async function notifyBriefingRelease(
  editionId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NotificationResult> {
  const paths = briefingPaths(environment);
  await initializeBriefingStore(paths);
  const config = await loadBriefingRuntimeConfig(paths, environment);
  const database = openBriefingDatabase(paths);
  let edition: ReturnType<typeof loadEdition>;
  try {
    edition = loadEdition(database, { id: editionId });
    if (!edition || (edition.state !== "complete" && edition.state !== "partial")) {
      throw new Error("Only a published briefing edition can be announced");
    }
    const existing = database.prepare(`
      SELECT provider_message_id, state FROM release_notification_receipts WHERE edition_id = ?
    `).get(editionId) as { provider_message_id: string | null; state: string } | undefined;
    const publicationUrl = `${(environment.BRIEFING_PUBLIC_BASE_URL ?? "https://digest.shagon1k.win").replace(/\/$/u, "")}/daily/${edition.local_date}`;
    if (existing?.state === "complete" && existing.provider_message_id) {
      return {
        editionId,
        destination: config.discordChannelId,
        messageId: existing.provider_message_id,
        alreadyComplete: true,
        publicationUrl,
      };
    }
    const timestamp = new Date().toISOString();
    database.prepare(`
      INSERT INTO release_notification_receipts (
        edition_id, provider, destination, provider_message_id,
        state, provider_receipt_json, created_at, updated_at
      ) VALUES (?, 'discord', ?, NULL, 'prepared', NULL, ?, ?)
      ON CONFLICT(edition_id) DO UPDATE SET
        provider = 'discord', destination = excluded.destination,
        state = 'prepared', provider_receipt_json = NULL, updated_at = excluded.updated_at
    `).run(editionId, config.discordChannelId, timestamp, timestamp);
    const content = `☀️ Брифинг за ${displayDate(edition.local_date, edition.timezone)} готов — ${publicationUrl}`;
    const nonce = `briefing-${createHash("sha256").update(editionId).digest("hex").slice(0, 20)}`;
    const token = await discordToken(paths.home, environment);
    try {
      const receipt = await discordPost(token, config.discordChannelId, content, nonce);
      const messageId = receipt.id as string;
      database.prepare(`
        UPDATE release_notification_receipts
        SET provider_message_id = ?, state = 'complete', provider_receipt_json = ?, updated_at = ?
        WHERE edition_id = ?
      `).run(messageId, JSON.stringify({ id: messageId }), new Date().toISOString(), editionId);
      return {
        editionId,
        destination: config.discordChannelId,
        messageId,
        alreadyComplete: false,
        publicationUrl,
      };
    } catch (error) {
      database.prepare(`
        UPDATE release_notification_receipts
        SET state = 'failed', provider_receipt_json = ?, updated_at = ?
        WHERE edition_id = ?
      `).run(
        JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 180) : "delivery_failed" }),
        new Date().toISOString(),
        editionId,
      );
      throw error;
    }
  } finally {
    database.close();
  }
}
