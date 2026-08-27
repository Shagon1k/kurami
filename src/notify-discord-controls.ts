export * from "./orchestrator/controls/discord.ts";

import { runDiscordControlsCli } from "./orchestrator/controls/discord.ts";

if (import.meta.main) {
  runDiscordControlsCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
