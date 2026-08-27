export * from "./orchestrator/projects/previews/ingress.ts";

import { runPreviewIngressCli } from "./orchestrator/projects/previews/ingress.ts";

if (import.meta.main) {
  runPreviewIngressCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
