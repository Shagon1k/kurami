export * from "./orchestrator/projects/previews/adapters/static.ts";

import { runPreviewStaticRuntimeCli } from "./orchestrator/projects/previews/adapters/static.ts";

if (import.meta.main) {
  runPreviewStaticRuntimeCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
