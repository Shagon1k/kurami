export * from "./system/health/system-health-discord.ts";

import { runSystemHealthDiscordCli } from "./system/health/system-health-discord.ts";

if (import.meta.main) {
  runSystemHealthDiscordCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
