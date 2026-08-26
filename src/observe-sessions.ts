import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

process.umask(0o077);

type ActiveRun = {
  run_id: string;
  project: string;
  issue_number: number;
  issue_title: string | null;
  issue_url: string | null;
  run_state: string;
  owner_state: string;
  tmux_session_name: string | null;
};

type AttentionRow = {
  attention_kind: string | null;
  consecutive_observations: number;
  notified_kind: string | null;
};

const orchestratorHome = resolve(
  process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");

function fail(message: string): never {
  throw new Error(message);
}

function parseProject(): string {
  const args = process.argv.slice(2);
  const index = args.indexOf("--project");
  const project = index >= 0 ? args[index + 1]?.trim() : undefined;
  const unknown = args.filter(
    (arg, position) => arg !== "--project" && position !== index + 1,
  );
  if (!project || unknown.length > 0) {
    fail("Usage: observe-sessions.ts --project <project>");
  }
  return project;
}

function tmuxCapture(sessionName: string): {
  alive: boolean;
  transcript: string;
} {
  const result = spawnSync(
    "tmux",
    ["capture-pane", "-p", "-J", "-t", `${sessionName}:0.0`, "-S", "-120"],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status === 0) return { alive: true, transcript: result.stdout };
  if (result.status === 1) return { alive: false, transcript: "" };
  fail(
    result.stderr.trim() || `Failed to inspect tmux session: ${sessionName}`,
  );
}

export function classifyTranscript(transcript: string): string | null {
  const tail = transcript.slice(-1_800);
  if (
    /Would you like to run|Requested permission|Press enter to confirm|Allow .+\?/iu.test(
      tail,
    )
  ) {
    return "waiting_on_approval";
  }
  if (/Conversation interrupted|Run stopped as requested/iu.test(tail)) {
    return "turn_interrupted";
  }
  const blockerPatterns = [
    /Publishing is blocked/iu,
    /stopped before (?:staging|committing|pushing|creating)/iu,
    /Re-authenticate with/iu,
    /credentials? (?:are|is) invalid/iu,
    /cannot (?:commit|push|create (?:a )?(?:draft )?PR)/iu,
  ];
  const blockerIndex = Math.max(
    ...blockerPatterns.map((pattern) => {
      const match = [
        ...tail.matchAll(new RegExp(pattern.source, `${pattern.flags}g`)),
      ].at(-1);
      return match?.index ?? -1;
    }),
  );
  // Codex renders a fresh `›` input prompt only after the turn has stopped.
  // Requiring it after the blocker avoids alerting on transient narration.
  if (blockerIndex >= 0 && tail.lastIndexOf("\n› ") > blockerIndex) {
    return "idle_textual_blocker";
  }
  return null;
}

function classify(run: ActiveRun): string | null {
  if (run.owner_state !== "cli") return null;
  if (!run.tmux_session_name) return "managed_session_missing";
  const capture = tmuxCapture(run.tmux_session_name);
  if (!capture.alive) return "managed_session_missing";
  return classifyTranscript(capture.transcript);
}

function description(kind: string): string {
  switch (kind) {
    case "waiting_on_approval":
      return "Codex is still waiting for a human approval after two checks.";
    case "turn_interrupted":
      return "The Codex turn was interrupted and needs a decision.";
    case "managed_session_missing":
      return "The CLI-owned Codex task lost its managed tmux session.";
    case "idle_textual_blocker":
      return "Codex stopped at a textual blocker and is idle; the run needs a decision or a safe retry.";
    default:
      return `Codex needs attention: ${kind}.`;
  }
}

function main(): void {
  const project = parseProject();
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  const notifications: string[] = [];
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const runs = database
      .prepare(
        `
        SELECT r.run_id, r.project, r.issue_number,
               pe.title AS issue_title, pe.url AS issue_url,
               r.state AS run_state, r.owner_state, rr.tmux_session_name
        FROM runs r
        JOIN run_resources rr USING (run_id)
        JOIN project_events pe ON pe.event_id = r.trigger_event_id
        WHERE r.project = ?
          AND r.owner_state = 'cli'
          AND r.state IN ('starting', 'running', 'parked_review', 'stopping')
        ORDER BY r.created_at
      `,
      )
      .all(project) as ActiveRun[];

    database.exec("BEGIN IMMEDIATE");
    try {
      for (const run of runs) {
        const kind = classify(run);
        const previous = database
          .prepare(
            `
            SELECT attention_kind, consecutive_observations, notified_kind
            FROM run_attention WHERE run_id = ?
          `,
          )
          .get(run.run_id) as AttentionRow | undefined;
        const count = kind
          ? previous?.attention_kind === kind
            ? previous.consecutive_observations + 1
            : 1
          : 0;
        database
          .prepare(
            `
            INSERT INTO run_attention (
              run_id, attention_kind, consecutive_observations, notified_kind,
              first_observed_at, last_observed_at, notified_at
            ) VALUES (
              ?, ?, ?, NULL,
              CASE WHEN ? IS NULL THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END,
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
            )
            ON CONFLICT(run_id) DO UPDATE SET
              attention_kind = excluded.attention_kind,
              consecutive_observations = excluded.consecutive_observations,
              notified_kind = CASE
                WHEN excluded.attention_kind IS NULL THEN NULL
                WHEN run_attention.attention_kind = excluded.attention_kind
                  THEN run_attention.notified_kind
                ELSE NULL
              END,
              first_observed_at = CASE
                WHEN excluded.attention_kind IS NULL THEN NULL
                WHEN run_attention.attention_kind = excluded.attention_kind
                  THEN run_attention.first_observed_at
                ELSE excluded.first_observed_at
              END,
              last_observed_at = excluded.last_observed_at,
              notified_at = CASE
                WHEN excluded.attention_kind IS NULL OR run_attention.attention_kind != excluded.attention_kind
                  THEN NULL
                ELSE run_attention.notified_at
              END
          `,
          )
          .run(run.run_id, kind, count, kind);

        if (kind && count >= 2 && previous?.notified_kind !== kind) {
          database
            .prepare(
              `
              UPDATE run_attention
              SET notified_kind = ?,
                  notified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE run_id = ?
            `,
            )
            .run(kind, run.run_id);
          notifications.push(
            [
              `${project} #${run.issue_number}: ${description(kind)}`,
              run.issue_title ?? "",
              run.issue_url ?? "",
            ]
              .filter(Boolean)
              .join("\n"),
          );
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  if (notifications.length > 0) {
    process.stdout.write(`${notifications.join("\n\n")}\n`);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}
