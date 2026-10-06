// Which test suites a change touches. A suite is its npm script: the TypeScript, JavaScript and Python files
// it runs, everything they import, and every repository path they name in a string literal (files read at
// runtime: launch scripts, skills, docs pages, assets). A suite runs when a changed file is one of those
// files or sits under one of those directories. Build and dependency files trigger every suite.
// For iteration only: the full `npm test` still runs before a release.
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,statSync} from "node:fs";
import {dirname,relative,resolve} from "node:path";

const root=resolve(import.meta.dirname,"..");
const everything=[/^package(-lock)?\.json$/,/^tsconfig[^/]*\.json$/,/^tests\/(run-regression|test-plan)\.ts$/];
const code=/\.(ts|mts|js|mjs|py)$/;
const repoPrefix=/^(src|bin|tests|integrations|migrations|config)\//;

type Watch={files:Set<string>;directories:Set<string>};

function scripts():Record<string,string>{return JSON.parse(readFileSync(resolve(root,"package.json"),"utf8")).scripts;}

/** The repository files a script runs: `node FILE`, `python3 FILE`, and the scripts it calls with `npm run`. */
export function scriptFiles(name:string,all=scripts(),seen=new Set<string>()):string[]{
  if(seen.has(name)||!all[name])return [];
  seen.add(name);
  const files:string[]=[];
  for(const part of all[name].split("&&").map(value=>value.trim().replace(/^(\w+=\S+\s+)+/,""))){
    const npm=/^npm run (\S+)/.exec(part);
    if(npm){files.push(...scriptFiles(npm[1]!,all,seen));continue;}
    const file=/^(?:node|python3)\s+(\S+)/.exec(part)?.[1];
    if(file&&existsSync(resolve(root,file)))files.push(relative(root,resolve(root,file)));
  }
  return files;
}

function resolvePath(from:string,spec:string):string|null{
  const base=spec.startsWith(".")?resolve(root,dirname(from),spec):resolve(root,spec);
  for(const candidate of [base,`${base}.ts`,`${base}/index.ts`])if(existsSync(candidate))return relative(root,candidate);
  return null;
}

/** Imports and named repository paths of one file. */
function references(file:string):string[]{
  const source=readFileSync(resolve(root,file),"utf8"),found:string[]=[];
  const add=(spec:string)=>{if(spec.includes("${")||spec.includes("*"))return;const path=resolvePath(file,spec);if(path&&!path.startsWith(".."))found.push(path);};
  for(const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g))if(match[1]!.startsWith("."))add(match[1]!);
  for(const match of source.matchAll(/["'`]((?:\.{1,2}\/)+[\w@./-]+|(?:src|bin|tests|integrations|migrations|config)\/[\w@./-]+)["'`]/g))add(match[1]!);
  // A path next to the module without "./" ("content/pages", "fixtures/x.json"): only if it exists there.
  for(const match of source.matchAll(/["'`]([\w@-]+\/[\w@./-]+)["'`]/g)){const near=resolve(root,dirname(file),match[1]!);if(existsSync(near))found.push(relative(root,near));}
  // Python joins paths with "/": root / "integrations" / "hermes".
  for(const match of source.matchAll(/\/\s*"([\w.-]+)"((?:\s*\/\s*"[\w.-]+")*)/g)){
    const parts=[match[1]!,...[...match[2]!.matchAll(/"([\w.-]+)"/g)].map(part=>part[1]!)].join("/");
    if(repoPrefix.test(`${parts}/`))add(parts);
  }
  return found;
}

/** Every file a suite runs or imports, and every path it names, followed transitively through code. */
export function suiteWatch(name:string,all=scripts()):Watch{
  const watch:Watch={files:new Set(),directories:new Set()},queue=[...scriptFiles(name,all)];
  while(queue.length){
    const file=queue.pop()!;
    if(watch.files.has(file)||watch.directories.has(file))continue;
    if(statSync(resolve(root,file)).isDirectory()){watch.directories.add(file);continue;}
    watch.files.add(file);
    if(code.test(file))queue.push(...references(file));
  }
  return watch;
}

/** Changed files: commits since the merge base with origin/main, staged, unstaged and untracked work. */
export function changedFiles(base="origin/main"):string[]{
  const git=(...args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).split("\n").filter(Boolean);
  const mergeBase=git("merge-base",base,"HEAD")[0]!;
  return [...new Set([...git("diff","--name-only",mergeBase),...git("ls-files","--others","--exclude-standard")])].sort();
}

export function planSuites(suites:readonly string[],changed:readonly string[]):{suites:string[];reasons:Record<string,string>;everything:boolean}{
  const trigger=changed.find(file=>everything.some(pattern=>pattern.test(file)));
  if(trigger)return {suites:[...suites],reasons:Object.fromEntries(suites.map(suite=>[suite,trigger])),everything:true};
  const all=scripts(),reasons:Record<string,string>={};
  for(const suite of suites){
    const watch=suiteWatch(suite,all);
    const hit=changed.find(file=>watch.files.has(file)||[...watch.directories].some(directory=>file.startsWith(`${directory}/`)));
    if(hit)reasons[suite]=hit;
  }
  return {suites:suites.filter(suite=>suite in reasons),reasons,everything:false};
}
