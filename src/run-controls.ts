export * from "./orchestrator/controls/run.ts";

import { runRunControlsCli } from "./orchestrator/controls/run.ts";

if (import.meta.main) {
  try {
    runRunControlsCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  }
}
