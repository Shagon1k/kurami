export * from "./orchestrator/projects/metadata/proposals/worker.ts";

import { runMetadataProposalWorkerCli } from "./orchestrator/projects/metadata/proposals/worker.ts";

if (import.meta.main) {
  runMetadataProposalWorkerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
