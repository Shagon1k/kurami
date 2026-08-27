export * from "./orchestrator/health/runtime.ts";

import { runRuntimeHealthCli } from "./orchestrator/health/runtime.ts";

if (import.meta.main) {
  runRuntimeHealthCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
