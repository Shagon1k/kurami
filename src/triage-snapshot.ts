export * from "./orchestrator/projects/triage/snapshot.ts";

import { runTriageSnapshotCli } from "./orchestrator/projects/triage/snapshot.ts";

if (import.meta.main) {
  runTriageSnapshotCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
