export * from "./orchestrator/projects/worktrees/release.ts";

import { runReleaseWorktreeCli } from "./orchestrator/projects/worktrees/release.ts";

if (import.meta.main) {
  runReleaseWorktreeCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
