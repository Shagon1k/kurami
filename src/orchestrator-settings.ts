export * from "./orchestrator/settings/orchestrator-settings.ts";

import { runOrchestratorSettingsCli } from "./orchestrator/settings/orchestrator-settings.ts";

if (import.meta.main) {
  runOrchestratorSettingsCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
