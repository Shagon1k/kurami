import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, resolve} from "node:path";
import {isDeepStrictEqual} from "node:util";

export type Language = "en" | "ru";
type Category = "new" | "improved" | "fixed" | "operations";
interface Curated {category: Category; en: string; ru: string; page?: string; exclude?: string; exclusionScope?: "docs-only" | "no-reader-visible-change"}
interface Ledger {baseline: string; publicationBaseline?:string; commits: Record<string,Curated>}
export interface Change {sha: string; date: string; category: Category; copy: string; page?: string}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ledgerPath = resolve(root, "src/human-docs/changelog.json");
const git = (...args: string[]) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
const shaPattern = /^[0-9a-f]{40}$/;
// Interest Profile's internal reference was corrected in a docs-only commit;
// keep this exception exact instead of exempting the whole docs/ directory.
const docsOnlyPath=/^(?:src\/human-docs\/|tests\/human-docs\/|docs\/(?:human-docs-(?:concept|operations|delivery-plan|coverage-audit|impact-map)|interest-profile-v1)\.md$)/;
const docsImpactStep="      - if: github.event_name == 'pull_request'\n        run: node tests/human-docs/impact.ts\n";

export function onlyDocsWorkflowChanged(before:string,after:string):boolean {
  return after.includes(docsImpactStep)&&after.replace(docsImpactStep,"")===before;
}

export function onlyDocsPackageScriptsChanged(before:unknown,after:unknown):boolean {
  const strip=(value:unknown):unknown=>{
    if(!value||typeof value!=="object"||Array.isArray(value))return null;
    const copy=structuredClone(value) as {scripts?:Record<string,unknown>};
    if(!copy.scripts||typeof copy.scripts!=="object"||Array.isArray(copy.scripts))return null;
    for(const name of Object.keys(copy.scripts))if(/^(?:docs:|test:docs(?::|$))/.test(name))delete copy.scripts[name];
    return copy;
  };
  const oldValue=strip(before),newValue=strip(after);
  return oldValue!==null&&newValue!==null&&isDeepStrictEqual(oldValue,newValue);
}

function docsOnlyChange(path:string,base:string,revision:string):boolean {
  if(docsOnlyPath.test(path))return true;
  if(path===".github/workflows/regression.yml"){
    return onlyDocsWorkflowChanged(git("show",`${base}:${path}`),git("show",`${revision}:${path}`));
  }
  if(path!=="package.json")return false;
  return onlyDocsPackageScriptsChanged(JSON.parse(git("show",`${base}:package.json`)),JSON.parse(git("show",`${revision}:package.json`)));
}

function contentlessMerge(sha:string):boolean {
  const [, ...parents]=git("rev-list","--parents","-n","1",sha).split(" ");
  return parents.length>1 && parents.some(parent=>!git("diff","--name-only",parent,sha));
}

export function changesForDeployedSha(deployedSha: string, lang: Language, historical=false): Change[] {
  if (!shaPattern.test(deployedSha)) throw new Error("Deployment revision must be a full 40-character Git SHA");
  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8")) as Ledger;
  const baseline = git("rev-parse", `${historical?ledger.baseline:ledger.publicationBaseline??ledger.baseline}^{commit}`);
  const revision = git("rev-parse", `${deployedSha}^{commit}`);
  if (revision !== deployedSha) throw new Error("Deployment revision does not match a commit");
  try { git("merge-base", "--is-ancestor", baseline, revision); }
  catch { throw new Error("Deployment revision is older than the docs changelog baseline"); }
  try { git("merge-base", "--is-ancestor", revision, "HEAD"); }
  catch { throw new Error("Deployment revision is not in the checked-out history"); }
  const history = git("log", "--reverse", "--format=%H%x09%cI", `${baseline}..${revision}`);
  if (!history) return [];
  return history.split("\n").flatMap((line) => {
    const [sha, timestamp] = line.split("\t");
    const entry = ledger.commits[sha];
    if (!entry) {
      // A merge identical to one parent adds no unclassified content: its
      // individual commits are already present in this history range.
      if(contentlessMerge(sha))return [];
      throw new Error(`Missing curated changelog classification for ${sha}`);
    }
    if (entry.exclude) {
      if(!entry.exclude.trim())throw new Error(`Empty changelog exclusion for ${sha}`);
      const scope=entry.exclusionScope??"docs-only";
      if(scope==="docs-only"){
        const paths = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n");
        if (!paths.length || paths.some((p) => !docsOnlyChange(p,`${sha}^`,sha)))throw new Error(`Exclusion for ${sha} covers non-docs files`);
      }else if(scope!=="no-reader-visible-change")throw new Error(`Unknown changelog exclusion scope for ${sha}`);
      if(scope==="no-reader-visible-change"&&entry.exclude.trim().length<25){
        throw new Error(`No-reader-visible-change exclusion for ${sha} needs a specific reason`);
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
  if(changed&&changed.split("\n").some(path=>!docsOnlyChange(path,deployedSha,"HEAD")))throw new Error("Docs checkout includes application changes newer than the verified deployment");
}

/** The manifest is an assertion from the trusted release controller, never inferred from Git HEAD. */
export function readDeploymentManifest(path: string): string {
  const value = JSON.parse(readFileSync(path, "utf8")) as {status?:string; appSha?:string};
  if (value.status !== "succeeded" || !value.appSha || !shaPattern.test(value.appSha)) {
    throw new Error("Manifest must contain status=succeeded and a full appSha");
  }
  return value.appSha;
}
