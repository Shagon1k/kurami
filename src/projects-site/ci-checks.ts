import type { CiCheck } from "./model.ts";

/** Only link to check evidence in the configured GitHub repository. Keep supplied job/step anchors. */
export function ciCheckUrl(raw: unknown, repository: string): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    const prefix = `/${repository}/`;
    if (url.origin !== "https://github.com" || url.username || url.password || !url.pathname.startsWith(prefix)) return null;
    const path = url.pathname.slice(prefix.length);
    return /^(?:actions\/runs\/[1-9][0-9]*(?:\/|$)|runs\/[1-9][0-9]*(?:\/|$)|checks(?:\/|$)|commit\/[a-f0-9]+\/checks(?:\/|$)|pull\/[1-9][0-9]*\/checks(?:\/|$))/.test(path) ? url.href : null;
  } catch { return null; }
}

export function parseCiChecks(raw: string | null, repository: string): CiCheck[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: unknown): CiCheck[] => {
      if (!entry || typeof entry !== "object") return [];
      const check = entry as Record<string, unknown>;
      if (typeof check.name !== "string" || !check.name.trim()) return [];
      const state = ["passed", "failed", "pending", "missing", "unknown"].includes(String(check.state)) ? check.state as CiCheck["state"] : "unknown";
      return [{ name: check.name, state, detailsUrl: ciCheckUrl(check.detailsUrl, repository) }];
    });
  } catch { return []; }
}
