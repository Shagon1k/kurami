export * from "./system/health/health-settings.ts";

import { runHealthSettingsCli } from "./system/health/health-settings.ts";

if (import.meta.main) {
  runHealthSettingsCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
