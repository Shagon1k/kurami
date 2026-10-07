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

  for (const file of ["src/hub/snapshot.ts", "src/hub/render.ts", "src/projects-site/render.ts", "run-project-poller.sh"])
    assert.doesNotMatch(readFileSync(resolve(app, file), "utf8"), /pickflick|tailortales|ahurynovich/i, `${file} has no hard-coded project list`);
  console.log(JSON.stringify({ ok: true, registry: "order, names, icons, colours, skipped entries, poller keys, no copies" }));
} finally { rmSync(home, { recursive: true, force: true }); }
