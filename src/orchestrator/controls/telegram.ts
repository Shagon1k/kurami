import {parseEnvValue} from "../../core/env-value.ts";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { openOrchestratorDatabase } from "../state/database.ts";

process.umask(0o077);

type TelegramConfig = { chat_id: string; topic_id: string };
type ProjectConfig = { telegram: TelegramConfig };
type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};
type EventKind =
  | "review_ready"
  | "human_control_ready"
  | "preview_ready"
  | "preview_failed"
  | "attention_required";
type EventRow = {
  event_id: string;
  run_id: string;
  event_kind: EventKind;
  project: string;
  repository: string;
  issue_number: number;
  run_state: string;
  owner_state: string;
  title: string | null;
  issue_url: string | null;
  branch_name: string | null;
  preview_hostname: string | null;
};
type CardRow = {
  run_id: string;
  stage: string;
  detail: string;
  telegram_message_id: string | null;
  project: string;
  issue_number: number;
  title: string | null;
  issue_url: string | null;
  preview_hostname: string | null;
  updated_at: string;
  keyboard_removed_at: string | null;
};

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../.."),
);
const hermesHome = resolve(
  process.env.HERMES_HOME ?? "/home/shagon1k/_hermes/_core",
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const terminalStages = new Set(["completed", "cancelled"]);
const ownerTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Vilnius",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function fail(message: string): never {
  throw new Error(message);
}

function ownerTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  const parts = Object.fromEntries(
    ownerTimestampFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

function parseArguments(): { apply: boolean } {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply"))
    fail("Usage: notify-controls.ts [--apply]");
  return { apply: args.includes("--apply") };
}


function loadPendingEvents(database: DatabaseSync): EventRow[] {
  // A process may die after Telegram accepts a message but before SQLite records
  // the response. Retrying an ambiguous `sending` row creates duplicate messages,
  // so only explicit `pending`/`failed` deliveries are automatic.
  return database
    .prepare(
      `
    SELECT ce.event_id, ce.run_id, ce.event_kind,
           r.project, r.repository, r.issue_number,
           r.state AS run_state, r.owner_state,
           pe.title, pe.url AS issue_url,
           rr.branch_name, ps.hostname AS preview_hostname
    FROM run_control_events ce
    JOIN runs r USING (run_id)
    JOIN run_resources rr USING (run_id)
    JOIN project_events pe ON pe.event_id = r.trigger_event_id
    LEFT JOIN preview_leases pl ON pl.run_id = r.run_id AND pl.state = 'running'
    LEFT JOIN preview_slots ps USING (slot_number)
    WHERE ce.delivery_state IN ('pending', 'failed') AND ce.attempt_count < 5
    ORDER BY ce.created_at, ce.event_id
  `,
    )
    .all() as EventRow[];
}

function loadPendingCards(database: DatabaseSync): CardRow[] {
  return database
    .prepare(
      `
    SELECT pc.run_id, pc.stage, pc.detail, pc.telegram_message_id,
           pc.updated_at, pc.keyboard_removed_at,
           r.project, r.issue_number, pe.title, pe.url AS issue_url,
           ps.hostname AS preview_hostname
    FROM run_progress_cards pc
    JOIN runs r USING (run_id)
    JOIN project_events pe ON pe.event_id = r.trigger_event_id
    LEFT JOIN preview_leases pl ON pl.run_id = r.run_id AND pl.state = 'running'
    LEFT JOIN preview_slots ps USING (slot_number)
    WHERE pc.delivery_state IN ('pending', 'failed') AND pc.attempt_count < 5
    ORDER BY pc.updated_at, pc.run_id
  `,
    )
    .all() as CardRow[];
}

function eventStillValid(event: EventRow): boolean {
  if (event.event_kind === "review_ready")
    return event.run_state === "parked_review" && event.owner_state === "none";
  if (event.event_kind === "human_control_ready")
    return event.run_state === "remote_owned" && event.owner_state === "remote";
  if (event.event_kind === "preview_ready")
    return Boolean(event.preview_hostname);
  if (event.event_kind === "preview_failed")
    return !["cancelled", "archived"].includes(event.run_state);
  return !["rejected", "cancelled", "archived"].includes(event.run_state);
}

function findPullRequest(
  event: EventRow,
): { url: string; title: string } | null {
  if (!event.branch_name || event.event_kind !== "review_ready") return null;
  try {
    const stdout = execFileSync(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        event.repository,
        "--head",
        event.branch_name,
        "--state",
        "all",
        "--limit",
        "1",
        "--json",
        "url,title,number",
      ],
      {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return (
      (JSON.parse(stdout) as Array<{ url: string; title: string }>)[0] ?? null
    );
  } catch {
    return null;
  }
}

function eventMessage(
  event: EventRow,
  pullRequest: { url: string; title: string } | null,
): string {
  const header =
    event.event_kind === "human_control_ready"
      ? `${event.project} #${event.issue_number}: preparation is ready for you`
      : event.event_kind === "preview_ready"
        ? `${event.project} #${event.issue_number}: preview is ready`
        : event.event_kind === "preview_failed"
          ? `${event.project} #${event.issue_number}: preview failed`
          : event.event_kind === "attention_required"
            ? `${event.project} #${event.issue_number}: attention required`
            : `${event.project} #${event.issue_number}: ready for review`;
  const closing =
    event.event_kind === "human_control_ready"
      ? "Open the existing session to continue the prepared work."
      : event.event_kind === "preview_failed"
        ? "The worktree is preserved. Check Status before retrying or stopping."
        : "Choose an action below; nothing starts automatically.";
  return [
    header,
    event.title ?? "",
    pullRequest ? `PR: ${pullRequest.url}` : "",
    event.preview_hostname ? `Preview: https://${event.preview_hostname}` : "",
    event.issue_url ? `Issue: ${event.issue_url}` : "",
    closing,
  ]
    .filter(Boolean)
    .join("\n");
}

function keyboard(event: EventRow): Record<string, unknown> {
  const suffix = `· ${event.run_id}`;
  const rows =
    event.event_kind === "human_control_ready"
      ? [[`Status ${suffix}`, `Cancel run ${suffix}`]]
      : event.event_kind === "preview_ready"
        ? [
            [`Status ${suffix}`, `Take control ${suffix}`],
            [`Stop preview ${suffix}`, `Cancel run ${suffix}`],
          ]
        : [
            [`Status ${suffix}`, `Take control ${suffix}`],
            [`Start preview ${suffix}`, `Cancel run ${suffix}`],
          ];
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    one_time_keyboard: false,
    selective: true,
    input_field_placeholder: `Control ${event.project} #${event.issue_number}`,
  };
}

function cardMessage(card: CardRow): string {
  const labels: Record<string, string> = {
    preparing: "Preparing worktree",
    starting: "Starting agent",
    working: "Agent working",
    human_control: "Human control",
    review_ready: "Ready for review",
    waiting_human: "Waiting for decision",
    preview_queued: "Preview queued",
    preview_building: "Preview building",
    preview_ready: "Preview ready",
    stopping: "Stopping",
    completed: "Completed",
    cancelled: "Cancelled",
    needs_attention: "Needs attention",
  };
  return [
    `${card.project} #${card.issue_number} — ${labels[card.stage] ?? card.stage}`,
    card.title ?? "",
    card.detail,
    card.preview_hostname ? `Preview: https://${card.preview_hostname}` : "",
    card.issue_url ? `Issue: ${card.issue_url}` : "",
    `Updated: ${ownerTimestamp(card.updated_at)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function telegramCall(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const body = (await response.json()) as {
    ok?: boolean;
    result?: Record<string, unknown>;
    description?: string;
  };
  if (!response.ok || !body.ok)
    fail(
      `Telegram ${method} failed: ${body.description ?? `HTTP ${response.status}`}`,
    );
  return body.result ?? {};
}

async function deliverCard(
  token: string,
  target: TelegramConfig,
  card: CardRow,
): Promise<string> {
  if (card.telegram_message_id) {
    await telegramCall(token, "editMessageText", {
      chat_id: target.chat_id,
      message_id: Number(card.telegram_message_id),
      text: cardMessage(card),
      disable_web_page_preview: false,
    });
    return card.telegram_message_id;
  }
  const result = await telegramCall(token, "sendMessage", {
    chat_id: target.chat_id,
    message_thread_id: Number(target.topic_id),
    text: cardMessage(card),
    disable_web_page_preview: false,
  });
  const messageId = result.message_id;
  if (typeof messageId !== "number")
    fail("Telegram sendMessage returned no message_id");
  return String(messageId);
}

async function sendKeyboardRemoval(
  token: string,
  target: TelegramConfig,
  card: CardRow,
): Promise<void> {
  await telegramCall(token, "sendMessage", {
    chat_id: target.chat_id,
    message_thread_id: Number(target.topic_id),
    text: `${card.project} #${card.issue_number}: controls closed`,
    reply_markup: { remove_keyboard: true, selective: true },
  });
}

async function sendEvent(
  token: string,
  target: TelegramConfig,
  event: EventRow,
): Promise<string> {
  const result = await telegramCall(token, "sendMessage", {
    chat_id: target.chat_id,
    message_thread_id: Number(target.topic_id),
    text: eventMessage(event, findPullRequest(event)),
    disable_web_page_preview: false,
    reply_markup: keyboard(event),
  });
  const messageId = result.message_id;
  if (typeof messageId !== "number")
    fail("Telegram sendMessage returned no message_id");
  return String(messageId);
}

export async function runTelegramFallbackCli(): Promise<void> {
  const { apply } = parseArguments();
  if (apply && process.env.KURAMI_TELEGRAM_PROACTIVE !== "1") {
    if (process.env.NOTIFIER_QUIET !== "1")
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, action: "disabled", delivered: 0, cards: 0 })}\n`,
      );
    return;
  }
  const registry = parse(
    await readFile(projectsPath, "utf8"),
  ) as ProjectsRegistry;
  if (registry.version !== 1) fail("Unsupported projects config version");
  const database = openOrchestratorDatabase(databasePath);
  const cards = loadPendingCards(database);
  const events = loadPendingEvents(database);
  if (!apply) {
    database.close();
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, pendingCards: cards.map((card) => ({ runId: card.run_id, stage: card.stage, edit: Boolean(card.telegram_message_id) })), pending: events.map((event) => ({ eventId: event.event_id, runId: event.run_id, kind: event.event_kind })) })}\n`,
    );
    return;
  }
  if (cards.length === 0 && events.length === 0) {
    database.close();
    if (process.env.NOTIFIER_QUIET !== "1")
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, delivered: 0, cards: 0 })}\n`,
      );
    return;
  }
  const env = await readFile(resolve(hermesHome, ".env"), "utf8");
  const token =
    process.env.TELEGRAM_BOT_TOKEN ?? parseEnvValue(env, "TELEGRAM_BOT_TOKEN");
  if (!token) fail("TELEGRAM_BOT_TOKEN is unavailable");
  const results: Array<Record<string, unknown>> = [];

  for (const card of cards) {
    const target = registry.projects[card.project]?.telegram;
    if (!target) {
      results.push({
        runId: card.run_id,
        action: "failed",
        error: "missing_project_target",
      });
      continue;
    }
    database
      .prepare(
        `UPDATE run_progress_cards SET delivery_state='sending', attempt_count=attempt_count+1, last_error=NULL WHERE run_id=? AND delivery_state IN ('pending','failed')`,
      )
      .run(card.run_id);
    try {
      const messageId = await deliverCard(token, target, card);
      if (terminalStages.has(card.stage) && !card.keyboard_removed_at)
        await sendKeyboardRemoval(token, target, card);
      database
        .prepare(
          `
        UPDATE run_progress_cards SET delivery_state='delivered', telegram_message_id=?,
          keyboard_removed_at=CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE keyboard_removed_at END,
          delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=? AND delivery_state='sending'
      `,
        )
        .run(messageId, terminalStages.has(card.stage) ? 1 : 0, card.run_id);
      results.push({
        runId: card.run_id,
        action: card.telegram_message_id ? "card_edited" : "card_sent",
        messageId,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      database
        .prepare(
          `UPDATE run_progress_cards SET delivery_state='failed', last_error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=? AND delivery_state='sending'`,
        )
        .run(errorMessage.slice(0, 500), card.run_id);
      results.push({
        runId: card.run_id,
        action: "failed",
        error: errorMessage,
      });
    }
  }

  for (const event of events) {
    if (!eventStillValid(event)) {
      database
        .prepare(
          `UPDATE run_control_events SET delivery_state='cancelled', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id=?`,
        )
        .run(event.event_id);
      results.push({ eventId: event.event_id, action: "cancelled_stale" });
      continue;
    }
    const target = registry.projects[event.project]?.telegram;
    if (!target) {
      results.push({
        eventId: event.event_id,
        action: "failed",
        error: "missing_project_target",
      });
      continue;
    }
    database
      .prepare(
        `UPDATE run_control_events SET delivery_state='sending', attempt_count=attempt_count+1, last_error=NULL, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id=? AND delivery_state IN ('pending','failed')`,
      )
      .run(event.event_id);
    try {
      const messageId = await sendEvent(token, target, event);
      database
        .prepare(
          `UPDATE run_control_events SET delivery_state='delivered', telegram_message_id=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'), delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id=? AND delivery_state='sending'`,
        )
        .run(messageId, event.event_id);
      results.push({ eventId: event.event_id, action: "delivered", messageId });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      database
        .prepare(
          `UPDATE run_control_events SET delivery_state='failed', last_error=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id=? AND delivery_state='sending'`,
        )
        .run(errorMessage.slice(0, 500), event.event_id);
      results.push({
        eventId: event.event_id,
        action: "failed",
        error: errorMessage,
      });
    }
  }
  database.close();
  const failed = results.filter((result) => result.action === "failed");
  if (process.env.NOTIFIER_QUIET !== "1")
    process.stdout.write(
      `${JSON.stringify({ ok: failed.length === 0, apply: true, results })}\n`,
    );
  if (failed.length > 0) process.exitCode = 1;
}

if (import.meta.main) {
  runTelegramFallbackCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
