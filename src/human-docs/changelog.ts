import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";

export type Language = "en" | "ru";
type Category = "new" | "improved" | "fixed" | "operations";
interface Curated {category: Category; en: string; ru: string; page?: string; exclude?: string}
interface Ledger {baseline: string; commits: Record<string,Curated>}
export interface Change {sha: string; date: string; category: Category; copy: string; page?: string}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ledgerPath = resolve(root, "src/human-docs/changelog.json");
const git = (...args: string[]) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
const shaPattern = /^[0-9a-f]{40}$/;

export function changesForDeployedSha(deployedSha: string, lang: Language): Change[] {
  if (!shaPattern.test(deployedSha)) throw new Error("Deployment revision must be a full 40-character Git SHA");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger;
  const baseline = git("rev-parse", `${ledger.baseline}^{commit}`);
  const revision = git("rev-parse", `${deployedSha}^{commit}`);
  if (revision !== deployedSha) throw new Error("Deployment revision does not match a commit");
  try { git("merge-base", "--is-ancestor", baseline, revision); }
  catch { throw new Error("Deployment revision is older than the docs changelog baseline"); }
  try { git("merge-base", "--is-ancestor", revision, "HEAD"); }
  catch { throw new Error("Deployment revision is not in the checked-out history"); }
  const history = git("log", "--reverse", "--format=%H%x09%aI", `${baseline}..${revision}`);
  if (!history) return [];
  return history.split("\n").flatMap((line) => {
    const [sha, timestamp] = line.split("\t");
    const entry = ledger.commits[sha];
    if (!entry) throw new Error(`Missing curated changelog classification for ${sha}`);
    if (entry.exclude) {
      const paths = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n");
      if (!paths.length || paths.some((p) => !(/^(?:src\/human-docs\/|tests\/human-docs\/|docs\/human-docs-(?:concept|operations)\.md$)/).test(p))) {
        throw new Error(`Exclusion for ${sha} covers non-docs files`);
      }
      return [];
    }
    if (!entry.en?.trim() || !entry.ru?.trim() || !["new", "improved", "fixed", "operations"].includes(entry.category)) {
      throw new Error(`Incomplete bilingual changelog entry for ${sha}`);
    }
    if (entry.page && !/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(entry.page)) throw new Error(`Unsafe page route for ${sha}`);
    return [{sha, date: timestamp.slice(0,10), category:entry.category, copy:entry[lang], page:entry.page}];
  }).reverse();
}

export function assertDocsSourceMatchesDeployment(deployedSha:string):void {
  if(git("status","--porcelain"))throw new Error("Release docs build requires a clean working tree");
  const changed=git("diff","--name-only",`${deployedSha}..HEAD`);
  const docsOnly=/^(?:src\/human-docs\/|tests\/human-docs\/|docs\/human-docs-(?:concept|operations)\.md)$/;
  if(changed&&changed.split("\n").some(path=>!docsOnly.test(path)))throw new Error("Docs checkout includes application changes newer than the verified deployment");
}

/** The manifest is an assertion from the trusted release controller, never inferred from Git HEAD. */
export function readDeploymentManifest(path: string): string {
  const value = JSON.parse(readFileSync(path, "utf8")) as {status?:string; appSha?:string};
  if (value.status !== "succeeded" || !value.appSha || !shaPattern.test(value.appSha)) {
    throw new Error("Manifest must contain status=succeeded and a full appSha");
  }
  return value.appSha;
}
