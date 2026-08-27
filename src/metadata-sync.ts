export * from "./orchestrator/projects/metadata/sync.ts";

import { runMetadataSyncCli } from "./orchestrator/projects/metadata/sync.ts";

if (import.meta.main) {
  runMetadataSyncCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
