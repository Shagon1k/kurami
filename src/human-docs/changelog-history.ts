import {existsSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {changesForDeployedSha,type Change,type Language} from "./changelog.ts";

export interface ChangelogHistory {revision:string;changes:Record<Language,Change[]>}
const shaPattern=/^[0-9a-f]{40}$/;
const root=resolve(import.meta.dirname,"../..");

export function historyForRevision(revision:string):ChangelogHistory {
  return {revision,changes:{en:changesForDeployedSha(revision,"en"),ru:changesForDeployedSha(revision,"ru")}};
}

/** Only read from a trusted, previously promoted release, never from preview output. */
export function readPublishedHistory(directory:string):ChangelogHistory|undefined {
  const marker=resolve(directory,"build.json");
  if(!existsSync(marker))return undefined;
  const info=JSON.parse(readFileSync(marker,"utf8"));
  if(info.mode!=="release"||!shaPattern.test(info.docsSha??""))throw new Error("Changelog history requires a published release");
  const path=resolve(directory,"changelog-history.json");
  if(!existsSync(path)){
    if(info.changelogRevision)throw new Error("Published changelog history is missing");
    // Migrate releases created before history snapshots were introduced.
    return info.revision?historyForRevision(info.revision):undefined;
  }
  const history=JSON.parse(readFileSync(path,"utf8")) as ChangelogHistory;
  if(!shaPattern.test(history.revision??"")||history.revision!==(info.changelogRevision??info.revision))throw new Error("Published changelog revision does not match its snapshot");
  for(const lang of ["en","ru"] as const){
    const changes=history.changes?.[lang];
    if(!Array.isArray(changes)||changes.some(change=>!change||!shaPattern.test(change.sha??"")||!/^\d{4}-\d{2}-\d{2}$/.test(change.date??"")||!["new","improved","fixed","operations"].includes(change.category)||typeof change.copy!=="string"||!change.copy.trim()||(change.page!==undefined&&!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(change.page))))throw new Error("Invalid published changelog entries");
    if(new Set(changes.map(change=>change.sha)).size!==changes.length)throw new Error("Duplicate published changelog entry");
  }
  if(JSON.stringify(history.changes.en.map(change=>change.sha))!==JSON.stringify(history.changes.ru.map(change=>change.sha)))throw new Error("Published changelog languages disagree");
  execFileSync("git",["merge-base","--is-ancestor",history.revision,"HEAD"],{cwd:root,stdio:"pipe"});
  return history;
}

/** Publication cannot erase confirmed entries or move its verified cutoff backwards. */
export function assertHistoryRetained(previous:ChangelogHistory|undefined,next:ChangelogHistory|undefined):void {
  if(!previous)return;
  if(!next)throw new Error("Publication would remove confirmed changelog history");
  try{execFileSync("git",["merge-base","--is-ancestor",previous.revision,next.revision],{cwd:root,stdio:"pipe"});}
  catch{throw new Error("Publication would move confirmed changelog history backwards");}
  for(const lang of ["en","ru"] as const){
    const retained=new Set(next.changes[lang].map(change=>change.sha));
    if(previous.changes[lang].some(change=>!retained.has(change.sha)))throw new Error(`Publication would remove confirmed ${lang} changelog entries`);
  }
}
