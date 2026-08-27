export * from "./orchestrator/projects/reviews/manager.ts";

import { runReviewManagerCli } from "./orchestrator/projects/reviews/manager.ts";

if (import.meta.main) {
  runReviewManagerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
