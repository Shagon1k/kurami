// The project list comes from config/projects.yaml: registry order, the repository's name, an allowed icon or
// the generic one, an allowed colour or the next by order; malformed entries are skipped; the poller accepts exactly the registered keys; and no
// product code keeps its own copy of the project names.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registeredProjects } from "../src/core/projects-registry.ts";

const app = resolve(import.meta.dirname, ".."), home = mkdtempSync(join(tmpdir(), "kurami-registry-"));
try {
  mkdirSync(join(home, "config"));
  writeFileSync(join(home, "config/projects.yaml"), `version: 1\nprojects:\n  zeta:\n    repository: Owner/Zeta-App\n    icon: fox\n    color: pink\n  alpha:\n    repository: Owner/Alpha\n    icon: rocket\n    color: red\n  "Bad Key":\n    repository: Owner/Bad\n  beta:\n    repository: not a repository\n`);
  assert.deepEqual(registeredProjects(home), [{ key: "zeta", name: "Zeta-App", repository: "Owner/Zeta-App", icon: "fox", color: "pink" }, { key: "alpha", name: "Alpha", repository: "Owner/Alpha", icon: "project", color: "teal" }], "red is not a project hue: alpha takes the second by order");
  assert.equal(execFileSync(process.execPath, [resolve(app, "src/core/projects-registry.ts"), "keys"], { env: { ...process.env, KURAMI_HOME: home }, encoding: "utf8" }), "zeta\nalpha\n");

  // The shipped registry template names every project's icon and a colour of its own.
  const template = registeredProjects(resolve(app, "deploy")), raw = readFileSync(resolve(app, "deploy/config/projects.yaml"), "utf8");
  for (const project of template) assert.notEqual(project.icon, "project", `${project.key} has an icon in the template`);
  assert.equal(raw.match(/^    color: /gm)?.length, template.length, "every template project names its colour");
  assert.equal(new Set(template.map(project => project.color)).size, template.length, "template colours are distinct");

  // The poller refuses keys outside the registry before touching anything.
  const poller = spawnSync("bash", [resolve(app, "run-project-poller.sh"), "../../etc"], { encoding: "utf8" });
  assert.equal(poller.status, 64);
  // ...and accepts a registered one. The gate (the script up to its key check) runs against a scratch home,
  // so nothing is polled; KURAMI_HOME is readonly there, which once made every key fail.
  const script = readFileSync(resolve(app, "run-project-poller.sh"), "utf8"), gateEnd = script.indexOf("\nfi\n", script.indexOf("projects-registry.ts")) + 4;
  mkdirSync(join(home, "runtime/node/bin"), { recursive: true });
  execFileSync("ln", ["-s", process.execPath, join(home, "runtime/node/bin/node")]);
  execFileSync("ln", ["-s", app, join(home, "app")]);
  const gate = join(home, "gate.sh");
  writeFileSync(gate, script.slice(0, gateEnd).replace('readonly KURAMI_HOME="/home/shagon1k/_hermes/_kurami"', `readonly KURAMI_HOME="${home}"`) + 'echo accepted\n');
  const accepted = spawnSync("bash", [gate, "zeta"], { encoding: "utf8" });
  assert.deepEqual([accepted.status, accepted.stdout.trim(), accepted.stderr], [0, "accepted", ""], "a registered key passes the gate");
  assert.equal(spawnSync("bash", [gate, "beta"], { encoding: "utf8" }).status, 64, "a skipped (malformed) entry does not");

  for (const file of ["src/hub/snapshot.ts", "src/hub/render.ts", "src/projects-site/render.ts", "run-project-poller.sh"])
    assert.doesNotMatch(readFileSync(resolve(app, file), "utf8"), /pickflick|tailortales|ahurynovich/i, `${file} has no hard-coded project list`);
  console.log(JSON.stringify({ ok: true, registry: "order, names, icons, colours, skipped entries, poller keys, no copies" }));
} finally { rmSync(home, { recursive: true, force: true }); }
