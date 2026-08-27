export * from "./orchestrator/projects/digest/discord.ts";

import { runDiscordProjectsDigestCli } from "./orchestrator/projects/digest/discord.ts";

if (import.meta.main) {
  runDiscordProjectsDigestCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
