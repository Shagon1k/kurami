export * from "./orchestrator/projects/metadata/proposals/manager.ts";

import { runMetadataProposalManagerCli } from "./orchestrator/projects/metadata/proposals/manager.ts";

if (import.meta.main) {
  runMetadataProposalManagerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
