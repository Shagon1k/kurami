export * from "./orchestrator/projects/metadata/proposals/scheduler.ts";

import { runMetadataProposalSchedulerCli } from "./orchestrator/projects/metadata/proposals/scheduler.ts";

if (import.meta.main) {
  runMetadataProposalSchedulerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
