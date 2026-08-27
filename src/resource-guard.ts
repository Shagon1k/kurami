export * from "./orchestrator/resources/guard.ts";

import { runResourceGuardCli } from "./orchestrator/resources/guard.ts";

if (import.meta.main) {
  runResourceGuardCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
