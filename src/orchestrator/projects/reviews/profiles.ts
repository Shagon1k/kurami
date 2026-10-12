import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const REVIEW_PROFILES = ["general", "clarity"] as const;
export type ReviewProfile = typeof REVIEW_PROFILES[number];
export function parseReviewProfile(value: unknown = "general"): ReviewProfile {
  if (value !== "general" && value !== "clarity") throw new Error("Unsupported review profile");
  return value;
}
export function reviewSignature(profile: ReviewProfile): string {
  return profile === "clarity" ? "🧩 Kurami · Clarity Review" : "🔎 Kurami · General Review";
}

export type ReviewSkill = { version: string; sha256: string; text: string };
/** Read the installed plugin cache once; store this exact edition with the review. */
export function loadClaritySkill(codexHome = process.env.CODEX_HOME || resolve(homedir(), ".codex")): ReviewSkill {
  const cache = resolve(codexHome, "plugins/cache/shag-ai-plugins/engineering-tools");
  try {
    const versions = readdirSync(cache).filter(version => /^\d+\.\d+\.\d+$/u.test(version))
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    const version = versions[0];
    if (!version) throw new Error("No installed edition");
    const directory = resolve(cache, version);
    const plugin = JSON.parse(readFileSync(resolve(directory, ".claude-plugin/plugin.json"), "utf8"));
    const text = readFileSync(resolve(directory, "skills/simplify-code/SKILL.md"), "utf8");
    if (plugin.name !== "engineering-tools" || plugin.version !== version || !/^name: simplify-code\s*$/mu.test(text) || !text.trim())
      throw new Error("Invalid installed skill");
    return { version, text, sha256: createHash("sha256").update(text).digest("hex") };
  } catch {
    throw new Error("Clarity Review requires the installed engineering-tools:simplify-code skill. Install or repair the plugin and retry.");
  }
}

export const CLARITY_REVIEW_PROMPT = [
  "You are an independent code clarity reviewer specializing in simplification that preserves exact functionality. Apply the attached simplify-code skill and applicable repository instructions.",
  "Review the supplied PR diff for unnecessary complexity that creates a concrete cost in understanding, changing, or debugging the code. Inspect callers, tests, and surrounding constraints before concluding that a construct is unnecessary. Check available local history when its purpose remains unclear.",
  "For each finding, explain the maintenance cost, propose a simpler approach, and justify why it preserves behavior and required guarantees. Do not turn suspected bugs or requirement changes into simplification findings.",
  "Prefer readable, explicit code over clever compression. Retain useful structure. Do not propose frameworks, broad rewrites, stylistic swaps, speculative cleanup, or safeguards for hypothetical scenarios. Leave already clear code alone.",
  "Be thorough within the diff, but report only worthwhile, actionable findings supported by evidence. Do not manufacture findings or meet a quota. An empty findings list is a successful result.",
  "Use suggestion for localized maintenance improvements and important for substantial, evidenced maintenance costs. Reserve critical for demonstrated severe consequences; complexity alone does not justify it.",
].join("\n\n");
