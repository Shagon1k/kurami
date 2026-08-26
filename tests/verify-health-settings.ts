import { strict as assert } from "node:assert";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "kurami-health-settings-"));
const fakeHermes = join(root, "hermes");
const callLog = join(root, "hermes-args.log");
await writeFile(
  fakeHermes,
  '#!/bin/sh\nprintf "%s\\n" "$@" > "$HEALTH_TEST_LOG"\n',
  { mode: 0o700 },
);
await chmod(fakeHermes, 0o700);
const cli = resolve(import.meta.dirname, "../src/health-settings.ts");
const env = {
  ...process.env,
  ORCHESTRATOR_HOME: root,
  HERMES_HOME: root,
  HERMES_BIN: fakeHermes,
  HEALTH_TEST_LOG: callLog,
};
const run = (args: string[]): Record<string, unknown> =>
  JSON.parse(execFileSync(process.execPath, [cli, ...args], { env, encoding: "utf8" }));

const initial = run(["status"]);
assert.equal(initial.revision, 0);
assert.equal(initial.intervalMinutes, 20);

const applied = run([
  "apply",
  "--minutes", "20",
  "--expected-revision", "0",
  "--actor-id", "234723725168082944",
]);
assert.equal(applied.action, "applied");
assert.equal(applied.revision, 1);
const args = await readFile(callLog, "utf8");
assert(args.includes("cron\nedit\nee530a53db44\n--schedule\n*/20 * * * *"));

const stale = spawnSync(
  process.execPath,
  [
    cli,
    "apply",
    "--minutes", "30",
    "--expected-revision", "0",
    "--actor-id", "234723725168082944",
  ],
  { env, encoding: "utf8" },
);
assert.notEqual(stale.status, 0);
assert(stale.stderr.includes("changed since this panel opened"));

const changed = run([
  "apply",
  "--minutes", "30",
  "--expected-revision", "1",
  "--actor-id", "234723725168082944",
]);
assert.equal(changed.intervalMinutes, 30);
assert.equal(changed.revision, 2);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    ownerBounded: true,
    optimisticRevision: true,
    allowedIntervals: initial.allowedIntervals,
    cronEditedInPlace: true,
  })}\n`,
);
