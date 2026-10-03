import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const fullSha=/^[0-9a-f]{40}$/;
const safeRef=/^[A-Za-z0-9_./-]+$/;
const maxCommits=250;
const maxPaths=500;

export interface AuditOptions {
  repo: string;
  sourceRef: string;
  ledgerPath: string;
  docsBuildPath?: string;
  deploymentManifestPath?: string;
}

export interface AuditCommit {
  sha: string;
  committedOn: string;
  paths: string[];
  deployed: boolean | null;
}

export interface AuditSnapshot {
  sourceRef: string;
  sourceSha: string;
  sourceDirty: boolean;
  baselineSha: string;
  docsReleaseSha: string | null;
  verifiedAppSha: string | null;
  changedPaths: string[];
  commitsSinceDocsRelease: AuditCommit[];
  unclassifiedShas: string[];
}

function git(repo:string,...args:string[]):string {
  return execFileSync("git",args,{cwd:repo,encoding:"utf8"}).trim();
}

function paths(repo:string,...args:string[]):string[] {
  const output=execFileSync("git",args,{cwd:repo,encoding:"utf8"});
  return output.split("\0").filter(Boolean);
}

function commit(repo:string,ref:string):string {
  if(!safeRef.test(ref)||ref.startsWith("-")||ref.includes(".."))throw new Error("Unsafe Git ref");
  const sha=git(repo,"rev-parse","--verify",`${ref}^{commit}`);
  if(!fullSha.test(sha))throw new Error("Git ref did not resolve to a full commit SHA");
  return sha;
}

function ancestor(repo:string,older:string,newer:string):boolean {
  try { execFileSync("git",["merge-base","--is-ancestor",older,newer],{cwd:repo,stdio:"ignore"});return true; }
  catch { return false; }
}

function contentlessMerge(repo:string,sha:string):boolean {
  const [, ...parents]=git(repo,"rev-list","--parents","-n","1",sha).split(" ");
  return parents.length>1&&parents.some(parent=>paths(repo,"diff","--name-only","-z",parent,sha).length===0);
}

function manifestSha(path:string):string {
  const value=JSON.parse(readFileSync(path,"utf8")) as {status?:string;appSha?:string};
  if(value.status!=="succeeded"||!value.appSha||!fullSha.test(value.appSha))throw new Error("Invalid successful-deployment manifest");
  return value.appSha;
}

/** Read-only inventory. The caller must supply the manifest from a trusted release controller. */
export function collectDocsAudit(options:AuditOptions):AuditSnapshot {
  const repo=resolve(options.repo);
  const sourceSha=commit(repo,options.sourceRef);
  const ledger=JSON.parse(readFileSync(options.ledgerPath,"utf8")) as {baseline?:string;publicationBaseline?:string;commits?:Record<string,unknown>};
  if(!ledger.baseline||!ledger.commits||typeof ledger.commits!=="object")throw new Error("Invalid changelog ledger");
  const classified=ledger.commits;
  const baselineSha=commit(repo,ledger.publicationBaseline??ledger.baseline);
  if(!ancestor(repo,baselineSha,sourceSha))throw new Error("Source is older than the changelog baseline");

  let docsReleaseSha:string|null=null;
  if(options.docsBuildPath){
    const build=JSON.parse(readFileSync(options.docsBuildPath,"utf8")) as {mode?:string;docsSha?:string};
    if(build.mode!=="release"||!build.docsSha||!fullSha.test(build.docsSha))throw new Error("Invalid promoted docs release marker");
    docsReleaseSha=commit(repo,build.docsSha);
    if(!ancestor(repo,baselineSha,docsReleaseSha)||!ancestor(repo,docsReleaseSha,sourceSha))throw new Error("Promoted docs SHA is not in the source history");
  }

  let verifiedAppSha:string|null=null;
  if(options.deploymentManifestPath){
    const asserted=manifestSha(options.deploymentManifestPath);
    verifiedAppSha=commit(repo,asserted);
    if(!ancestor(repo,baselineSha,verifiedAppSha)||!ancestor(repo,verifiedAppSha,sourceSha))throw new Error("Verified app SHA is not in the source history");
  }

  const since=docsReleaseSha??baselineSha;
  const recent=git(repo,"rev-list","--reverse",`${since}..${sourceSha}`).split("\n").filter(Boolean);
  const all=git(repo,"rev-list","--reverse",`${baselineSha}..${sourceSha}`).split("\n").filter(Boolean);
  if(recent.length>maxCommits)throw new Error("Unpublished docs range exceeds the commit limit; split it explicitly");
  const changedPaths=paths(repo,"diff","--name-only","-z",since,sourceSha);
  if(changedPaths.length>maxPaths)throw new Error("Audit range exceeds the path limit; split it explicitly");

  const commitsSinceDocsRelease=recent.map((sha):AuditCommit=>{
    const [,firstParent]=git(repo,"rev-list","--parents","-n","1",sha).split(" ");
    const changed=firstParent?paths(repo,"diff","--name-only","-z",firstParent,sha):paths(repo,"diff-tree","--root","--no-commit-id","--name-only","-r","-z",sha);
    if(changed.length>maxPaths)throw new Error(`Commit ${sha} exceeds the path limit`);
    return {
      sha,
      committedOn:git(repo,"show","-s","--format=%cI",sha).slice(0,10),
      paths:changed,
      deployed:verifiedAppSha?ancestor(repo,sha,verifiedAppSha):null,
    };
  });
  const unclassifiedShas=all.filter(sha=>!Object.hasOwn(classified,sha)&&!contentlessMerge(repo,sha));
  return {
    sourceRef:options.sourceRef,
    sourceSha,
    sourceDirty:Boolean(git(repo,"status","--porcelain")),
    baselineSha,
    docsReleaseSha,
    verifiedAppSha,
    changedPaths,
    commitsSinceDocsRelease,
    unclassifiedShas,
  };
}

if(import.meta.main){
  const root=resolve(import.meta.dirname,"../../..");
  const args=process.argv.slice(2);
  const values=new Map<string,string>();
  for(let i=0;i<args.length;i+=2){
    if(!["--source-ref","--docs-build","--deployment-manifest"].includes(args[i])||!args[i+1]||values.has(args[i]))throw new Error("Use --source-ref <ref> [--docs-build <path>] [--deployment-manifest <trusted path>]");
    values.set(args[i],args[i+1]);
  }
  if(!values.has("--source-ref"))throw new Error("--source-ref is required");
  const snapshot=collectDocsAudit({
    repo:root,
    sourceRef:values.get("--source-ref")!,
    ledgerPath:resolve(root,"src/human-docs/changelog.json"),
    docsBuildPath:values.get("--docs-build"),
    deploymentManifestPath:values.get("--deployment-manifest"),
  });
  process.stdout.write(`${JSON.stringify(snapshot)}\n`);
}
