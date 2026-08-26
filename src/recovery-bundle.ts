export * from "./system/recovery/recovery-bundle.ts";

import { runRecoveryBundleCli } from "./system/recovery/recovery-bundle.ts";

if (import.meta.main) {
  runRecoveryBundleCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
