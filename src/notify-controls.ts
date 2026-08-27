export * from "./orchestrator/controls/telegram.ts";

import { runTelegramFallbackCli } from "./orchestrator/controls/telegram.ts";

if (import.meta.main) {
  runTelegramFallbackCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
