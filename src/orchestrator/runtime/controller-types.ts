import type { RuntimeSettingsBaseConfig } from "../settings/runtime-settings.ts";
import type { RunRow } from "./run-read-model.ts";

export type OrchestratorConfig = RuntimeSettingsBaseConfig & {
  limits: RuntimeSettingsBaseConfig["limits"] & {
    max_llm_running_global: number;
    preview_expiry_warning_hours: number;
    main_writer_timeout_minutes: number;
    technical_worker_timeout_minutes: number;
  };
};

export type ProjectConfig = {
  statuses: { backlog: string; active: string; review: string };
};

export type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

export type ProgressRow = RunRow & {
  title: string | null;
  repository: string;
};
