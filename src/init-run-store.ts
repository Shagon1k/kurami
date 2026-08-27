export * from "./orchestrator/state/init-run-store.ts";

import { runRunStoreInitializerCli } from "./orchestrator/state/init-run-store.ts";

if (import.meta.main) {
  runRunStoreInitializerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
