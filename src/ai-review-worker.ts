export * from "./orchestrator/projects/reviews/worker.ts";

import { runAiReviewWorkerCli } from "./orchestrator/projects/reviews/worker.ts";

if (import.meta.main) {
  runAiReviewWorkerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
