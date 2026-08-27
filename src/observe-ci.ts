export * from "./orchestrator/projects/ci/observe.ts";

import { runCiObserverCli } from "./orchestrator/projects/ci/observe.ts";

if (import.meta.main) {
  runCiObserverCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
