import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { loadOwnerGitHubTokenFromFile } from "./github-app-auth.ts";

process.umask(0o077);

export type ReadinessLevel = "pass" | "warn" | "fail";

export type ReadinessCheck = {
  id: string;
  level: ReadinessLevel;
  project: string | null;
  message: string;
};

export type ReadinessResult = {
  ok: boolean;
  mode: "config" | "live";
  projects: string[];
  summary: Record<ReadinessLevel, number>;
  checks: ReadinessCheck[];
};

type UnknownRecord = Record<string, unknown>;
type GhRunner = (args: string[]) => string;

export type ReadinessOptions = {
  configDir: string;
  selectedProject?: string | null;
  live?: boolean;
  ghRunner?: GhRunner;
};

type ParsedArguments = {
  configDir: string;
  selectedProject: string | null;
  live: boolean;
  json: boolean;
};

const PROJECT_QUERY = String.raw`
  query ReadinessProject($login: String!, $number: Int!) {
    repositoryOwner(login: $login) {
      ... on User {
        projectV2(number: $number) {
          title
          fields(first: 100) {
            nodes {
              __typename
              ... on ProjectV2Field { name }
              ... on ProjectV2SingleSelectField {
                name
                options { name }
              }
            }
          }
        }
      }
      ... on Organization {
        projectV2(number: $number) {
          title
          fields(first: 100) {
            nodes {
              __typename
              ... on ProjectV2Field { name }
              ... on ProjectV2SingleSelectField {
                name
                options { name }
              }
            }
          }
        }
      }
    }
  }
`;

function fail(message: string): never {
  throw new Error(message);
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function stringValue(record: UnknownRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(record: UnknownRecord | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(record: UnknownRecord | null, key: string): boolean | null {
  const value = record?.[key];
  return typeof value === "boolean" ? value : null;
}

function add(
  checks: ReadinessCheck[],
  id: string,
  level: ReadinessLevel,
  message: string,
  project: string | null = null,
): void {
  checks.push({ id, level, project, message });
}

function assertCheck(
  checks: ReadinessCheck[],
  condition: boolean,
  id: string,
  passMessage: string,
  failMessage: string,
  project: string | null = null,
): void {
  add(checks, id, condition ? "pass" : "fail", condition ? passMessage : failMessage, project);
}

function safeRelativePath(value: string | null): boolean {
  return Boolean(
    value &&
    !isAbsolute(value) &&
    !value.split(/[\\/]/u).some((segment) => segment === ".." || segment === ""),
  );
}

function authenticatedGhRunner(token: string): GhRunner {
  return (args: string[]): string => execFileSync("gh", args, {
    encoding: "utf8",
    env: { ...process.env, GH_TOKEN: token },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseJson(value: string, context: string): UnknownRecord {
  try {
    const parsed = asRecord(JSON.parse(value));
    if (!parsed) fail(`${context} returned a non-object response`);
    return parsed;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) fail(`${context} returned invalid JSON`);
    throw error;
  }
}

function validateProjectConfig(
  key: string,
  project: UnknownRecord,
  orchestrator: UnknownRecord,
  checks: ReadinessCheck[],
): void {
  const owner = stringValue(project, "owner");
  const repository = stringValue(project, "repository");
  const projectNumber = numberValue(project, "project_number");
  const statusField = stringValue(project, "status_field");

  assertCheck(checks, /^[a-z0-9-]+$/u.test(key), "identity.registry_key",
    `Registry key ${key} is stable`, `Registry key ${key} must use lowercase letters, digits, and hyphens`, key);
  assertCheck(checks, Boolean(owner), "identity.owner", "GitHub owner is configured",
    "GitHub owner is missing", key);
  assertCheck(checks, Boolean(repository && /^[^/]+\/[^/]+$/u.test(repository)),
    "identity.repository", "Repository identity is configured", "Repository must be owner/name", key);
  assertCheck(checks, Boolean(owner && repository?.split("/")[0]?.toLowerCase() === owner.toLowerCase()),
    "identity.repository_owner", "Repository owner matches project owner",
    "Repository owner must match the configured project owner", key);
  assertCheck(checks, Boolean(Number.isInteger(projectNumber) && projectNumber! > 0),
    "identity.project_number", "GitHub Project number is valid",
    "GitHub Project number must be a positive integer", key);
  assertCheck(checks, Boolean(statusField), "project.status_field", "Status field is configured",
    "Status field is missing", key);

  const statuses = asRecord(project.statuses);
  const statusNames = ["backlog", "active", "review", "done", "deferred"]
    .map((name) => stringValue(statuses, name));
  assertCheck(checks, statusNames.every(Boolean), "project.statuses",
    "All lifecycle statuses are configured", "Backlog/active/review/done/deferred statuses are required", key);
  assertCheck(checks, new Set(statusNames.filter(Boolean)).size === statusNames.filter(Boolean).length,
    "project.statuses_unique", "Lifecycle statuses are distinct",
    "Lifecycle status values must be distinct", key);

  const discord = asRecord(project.discord);
  assertCheck(checks, /^\d{5,30}$/u.test(stringValue(discord, "guild_id") ?? ""),
    "discord.guild", "Discord guild is allowlisted", "Discord guild_id is missing or invalid", key);
  assertCheck(checks, /^\d{5,30}$/u.test(stringValue(discord, "channel_id") ?? ""),
    "discord.channel", "Discord project channel is configured",
    "Discord project channel_id is missing or invalid", key);
  const globalDiscord = asRecord(orchestrator.discord);
  assertCheck(checks, /^\d{5,30}$/u.test(stringValue(globalDiscord, "digest_channel_id") ?? ""),
    "discord.digest", "Global Projects Digest channel is configured",
    "Global discord.digest_channel_id is missing or invalid", key);

  const workspace = asRecord(project.workspace);
  const canonicalRepository = stringValue(workspace, "canonical_repository");
  const worktreeRoot = stringValue(workspace, "worktree_root");
  const baseBranch = stringValue(workspace, "base_branch");
  const branchPrefix = stringValue(workspace, "branch_prefix");
  assertCheck(checks, Boolean(canonicalRepository && isAbsolute(canonicalRepository)),
    "workspace.canonical", "Canonical repository path is absolute",
    "workspace.canonical_repository must be absolute", key);
  assertCheck(checks, Boolean(worktreeRoot && isAbsolute(worktreeRoot)),
    "workspace.worktree_root", "Worktree root path is absolute",
    "workspace.worktree_root must be absolute", key);
  assertCheck(checks, Boolean(canonicalRepository && worktreeRoot && canonicalRepository !== worktreeRoot),
    "workspace.separate", "Canonical repository and worktree root are separate",
    "Canonical repository cannot also be the worktree root", key);
  assertCheck(checks, Boolean(baseBranch && /^[A-Za-z0-9._/-]+$/u.test(baseBranch)),
    "workspace.base_branch", "Base branch is configured", "Base branch is missing or unsafe", key);
  assertCheck(checks, Boolean(branchPrefix && /^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/u.test(branchPrefix)),
    "workspace.branch_prefix", "Branch prefix is safe", "Branch prefix is missing or unsafe", key);

  const ci = asRecord(project.ci);
  const ciEnabled = booleanValue(ci, "enabled");
  assertCheck(checks, ciEnabled !== null, "ci.mode", "CI mode is explicit",
    "ci.enabled must be true or false", key);
  if (ciEnabled === true) {
    const requiredChecks = Array.isArray(ci?.required_checks)
      ? ci.required_checks.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      : [];
    assertCheck(checks, requiredChecks.length > 0, "ci.required_checks",
      "Required CI check names are configured", "CI-enabled projects require exact check names", key);
    assertCheck(checks, new Set(requiredChecks).size === requiredChecks.length,
      "ci.required_checks_unique", "Required CI check names are unique",
      "Required CI check names must be unique", key);
    const grace = numberValue(ci, "missing_grace_minutes");
    assertCheck(checks, Boolean(Number.isInteger(grace) && grace! >= 1 && grace! <= 60),
      "ci.missing_grace", "Missing-check grace is bounded",
      "ci.missing_grace_minutes must be an integer from 1 to 60", key);
  } else if (ciEnabled === false) {
    const configuredChecks = Array.isArray(ci?.required_checks) ? ci.required_checks.length : 0;
    assertCheck(checks, configuredChecks === 0, "ci.disabled_checks",
      "CI-disabled project has no contradictory required checks",
      "Remove required_checks or enable CI", key);
  }

  const triage = asRecord(project.triage);
  const triageEnabled = booleanValue(triage, "enabled");
  if (triageEnabled === true) {
    assertCheck(checks, Boolean(stringValue(triage, "priority_field")),
      "triage.priority", "Priority field is configured", "Triage needs priority_field", key);
    assertCheck(checks, Boolean(stringValue(triage, "effort_field")),
      "triage.effort", "Effort field is configured", "Triage needs effort_field", key);
  } else {
    add(checks, "triage.mode", "warn", "Triage is disabled; the project will not receive ranked metadata guidance", key);
  }

  const preview = asRecord(project.preview);
  if (!preview) {
    add(checks, "preview.mode", "warn", "Preview is not configured; Start preview will be unavailable", key);
    return;
  }
  const adapter = stringValue(preview, "adapter");
  assertCheck(checks, adapter === "compose" || adapter === "static", "preview.adapter",
    `Preview adapter ${adapter ?? ""} is supported`, "Preview adapter must be compose or static", key);
  if (adapter === "compose") {
    assertCheck(checks, safeRelativePath(stringValue(preview, "compose_file")),
      "preview.compose_file", "Compose file path is repository-relative and safe",
      "Compose preview needs a safe repository-relative compose_file", key);
    assertCheck(checks, Boolean(stringValue(preview, "secrets_file") && isAbsolute(stringValue(preview, "secrets_file")!)),
      "preview.secrets_file", "Compose secrets path is absolute",
      "Compose preview needs an absolute secrets_file outside Git", key);
    for (const field of ["frontend_health_path", "backend_health_path", "minio_health_path"]) {
      assertCheck(checks, Boolean(stringValue(preview, field)?.startsWith("/")),
        `preview.${field}`, `${field} is an absolute HTTP path`, `${field} must start with /`, key);
    }
  } else if (adapter === "static") {
    assertCheck(checks, safeRelativePath(stringValue(preview, "artifact_directory")),
      "preview.artifact_directory", "Static artifact directory is repository-relative and safe",
      "Static preview needs a safe repository-relative artifact_directory", key);
    const maxFiles = numberValue(preview, "max_files");
    const maxBytes = numberValue(preview, "max_bytes");
    assertCheck(checks, Boolean(Number.isInteger(maxFiles) && maxFiles! >= 1 && maxFiles! <= 10_000),
      "preview.max_files", "Static file count is bounded", "preview.max_files must be from 1 to 10000", key);
    assertCheck(checks, Boolean(Number.isInteger(maxBytes) && maxBytes! >= 1024 && maxBytes! <= 1_073_741_824),
      "preview.max_bytes", "Static artifact size is bounded",
      "preview.max_bytes must be from 1 KiB to 1 GiB", key);
  }
}

function inspectLiveProject(
  key: string,
  project: UnknownRecord,
  checks: ReadinessCheck[],
  gh: GhRunner,
): void {
  const owner = stringValue(project, "owner");
  const repository = stringValue(project, "repository");
  const projectNumber = numberValue(project, "project_number");
  const workspace = asRecord(project.workspace);
  const canonicalRepository = stringValue(workspace, "canonical_repository");
  const worktreeRoot = stringValue(workspace, "worktree_root");
  const baseBranch = stringValue(workspace, "base_branch");

  if (!owner || !repository || !projectNumber || !baseBranch) return;
  try {
    const repo = parseJson(gh(["api", `repos/${repository}`]), "GitHub repository lookup");
    assertCheck(checks, stringValue(repo, "full_name")?.toLowerCase() === repository.toLowerCase(),
      "live.repository", "GitHub repository is readable", "GitHub repository identity did not match", key);
    const defaultBranch = stringValue(repo, "default_branch");
    assertCheck(checks, defaultBranch === baseBranch, "live.base_branch",
      "Configured base branch matches GitHub default branch",
      `Configured base branch ${baseBranch} differs from GitHub default ${defaultBranch ?? "unknown"}`, key);
  } catch (error: unknown) {
    add(checks, "live.repository", "fail", `GitHub repository lookup failed: ${error instanceof Error ? error.message : String(error)}`, key);
  }

  try {
    const response = parseJson(gh([
      "api", "graphql", "--field", `query=${PROJECT_QUERY}`,
      "--field", `login=${owner}`, "--field", `number=${projectNumber}`,
    ]), "GitHub Project lookup");
    const data = asRecord(response.data);
    const repositoryOwner = asRecord(data?.repositoryOwner);
    const projectData = asRecord(repositoryOwner?.projectV2);
    assertCheck(checks, Boolean(projectData), "live.project", "GitHub Project is readable",
      "GitHub Project is missing or inaccessible", key);
    if (projectData) {
      const fields = asRecord(projectData.fields);
      const nodes = Array.isArray(fields?.nodes) ? fields.nodes.map(asRecord).filter(Boolean) as UnknownRecord[] : [];
      const statusField = stringValue(project, "status_field");
      const statusNode = nodes.find((node) => stringValue(node, "name") === statusField);
      assertCheck(checks, Boolean(statusNode), "live.status_field",
        "Configured status field exists in GitHub Project", "Configured status field is absent from GitHub Project", key);
      if (statusNode) {
        const options = Array.isArray(statusNode.options)
          ? statusNode.options.map(asRecord).filter(Boolean).map((option) => stringValue(option, "name")).filter(Boolean)
          : [];
        const statuses = asRecord(project.statuses);
        const configured = ["backlog", "active", "review", "done", "deferred"]
          .map((name) => stringValue(statuses, name)).filter((value): value is string => Boolean(value));
        const missing = configured.filter((value) => !options.includes(value));
        assertCheck(checks, missing.length === 0, "live.status_options",
          "Configured lifecycle status options exist", `Missing Project status options: ${missing.join(", ")}`, key);
      }
      const triage = asRecord(project.triage);
      if (booleanValue(triage, "enabled") === true) {
        for (const field of ["priority_field", "effort_field"]) {
          const name = stringValue(triage, field);
          assertCheck(checks, Boolean(name && nodes.some((node) => stringValue(node, "name") === name)),
            `live.${field}`, `Configured ${field} exists`, `Configured ${field} is absent from GitHub Project`, key);
        }
      }
    }
  } catch (error: unknown) {
    add(checks, "live.project", "fail", `GitHub Project lookup failed: ${error instanceof Error ? error.message : String(error)}`, key);
  }

  const ci = asRecord(project.ci);
  if (booleanValue(ci, "enabled") === true) {
    try {
      const response = parseJson(gh([
        "api", "-H", "Accept: application/vnd.github+json",
        `repos/${repository}/commits/${encodeURIComponent(baseBranch)}/check-runs?per_page=100`,
      ]), "GitHub check-runs lookup");
      const observed = Array.isArray(response.check_runs)
        ? response.check_runs.map(asRecord).filter(Boolean).map((run) => stringValue(run, "name")).filter(Boolean)
        : [];
      const required = Array.isArray(ci?.required_checks)
        ? ci.required_checks.filter((value): value is string => typeof value === "string")
        : [];
      const missing = required.filter((name) => !observed.includes(name));
      add(checks, "live.ci_names", missing.length === 0 ? "pass" : "warn",
        missing.length === 0
          ? "Exact configured CI check names were observed on the base branch"
          : `Checks not observed on the base branch (confirm on a representative PR): ${missing.join(", ")}`, key);
    } catch (error: unknown) {
      add(checks, "live.ci_names", "warn", `Could not compare live CI names: ${error instanceof Error ? error.message : String(error)}`, key);
    }
  } else {
    add(checks, "live.ci_names", "pass", "CI check evaluation is explicitly disabled; exact PR head provenance still applies", key);
  }

  add(checks, "live.canonical_path", canonicalRepository && existsSync(canonicalRepository) ? "pass" : "warn",
    canonicalRepository && existsSync(canonicalRepository)
      ? "Canonical repository path exists on this host"
      : "Canonical repository path is not present on this host", key);
  add(checks, "live.worktree_root", worktreeRoot && existsSync(worktreeRoot) ? "pass" : "warn",
    worktreeRoot && existsSync(worktreeRoot)
      ? "Managed worktree root exists on this host"
      : "Managed worktree root is not present on this host", key);

  const preview = asRecord(project.preview);
  if (stringValue(preview, "adapter") === "compose" && canonicalRepository) {
    const composeFile = stringValue(preview, "compose_file");
    const secretsFile = stringValue(preview, "secrets_file");
    add(checks, "live.compose_file", composeFile && existsSync(resolve(canonicalRepository, composeFile)) ? "pass" : "fail",
      composeFile && existsSync(resolve(canonicalRepository, composeFile))
        ? "Compose file exists in the canonical repository"
        : "Configured Compose file is missing", key);
    add(checks, "live.preview_secrets", secretsFile && existsSync(secretsFile) ? "pass" : "warn",
      secretsFile && existsSync(secretsFile)
        ? "Preview secrets file exists without being read"
        : "Preview secrets file is not present on this host", key);
  }
}

export async function inspectProjectReadiness(options: ReadinessOptions): Promise<ReadinessResult> {
  const configDir = resolve(options.configDir);
  const [orchestratorText, projectsText] = await Promise.all([
    readFile(resolve(configDir, "orchestrator.yaml"), "utf8"),
    readFile(resolve(configDir, "projects.yaml"), "utf8"),
  ]);
  const orchestrator = asRecord(parse(orchestratorText));
  const registry = asRecord(parse(projectsText));
  if (!orchestrator || !registry) fail("Configuration roots must be YAML objects");
  const checks: ReadinessCheck[] = [];
  assertCheck(checks, orchestrator.version === 1, "config.orchestrator_version",
    "Orchestrator config version is supported", "orchestrator.yaml version must be 1");
  assertCheck(checks, registry.version === 1, "config.registry_version",
    "Project registry version is supported", "projects.yaml version must be 1");
  const projects = asRecord(registry.projects);
  if (!projects || Object.keys(projects).length === 0) fail("Project registry is empty");
  const selected = options.selectedProject?.trim() || null;
  if (selected && !(selected in projects)) {
    add(checks, "config.selected_project", "fail", `Unknown project registry key: ${selected}`);
  }
  const keys = Object.keys(projects).filter((key) => !selected || key === selected).sort();
  const gh = options.live
    ? options.ghRunner ?? authenticatedGhRunner(
      await loadOwnerGitHubTokenFromFile(resolve(configDir, "..")),
    )
    : null;
  for (const key of keys) {
    const project = asRecord(projects[key]);
    if (!project) {
      add(checks, "config.project_shape", "fail", "Project entry must be a YAML object", key);
      continue;
    }
    validateProjectConfig(key, project, orchestrator, checks);
    if (gh) inspectLiveProject(key, project, checks, gh);
  }
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const check of checks) summary[check.level] += 1;
  return {
    ok: summary.fail === 0,
    mode: options.live ? "live" : "config",
    projects: keys,
    summary,
    checks,
  };
}

function parseArguments(args: string[]): ParsedArguments {
  const kuramiHome = process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME;
  const defaultConfigDir = kuramiHome
    ? resolve(kuramiHome, "config")
    : resolve(import.meta.dirname, "../deploy/config");
  const parsed: ParsedArguments = {
    configDir: defaultConfigDir,
    selectedProject: null,
    live: false,
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--live") parsed.live = true;
    else if (flag === "--json") parsed.json = true;
    else if (flag === "--project" || flag === "--config-dir") {
      const value = args[index + 1];
      if (!value) fail(`${flag} requires a value`);
      if (flag === "--project") parsed.selectedProject = value;
      else parsed.configDir = resolve(value);
      index += 1;
    } else {
      fail("Usage: project-readiness.ts [--project key] [--config-dir path] [--live] [--json]");
    }
  }
  return parsed;
}

function formatHuman(result: ReadinessResult): string {
  const lines = [
    `Kurami project readiness · ${result.mode} · ${result.projects.join(", ") || "no matching project"}`,
  ];
  for (const check of result.checks) {
    const prefix = check.project ? `${check.project} · ` : "";
    lines.push(`${check.level.toUpperCase()} · ${prefix}${check.message}`);
  }
  lines.push(
    `Result: ${result.ok ? "PASS" : "FAIL"} · ${result.summary.pass} pass · ${result.summary.warn} warn · ${result.summary.fail} fail`,
  );
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const result = await inspectProjectReadiness({
    configDir: args.configDir,
    selectedProject: args.selectedProject,
    live: args.live,
  });
  process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : formatHuman(result));
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}
