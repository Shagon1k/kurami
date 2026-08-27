export * from "./orchestrator/projects/sessions/autonomous-successor.ts";

import { runAutonomousSuccessorCli } from "./orchestrator/projects/sessions/autonomous-successor.ts";

if (import.meta.main) {
  runAutonomousSuccessorCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
