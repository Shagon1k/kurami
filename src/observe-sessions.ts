export * from "./orchestrator/projects/sessions/observe.ts";

import { runSessionObserverCli } from "./orchestrator/projects/sessions/observe.ts";

if (import.meta.main) {
  try {
    runSessionObserverCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}
