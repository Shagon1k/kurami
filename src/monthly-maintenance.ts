export * from "./system/maintenance/monthly-maintenance.ts";

import { runMonthlyMaintenanceCli } from "./system/maintenance/monthly-maintenance.ts";

if (import.meta.main) {
  runMonthlyMaintenanceCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
