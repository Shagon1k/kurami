export * from "./orchestrator/projects/process-project-events.ts";

import { runProjectEventConsumerCli } from "./orchestrator/projects/process-project-events.ts";

if (import.meta.main) {
  runProjectEventConsumerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
