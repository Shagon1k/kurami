export * from "./system/recovery/s3-recovery.ts";

import { runS3RecoveryCli } from "./system/recovery/s3-recovery.ts";

if (import.meta.main) {
  runS3RecoveryCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
