export * from "./orchestrator/projects/triage/rank.ts";

import { runTriageRankCli } from "./orchestrator/projects/triage/rank.ts";

if (import.meta.main) {
  runTriageRankCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
