// The managed projects, in one place: config/projects.yaml. Order, display names and icons used to be
// repeated in Hub, Projects and the poller script; adding a project meant finding every copy. The registry
// order is the display order, the name is the repository's own, `icon` (optional) picks a library icon and
// `color` (optional) one of the library's project hues; without it the hue follows the registry order.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { projectColors, type ProjectColor } from "../ui-library/tokens/index.ts";

export type RegisteredProject = { key: string; name: string; repository: string; icon: string; color: ProjectColor };
/** Icons a project may choose; anything else falls back to the generic project icon. */
export const PROJECT_ICONS = ["project", "panda", "fox", "profile", "projects", "book", "news", "cinema", "chart"] as const;

/** The project's hue: its own `color` when it names a library hue, otherwise the next one by registry order. */
export function projectColor(value: unknown, index: number): ProjectColor {
  return typeof value === "string" && (projectColors as readonly string[]).includes(value) ? value as ProjectColor : projectColors[index % projectColors.length]!;
}

export function registeredProjects(home: string): RegisteredProject[] {
  const raw = parse(readFileSync(resolve(home, "config/projects.yaml"), "utf8")) as { projects?: Record<string, { repository?: unknown; icon?: unknown; color?: unknown }> };
  return Object.entries(raw?.projects ?? {}).flatMap(([key, project], index) => {
    if (!/^[a-z0-9-]{1,64}$/.test(key) || typeof project?.repository !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(project.repository)) return [];
    const icon = typeof project.icon === "string" && (PROJECT_ICONS as readonly string[]).includes(project.icon) ? project.icon : "project";
    return [{ key, name: project.repository.split("/")[1]!, repository: project.repository, icon, color: projectColor(project.color, index) }];
  });
}

/** `keys`: one project key per line, for shell scripts (run-project-poller.sh). */
if (import.meta.main) {
  if (process.argv[2] !== "keys") { process.stderr.write("Usage: projects-registry.ts keys\n"); process.exitCode = 2; }
  else process.stdout.write(registeredProjects(process.env.KURAMI_HOME ?? "/home/shagon1k/_hermes/_kurami").map(project => project.key).join("\n") + "\n");
}
