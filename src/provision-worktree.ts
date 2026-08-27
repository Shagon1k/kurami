export * from "./orchestrator/projects/worktrees/provision.ts";

import { runProvisionWorktreeCli } from "./orchestrator/projects/worktrees/provision.ts";

if (import.meta.main) {
  runProvisionWorktreeCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
