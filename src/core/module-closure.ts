// What a program depends on inside the repository: the files it runs, everything they import, and every
// repository path their code names in a string literal (launch scripts, skills, docs pages, assets read at
// runtime), followed transitively through code. Used to pick the test suites a change touches
// (tests/test-plan.ts) and to tell whether a running service's code changed since it started.
import {existsSync,readFileSync,statSync} from "node:fs";
import {dirname,relative,resolve} from "node:path";

export type ModuleClosure={files:Set<string>;directories:Set<string>};
const code=/\.(ts|mts|js|mjs|py)$/;
const repoPrefix=/^(src|bin|tests|integrations|migrations|config)\//;

function resolvePath(root:string,from:string,spec:string):string|null{
  const base=spec.startsWith(".")?resolve(root,dirname(from),spec):resolve(root,spec);
  for(const candidate of [base,`${base}.ts`,`${base}/index.ts`])if(existsSync(candidate))return relative(root,candidate);
  return null;
}

/** Imports and named repository paths of one file. */
function references(root:string,file:string):string[]{
  const source=readFileSync(resolve(root,file),"utf8"),found:string[]=[];
  const add=(spec:string)=>{if(spec.includes("${")||spec.includes("*"))return;const path=resolvePath(root,file,spec);if(path&&!path.startsWith(".."))found.push(path);};
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

/** The closure of `entries` (repository-relative paths) under `root`. */
export function moduleClosure(root:string,entries:readonly string[]):ModuleClosure{
  const closure:ModuleClosure={files:new Set(),directories:new Set()},queue=[...entries];
  while(queue.length){
    const file=queue.pop()!;
    if(closure.files.has(file)||closure.directories.has(file)||!existsSync(resolve(root,file)))continue;
    if(statSync(resolve(root,file)).isDirectory()){closure.directories.add(file);continue;}
    closure.files.add(file);
    if(code.test(file))queue.push(...references(root,file));
  }
  return closure;
}

/** The first of `files` (repository-relative) the closure depends on, if any. */
export function firstTouched(closure:ModuleClosure,files:readonly string[]):string|undefined{
  return files.find(file=>closure.files.has(file)||[...closure.directories].some(directory=>file.startsWith(`${directory}/`)));
}
