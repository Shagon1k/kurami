export * from "./orchestrator/projects/project-readiness.ts";

import { runProjectReadinessCli } from "./orchestrator/projects/project-readiness.ts";

if (import.meta.main) {
  runProjectReadinessCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
