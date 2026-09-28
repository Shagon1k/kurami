import { resolve } from "node:path";
import { resolveKuramiHome } from "../core/kurami-home.ts";

export type BriefingPaths = {
  home: string;
  stateDirectory: string;
  pagesDirectory: string;
  previewDirectory: string;
  mediaDirectory: string;
  mediaInboxDirectory: string;
  databasePath: string;
  migrationsDirectory: string;
  runsDirectory: string;
  recoveryDirectory: string;
  artifactsDirectory: string;
  stateArtifactsDirectory: string;
};

export function briefingPaths(environment: NodeJS.ProcessEnv = process.env): BriefingPaths {
  const home = resolveKuramiHome(resolve(import.meta.dirname, "../../.."), environment);
  const stateDirectory = resolve(home, "state/briefing");
  return {
    home,
    stateDirectory,
    pagesDirectory: resolve(stateDirectory, "pages"),
    previewDirectory: resolve(stateDirectory, "pages/preview"),
    mediaDirectory: resolve(stateDirectory, "media"),
    mediaInboxDirectory: resolve(stateDirectory, "media-inbox"),
    databasePath: resolve(stateDirectory, "briefing.db"),
    migrationsDirectory: resolve(
      environment.BRIEFING_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../../migrations/briefing"),
    ),
    runsDirectory: resolve(stateDirectory, "runs"),
    recoveryDirectory: resolve(stateDirectory, "recovery"),
    artifactsDirectory: resolve(home, "artifacts/briefing"),
    stateArtifactsDirectory: resolve(stateDirectory, "artifacts"),
  };
}
