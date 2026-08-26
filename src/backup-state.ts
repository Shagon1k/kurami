export * from "./system/recovery/backup-state.ts";

import { runBackupStateCli } from "./system/recovery/backup-state.ts";

if (import.meta.main) {
  runBackupStateCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
