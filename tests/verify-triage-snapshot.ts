import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildTriageFacts,
  factualHash,
  persistTriageSnapshot,
  type RawTriageItem,
} from "../src/triage-snapshot.ts";
import * as canonicalSnapshot from "../src/orchestrator/projects/triage/snapshot.ts";
import * as legacySnapshot from "../src/triage-snapshot.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function item(
  number: number,
  overrides: Partial<RawTriageItem> = {},
): RawTriageItem {
  return {
    itemId: `item-${number}`,
    contentType: "Issue",
    repository: "Shagon1k/TailorTales",
    issueNumber: number,
    title: `Issue ${number}`,
    url: `https://example.invalid/issues/${number}`,
    issueState: "OPEN",
    status: "Backlog",
    priority: null,
    effort: null,
    labels: [],
    labelsTotalCount: 0,
    hasDescription: true,
    bodyDigest: `${number}`.repeat(64).slice(0, 64),
    createdAt: `2026-08-${String(number).padStart(2, "0")}T08:00:00.000Z`,
    closedAt: null,
    blockedByOpenCount: 0,
    blockingOpenCount: 0,
    blockedByTotalCount: 0,
    blockingTotalCount: 0,
    blockedBy: [],
    blocking: [],
    ...overrides,
  };
}

async function main(): Promise<void> {
  const app = resolve(import.meta.dirname, "..");
  assert(
    legacySnapshot.buildTriageFacts === canonicalSnapshot.buildTriageFacts &&
      legacySnapshot.persistTriageSnapshot ===
        canonicalSnapshot.persistTriageSnapshot &&
      legacySnapshot.runTriageSnapshotCli ===
        canonicalSnapshot.runTriageSnapshotCli,
    "Legacy triage snapshot module is not a transparent compatibility wrapper",
  );
  const home = await mkdtemp(resolve(tmpdir(), "kurami-triage-test-"));
  try {
    const migrationsDirectory = resolve(app, "migrations");
    const migrations = (await readdir(migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/u.test(name))
      .sort();
    const upgrade = new DatabaseSync(resolve(home, "upgrade-v16.db"));
    upgrade.exec("PRAGMA foreign_keys=ON;");
    for (const migration of migrations.filter((name) => name < "017_"))
      upgrade.exec(await readFile(resolve(migrationsDirectory, migration), "utf8"));
    upgrade.exec(`
      INSERT INTO project_items (
        project, item_id, content_id, content_type, repository, issue_number,
        title, url, status, first_seen_at, last_seen_at
      ) VALUES (
        'tailortales', 'item-upgrade', 'content-upgrade', 'Issue',
        'Shagon1k/TailorTales', 999, 'Preserve me',
        'https://example.invalid/issues/999', 'Backlog',
        '2026-08-19T08:00:00.000Z', '2026-08-19T08:00:00.000Z'
      );
    `);
    upgrade.exec(
      await readFile(
        resolve(migrationsDirectory, "017_project_triage.sql"),
        "utf8",
      ),
    );
    assert(
      (upgrade.prepare("SELECT COUNT(*) AS count FROM project_items").get() as {
        count: number;
      }).count === 1 && upgrade.prepare("PRAGMA foreign_key_check").all().length === 0,
      "Schema 17 did not preserve populated v16 state",
    );
    upgrade.close();

    await mkdir(resolve(home, "state"), { recursive: true });
    execFileSync(process.execPath, [resolve(app, "src/init-run-store.ts")], {
      env: {
        ...process.env,
        KURAMI_HOME: home,
        ORCHESTRATOR_MIGRATIONS_DIR: migrationsDirectory,
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    execFileSync("bash", ["-n", resolve(app, "run-projects-digest.sh")]);
    execFileSync("bash", [
      "-n",
      resolve(
        app,
        "integrations/hermes/scripts/kurami-projects-digest.sh",
      ),
    ]);
    const database = new DatabaseSync(resolve(home, "state/orchestrator.db"));
    const config = {
      owner: "Shagon1k",
      project_number: 2,
      repository: "Shagon1k/TailorTales",
      status_field: "Status",
      statuses: {
        backlog: "Backlog",
        active: "In progress",
        review: "Human Review",
        done: "Done",
        deferred: "Deferred",
      },
      workspace: {
        canonical_repository: "/tmp/TailorTales",
        worktree_root: "/tmp/worktrees/tailortales",
        base_branch: "main",
      },
      triage: {
        enabled: true,
        priority_field: "Priority",
        effort_field: "Effort",
      },
    };
    const blockedDependency = {
      repository: "Shagon1k/TailorTales",
      number: 90,
      state: "OPEN",
      url: "https://example.invalid/issues/90",
    };
    const rawItems = [
      item(1, { priority: "P2", effort: "S", blockingOpenCount: 2 }),
      item(2, {
        blockedByOpenCount: 1,
        blockedByTotalCount: 1,
        blockedBy: [blockedDependency],
      }),
      item(3, { hasDescription: false, bodyDigest: null }),
      item(4, { status: "In progress" }),
      item(5, {
        status: "Done",
        issueState: "CLOSED",
        closedAt: "2026-08-19T09:00:00.000Z",
      }),
      item(6),
    ];
    const activeRuns = [
      {
        runId: "r_active",
        itemId: "item-6",
        state: "running",
        ownerState: "cli",
      },
    ];
    const facts = buildTriageFacts(
      "tailortales",
      config,
      rawItems,
      activeRuns,
    );
    assert(
      JSON.stringify(facts.stats) ===
        JSON.stringify({
          issues: 6,
          remainingOpen: 5,
          backlog: 4,
          eligible: 1,
          blocked: 1,
          needsClarification: 1,
          active: 1,
          review: 0,
          deferred: 0,
          done: 1,
        }),
      `Unexpected factual totals: ${JSON.stringify(facts.stats)}`,
    );
    assert(
      facts.items.find(({ itemId }) => itemId === "item-2")?.eligibilityReasons.includes(
        "blocked_by_open_issue",
      ),
      "Open native dependency did not block eligibility",
    );
    assert(
      facts.items.find(({ itemId }) => itemId === "item-6")?.eligibilityReasons.includes(
        "active_run_exists",
      ),
      "An active managed run did not block duplicate eligibility",
    );
    const reordered = buildTriageFacts(
      "tailortales",
      config,
      [...rawItems].reverse(),
      activeRuns,
    );
    assert(
      factualHash(facts) === factualHash(reordered),
      "Input ordering changed the canonical factual hash",
    );

    const first = persistTriageSnapshot(
      database,
      facts,
      "2026-08-20T06:00:00.000Z",
      "2026-08-20T05:59:00.000Z",
    );
    const idle = persistTriageSnapshot(
      database,
      reordered,
      "2026-08-21T06:00:00.000Z",
      "2026-08-21T05:59:00.000Z",
    );
    assert(first.action === "changed", "Initial facts were not persisted");
    assert(idle.action === "unchanged", "Idle project was treated as changed");
    assert(
      idle.changeSequence === first.changeSequence,
      "Idle check advanced the change sequence",
    );
    assert(
      (database
        .prepare(
          "SELECT COUNT(*) AS count FROM project_triage_snapshots WHERE project = ?",
        )
        .get("tailortales") as { count: number }).count === 1,
      "Idle check appended duplicate snapshot history",
    );
    const idleState = database
      .prepare(`
        SELECT last_changed_at, last_checked_at
        FROM project_triage_state WHERE project = ?
      `)
      .get("tailortales") as {
      last_changed_at: string;
      last_checked_at: string;
    };
    assert(
      idleState.last_changed_at === "2026-08-20T06:00:00.000Z" &&
        idleState.last_checked_at === "2026-08-21T06:00:00.000Z",
      "Idle check did not preserve Suggested-since semantics",
    );

    const unblockedItems = rawItems.map((candidate) =>
      candidate.itemId === "item-2"
        ? {
            ...candidate,
            blockedByOpenCount: 0,
            blockedBy: [{ ...blockedDependency, state: "CLOSED" }],
          }
        : candidate,
    );
    const changedFacts = buildTriageFacts(
      "tailortales",
      config,
      unblockedItems,
      activeRuns,
    );
    const changed = persistTriageSnapshot(
      database,
      changedFacts,
      "2026-08-21T07:00:00.000Z",
      "2026-08-21T06:59:00.000Z",
    );
    assert(
      changed.action === "changed" &&
        changed.changeSequence === 2 &&
        changed.stats.eligible === 2,
      "Meaningful dependency change did not create the next factual snapshot",
    );
    assert(
      (database
        .prepare("SELECT COUNT(*) AS count FROM project_triage_snapshots")
        .get() as { count: number }).count === 2,
      "Changed facts did not append exactly one history row",
    );
    const stored = database
      .prepare("SELECT facts_json FROM project_triage_state WHERE project = ?")
      .get("tailortales") as { facts_json: string };
    assert(
      !stored.facts_json.toLowerCase().includes("due"),
      "Due-date policy leaked into the factual snapshot",
    );
    database.close();

    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        nativeDependencies: true,
        stableCanonicalOrdering: true,
        idleNoOp: true,
        idleHistoryRows: 1,
        meaningfulChangeSequence: changed.changeSequence,
        factualStats: changed.stats,
        dueDatesExcluded: true,
        populatedV16UpgradePreserved: true,
        rankingStarted: false,
        discordStarted: false,
        boardMutations: false,
      })}\n`,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
