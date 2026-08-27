export * from "./orchestrator/projects/previews/runtime.ts";

import { runPreviewRuntimeCli } from "./orchestrator/projects/previews/runtime.ts";

if (import.meta.main) {
  try {
    runPreviewRuntimeCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}
