export * from "./orchestrator/projects/sessions/runtime-budget.ts";

import { runRuntimeBudgetCli } from "./orchestrator/projects/sessions/runtime-budget.ts";

if (import.meta.main) {
  runRuntimeBudgetCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
