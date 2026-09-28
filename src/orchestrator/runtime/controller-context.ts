import { resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";

export const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../.."),
);
export const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
export const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
export const provisionerPath = resolve(
  import.meta.dirname,
  "../projects/worktrees/provision.ts",
);
export const sessionManagerPath = resolve(
  import.meta.dirname,
  "../projects/sessions/manager.ts",
);
export const releaserPath = resolve(
  import.meta.dirname,
  "../projects/worktrees/release.ts",
);
export const previewManagerPath = resolve(
  import.meta.dirname,
  "../projects/previews/manager.ts",
);
export const previewRuntimePath = resolve(
  import.meta.dirname,
  "../projects/previews/runtime.ts",
);
export const cancelResolutionPath = resolve(
  import.meta.dirname,
  "../projects/worktrees/cancel-resolution.ts",
);
export const projectStatusPath = resolve(
  import.meta.dirname,
  "../projects/project-status.ts",
);
export const reviewManagerPath = resolve(
  import.meta.dirname,
  "../projects/reviews/manager.ts",
);
export const reviewFixManagerPath = resolve(
  import.meta.dirname,
  "../projects/reviews/fix-manager.ts",
);
export const autonomousSuccessorPath = resolve(
  import.meta.dirname,
  "../projects/sessions/autonomous-successor.ts",
);

export function fail(message: string): never {
  throw new Error(message);
}
