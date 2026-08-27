export * from "./orchestrator/projects/sessions/manager.ts";

import { runSessionManagerCli } from "./orchestrator/projects/sessions/manager.ts";

if (import.meta.main) {
  runSessionManagerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
