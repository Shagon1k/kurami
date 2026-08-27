export * from "./orchestrator/runtime/controller.ts";

import { runOrchestratorControllerCli } from "./orchestrator/runtime/controller.ts";

if (import.meta.main) {
  runOrchestratorControllerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
