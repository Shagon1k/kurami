export * from "./orchestrator/projects/poll-projects.ts";

import { runProjectPollerCli } from "./orchestrator/projects/poll-projects.ts";

if (import.meta.main) {
  runProjectPollerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
