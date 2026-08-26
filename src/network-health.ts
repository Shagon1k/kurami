export * from "./system/network/network-health.ts";

import { runNetworkHealthCli } from "./system/network/network-health.ts";

if (import.meta.main) {
  runNetworkHealthCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
