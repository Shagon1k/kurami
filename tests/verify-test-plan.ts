// Test plan: registering a suite (only test:* scripts in package.json, only new entries in the runner's list)
// does not rerun everything, while any other change to those files still does.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registeredSuites } from "./test-plan.ts";

const repository = mkdtempSync(join(tmpdir(), "kurami-test-plan-"));
const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, env, encoding: "utf8" });
const pkg = (scripts: Record<string, string>, extra: Record<string, unknown> = {}) => writeFileSync(join(repository, "package.json"), JSON.stringify({ name: "x", ...extra, scripts }, null, 2));
const runner = (lines: string[]) => writeFileSync(join(repository, "tests/run-regression.ts"), `const suites = [\n${lines.map(line => `  "${line}",`).join("\n")}\n];\n`);
try {
  mkdirSync(join(repository, "tests"));
  git("init", "-q", "-b", "main");
  pkg({ test: "node tests/run-regression.ts", "test:a": "node a.ts" }); runner(["test:a"]);
  git("add", "."); git("commit", "-qm", "base"); git("branch", "base");

  pkg({ test: "node tests/run-regression.ts", "test:a": "node a.ts", "test:b": "node b.ts" }); runner(["test:a", "test:b"]);
  assert.deepEqual(registeredSuites(["package.json", "tests/run-regression.ts", "b.ts"], "base", repository), { changed: ["b.ts"], added: ["test:b"] }, "registration only");

  pkg({ test: "node tests/run-regression.ts --fast", "test:a": "node a.ts", "test:b": "node b.ts" });
  assert.deepEqual(registeredSuites(["package.json"], "base", repository).changed, ["package.json"], "a non-test script stays global");
  pkg({ "test:a": "node a.ts", test: "node tests/run-regression.ts" }, { dependencies: { yaml: "1" } });
  assert.deepEqual(registeredSuites(["package.json"], "base", repository).changed, ["package.json"], "dependencies stay global");
  pkg({ test: "node tests/run-regression.ts" });
  assert.deepEqual(registeredSuites(["package.json"], "base", repository).changed, ["package.json"], "removing a suite stays global");

  writeFileSync(join(repository, "tests/run-regression.ts"), `const suites = [\n  "test:a",\n];\nconst jobs = 4;\n`);
  assert.deepEqual(registeredSuites(["tests/run-regression.ts"], "base", repository).changed, ["tests/run-regression.ts"], "other runner edits stay global");
  console.log(JSON.stringify({ ok: true, testPlan: "registration narrowed; scripts, dependencies, removals and runner edits stay global" }));
} finally { rmSync(repository, { recursive: true, force: true }); }
