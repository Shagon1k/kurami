export * from "./orchestrator/projects/reviews/fix-manager.ts";

import { runReviewFixManagerCli } from "./orchestrator/projects/reviews/fix-manager.ts";

if (import.meta.main) {
  runReviewFixManagerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
