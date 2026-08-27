export * from "./orchestrator/projects/previews/adapters/compose.ts";

import { runPreviewComposeRuntimeCli } from "./orchestrator/projects/previews/adapters/compose.ts";

if (import.meta.main) {
  runPreviewComposeRuntimeCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
