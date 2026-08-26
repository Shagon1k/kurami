export * from "./orchestrator/projects/project-status.ts";

import { runProjectStatusCli } from "./orchestrator/projects/project-status.ts";

if (import.meta.main) {
  runProjectStatusCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
