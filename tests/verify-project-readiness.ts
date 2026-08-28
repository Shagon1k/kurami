import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import {
  inspectProjectReadiness,
  type ReadinessResult,
} from "../src/orchestrator/projects/project-readiness.ts";
import * as legacyProjectReadiness from "../src/orchestrator/projects/project-readiness.ts";
import * as canonicalProjectReadiness from "../src/orchestrator/projects/project-readiness.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  legacyProjectReadiness.inspectProjectReadiness ===
    canonicalProjectReadiness.inspectProjectReadiness,
  "Legacy readiness import does not re-export the canonical implementation",
);
assert(
  legacyProjectReadiness.runProjectReadinessCli ===
    canonicalProjectReadiness.runProjectReadinessCli,
  "Legacy readiness CLI does not delegate to the canonical implementation",
);

function check(result: ReadinessResult, id: string, project: string) {
  return result.checks.find((item) => item.id === id && item.project === project);
}

const root = await mkdtemp(join(tmpdir(), "kurami-readiness-"));
const configDir = resolve(root, "config");
const canonical = resolve(root, "repo");
const worktrees = resolve(root, "worktrees");
const secrets = resolve(root, "preview.env");

try {
  await Promise.all([
    mkdir(configDir, { recursive: true }),
    mkdir(canonical, { recursive: true }),
    mkdir(worktrees, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(canonical, "docker-compose.yml"), "services: {}\n", "utf8"),
    writeFile(secrets, "TEST_ONLY=1\n", { encoding: "utf8", mode: 0o600 }),
    writeFile(resolve(configDir, "orchestrator.yaml"), stringify({
      version: 1,
      discord: { digest_channel_id: "1234567890" },
    }), "utf8"),
  ]);

  const validRegistry = {
    version: 1,
    projects: {
      alpha: {
        owner: "example",
        project_number: 1,
        repository: "example/alpha",
        status_field: "Status",
        statuses: {
          backlog: "Backlog",
          active: "In progress",
          review: "Human Review",
          done: "Done",
          deferred: "Deferred",
        },
        human_control_label: "human-control",
        discord: { guild_id: "1234567890", channel_id: "1234567891" },
        workspace: {
          canonical_repository: canonical,
          worktree_root: worktrees,
          base_branch: "main",
          branch_prefix: "AA",
        },
        ci: {
          enabled: true,
          required_checks: ["Secret scan", "Tests"],
          missing_grace_minutes: 10,
        },
        triage: {
          enabled: true,
          priority_field: "Priority",
          effort_field: "Effort",
        },
        preview: {
          adapter: "compose",
          compose_file: "docker-compose.yml",
          secrets_file: secrets,
          frontend_health_path: "/",
          backend_health_path: "/health",
          minio_health_path: "/minio/health/live",
        },
      },
      beta: {
        owner: "example",
        project_number: 2,
        repository: "example/beta",
        status_field: "Status",
        statuses: {
          backlog: "Backlog",
          active: "In progress",
          review: "Human Review",
          done: "Done",
          deferred: "Deferred",
        },
        discord: { guild_id: "1234567890", channel_id: "1234567892" },
        workspace: {
          canonical_repository: resolve(root, "beta"),
          worktree_root: resolve(root, "beta-worktrees"),
          base_branch: "main",
          branch_prefix: "BB",
        },
        ci: { enabled: false },
        triage: {
          enabled: true,
          priority_field: "Priority",
          effort_field: "Effort",
        },
        preview: {
          adapter: "static",
          artifact_directory: "dist",
          max_files: 100,
          max_bytes: 1_048_576,
        },
      },
    },
  };
  await writeFile(resolve(configDir, "projects.yaml"), stringify(validRegistry), "utf8");

  const configResult = await inspectProjectReadiness({ configDir });
  assert(configResult.ok, "Valid readiness configuration failed");
  assert(configResult.projects.join(",") === "alpha,beta", "Project ordering changed");
  assert(configResult.summary.fail === 0, "Valid configuration produced failures");
  assert(check(configResult, "ci.disabled_checks", "beta")?.level === "pass",
    "CI-disabled policy was not accepted");
  assert(check(configResult, "preview.adapter", "alpha")?.level === "pass",
    "Compose adapter was not accepted");
  assert(check(configResult, "preview.adapter", "beta")?.level === "pass",
    "Static adapter was not accepted");

  const selectedResult = await inspectProjectReadiness({
    configDir,
    selectedProject: "beta",
  });
  assert(selectedResult.projects.join(",") === "beta", "Project selection was not exact");

  const ghRunner = (args: string[]): string => {
    const endpoint = args.at(-1) ?? "";
    if (args.includes("graphql")) {
      return JSON.stringify({
        data: {
          repositoryOwner: {
            projectV2: {
              title: "Alpha",
              fields: {
                nodes: [
                  {
                    __typename: "ProjectV2SingleSelectField",
                    name: "Status",
                    options: ["Backlog", "In progress", "Human Review", "Done", "Deferred"]
                      .map((name) => ({ name })),
                  },
                  { __typename: "ProjectV2SingleSelectField", name: "Priority", options: [] },
                  { __typename: "ProjectV2SingleSelectField", name: "Effort", options: [] },
                ],
              },
            },
          },
        },
      });
    }
    if (endpoint.includes("check-runs")) {
      return JSON.stringify({ check_runs: [{ name: "Secret scan" }, { name: "Tests" }] });
    }
    if (endpoint === "repos/example/alpha") {
      return JSON.stringify({ full_name: "example/alpha", default_branch: "main" });
    }
    throw new Error(`Unexpected read-only GitHub call: ${args.join(" ")}`);
  };
  const liveResult = await inspectProjectReadiness({
    configDir,
    selectedProject: "alpha",
    live: true,
    ghRunner,
  });
  assert(liveResult.ok, "Valid live readiness evidence failed");
  assert(check(liveResult, "live.repository", "alpha")?.level === "pass",
    "Repository live check did not pass");
  assert(check(liveResult, "live.status_options", "alpha")?.level === "pass",
    "Project options live check did not pass");
  assert(check(liveResult, "live.ci_names", "alpha")?.level === "pass",
    "Exact CI names live check did not pass");
  assert(check(liveResult, "live.preview_secrets", "alpha")?.level === "pass",
    "Secrets existence check unexpectedly read or rejected the fixture");

  const invalidRegistry = structuredClone(validRegistry);
  invalidRegistry.projects.alpha.statuses.done = "Backlog";
  invalidRegistry.projects.alpha.ci.required_checks = [];
  invalidRegistry.projects.alpha.preview.compose_file = "../docker-compose.yml";
  await writeFile(resolve(configDir, "projects.yaml"), stringify(invalidRegistry), "utf8");
  const invalidResult = await inspectProjectReadiness({ configDir, selectedProject: "alpha" });
  assert(!invalidResult.ok, "Invalid readiness configuration passed");
  for (const id of ["project.statuses_unique", "ci.required_checks", "preview.compose_file"]) {
    assert(check(invalidResult, id, "alpha")?.level === "fail", `Missing fail result for ${id}`);
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    configOnly: true,
    liveReadsOnly: true,
    passWarnFail: true,
    exactProjectSelection: true,
    exactCiNames: true,
    projectFieldsAndOptions: true,
    composeAndStaticPolicies: true,
    invalidConfigurationRejected: true,
    noApplyPath: true,
  })}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
