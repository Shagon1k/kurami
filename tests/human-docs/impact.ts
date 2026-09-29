import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {onlyDocsPackageScriptsChanged} from "../../src/human-docs/changelog.ts";

type Area="digest"|"projects"|"operations"|"understand"|"site";
const root=resolve(import.meta.dirname,"../..");
const shaPattern=/^[0-9a-f]{40}$/;
const contentByArea:Record<Area,(path:string)=>boolean>={
  digest:path=>path==="src/human-docs/content/digest.ts",
  projects:path=>path==="src/human-docs/content/projects.ts",
  operations:path=>path==="src/human-docs/content/operations.ts",
  understand:path=>["src/human-docs/content/start.ts","src/human-docs/content/understand.ts"].includes(path),
  site:path=>path.startsWith("src/human-docs/")||path.startsWith("docs/human-docs-"),
};

function areaFor(path:string):Area|undefined {
  if(path.startsWith("src/human-docs/")||path.startsWith("tests/human-docs/"))return undefined;
  if(path===".github/workflows/regression.yml")return undefined;
  if(path.startsWith("src/briefing/")||path.startsWith("integrations/hermes/skills/kurami-daily-briefing/")||path==="bin/sync-briefing-cron.py"||path.startsWith("deploy/config/briefing"))return "digest";
  if(path.startsWith("src/orchestrator/")||path.startsWith("src/discord/")||path.startsWith("integrations/hermes/plugins/kurami-discord-controls/"))return "projects";
  if(path.startsWith("src/connectors/")||path.startsWith("src/system/")||path.startsWith("deploy/")||path.startsWith("bin/")||path.startsWith(".github/workflows/"))return "operations";
  if(path.startsWith("src/core/"))return "understand";
  if(path.startsWith("src/")||path.startsWith("integrations/")||path==="package.json"||path==="package-lock.json")return "site";
  return undefined;
}

function field(body:string,name:string):string[] {
  return [...body.matchAll(new RegExp(`^${name}:\\s*(.+)$`,"gim"))].map(match=>match[1].trim());
}

/** A PR declaration is an editorial checkpoint, not deployment evidence or public changelog copy. */
export function evaluateDocsImpact(paths:readonly string[],body:string):string[] {
  const areas=new Set(paths.map(areaFor).filter((area):area is Area=>Boolean(area)));
  if(!areas.size)return [];
  const impact=field(body,"Docs-Impact");
  if(impact.length!==1||!["updated","none"].includes(impact[0].toLowerCase()))return ["Add exactly one `Docs-Impact: updated` or `Docs-Impact: none` line to the PR body."];
  if(impact[0].toLowerCase()==="none"){
    const reason=field(body,"Docs-Reason");
    return reason.length===1&&reason[0].length>=25?[]:["`Docs-Impact: none` needs one specific `Docs-Reason:` (at least 25 characters)."];
  }
  const errors:string[]=[];
  for(const area of areas)if(!paths.some(contentByArea[area]))errors.push(`Update the ${area} human-docs source, or explain why no reader-visible change occurred.`);
  for(const lang of ["EN","RU"]){
    const summaries=field(body,`Changelog-${lang}`);
    if(summaries.length!==1||summaries[0].length<15)errors.push(`Add one reviewed \`Changelog-${lang}:\` summary (at least 15 characters) to the PR body.`);
  }
  return errors;
}

if(import.meta.main){
  const eventPath=process.env.GITHUB_EVENT_PATH;
  if(!eventPath)throw new Error("GITHUB_EVENT_PATH is required for the PR docs-impact gate");
  const event=JSON.parse(readFileSync(eventPath,"utf8")) as {pull_request?:{base?:{sha?:string};body?:string|null}};
  const base=event.pull_request?.base?.sha;
  if(!base||!shaPattern.test(base))throw new Error("PR base must be a full Git SHA");
  const paths=execFileSync("git",["diff","--name-only",`${base}...HEAD`],{cwd:root,encoding:"utf8"}).trim().split("\n").filter(Boolean).filter(path=>{
    if(path!=="package.json")return true;
    const before=JSON.parse(execFileSync("git",["show",`${base}:package.json`],{cwd:root,encoding:"utf8"}));
    const after=JSON.parse(execFileSync("git",["show","HEAD:package.json"],{cwd:root,encoding:"utf8"}));
    return !onlyDocsPackageScriptsChanged(before,after);
  });
  const errors=evaluateDocsImpact(paths,event.pull_request?.body??"");
  if(errors.length){for(const error of errors)console.error(error);process.exitCode=1;}
  else console.log("PR docs-impact declaration and affected sections checked");
}
