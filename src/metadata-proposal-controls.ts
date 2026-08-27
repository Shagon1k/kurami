export * from "./orchestrator/projects/metadata/controls.ts";

import { runMetadataProposalControlsCli } from "./orchestrator/projects/metadata/controls.ts";

if (import.meta.main) {
  runMetadataProposalControlsCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
