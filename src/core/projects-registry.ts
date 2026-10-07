// The managed projects, in one place: config/projects.yaml. Order, display names and icons used to be
// repeated in Hub, Projects and the poller script; adding a project meant finding every copy. The registry
// order is the display order, the name is the repository's own, and `icon` (optional) picks a library icon.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

export type RegisteredProject = { key: string; name: string; repository: string; icon: string };
/** Icons a project may choose; anything else falls back to the generic project icon. */
export const PROJECT_ICONS = ["project", "panda", "fox", "profile", "projects", "book", "news", "cinema", "chart"] as const;

export function registeredProjects(home: string): RegisteredProject[] {
  const raw = parse(readFileSync(resolve(home, "config/projects.yaml"), "utf8")) as { projects?: Record<string, { repository?: unknown; icon?: unknown }> };
  return Object.entries(raw?.projects ?? {}).flatMap(([key, project]) => {
    if (!/^[a-z0-9-]{1,64}$/.test(key) || typeof project?.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(project.repository)) return [];
    const icon = typeof project.icon === "string" && (PROJECT_ICONS as readonly string[]).includes(project.icon) ? project.icon : "project";
    return [{ key, name: project.repository.split("/")[1]!, repository: project.repository, icon }];
  });
}

/** `keys`: one project key per line, for shell scripts (run-project-poller.sh). */
if (import.meta.main) {
  if (process.argv[2] !== "keys") { process.stderr.write("Usage: projects-registry.ts keys\n"); process.exitCode = 2; }
  else process.stdout.write(registeredProjects(process.env.KURAMI_HOME ?? "/home/shagon1k/_hermes/_kurami").map(project => project.key).join("\n") + "\n");
}
