export * from "./orchestrator/projects/previews/manager.ts";

import { runPreviewManagerCli } from "./orchestrator/projects/previews/manager.ts";

if (import.meta.main) {
  runPreviewManagerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
