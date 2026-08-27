export * from "./orchestrator/projects/worktrees/cancel-resolution.ts";

import { runCancelResolutionCli } from "./orchestrator/projects/worktrees/cancel-resolution.ts";

if (import.meta.main) {
  runCancelResolutionCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
