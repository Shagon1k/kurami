// Keep the docs state folder small: the newest rollback copies stay, older copies and leftovers go.
// Usage: node src/human-docs/approval/releases.ts [--keep=3] [--apply]   (dry run without --apply)
// Only folders that hold a release build.json are touched; the live release, the audit clone and drafts never are.
import {existsSync,readdirSync,readFileSync,rmSync,statSync} from "node:fs";
import {resolve} from "node:path";
import {docsStateDir,kuramiHome} from "./store.ts";

const COPY=/^(rollback|failed|stage)-/;
const LEFTOVER_AGE_MS=24*60*60_000;

function isReleaseCopy(path:string):boolean {
  try{return (JSON.parse(readFileSync(resolve(path,"build.json"),"utf8")) as {mode?:string}).mode==="release";}
  catch{return false;}
}

/** Names of copies to delete: all but the `keep` newest rollbacks, and failed/stage leftovers older than a day. */
export function releaseCopiesToPrune(root:string,options:{keep:number;now:number;protect?:readonly string[]}):string[] {
  const copies=readdirSync(root,{withFileTypes:true})
    .filter(entry=>entry.isDirectory()&&COPY.test(entry.name)&&isReleaseCopy(resolve(root,entry.name)))
    .map(entry=>({name:entry.name,mtime:statSync(resolve(root,entry.name)).mtimeMs}))
    .sort((left,right)=>right.mtime-left.mtime);
  const protectedNames=new Set(options.protect??[]);
  const rollbacks=copies.filter(copy=>copy.name.startsWith("rollback-"));
  const keep=new Set(rollbacks.slice(0,options.keep).map(copy=>copy.name));
  return copies.filter(copy=>{
    if(protectedNames.has(copy.name)||keep.has(copy.name))return false;
    if(copy.name.startsWith("rollback-"))return true;
    return options.now-copy.mtime>=LEFTOVER_AGE_MS;
  }).map(copy=>copy.name);
}

export function pruneReleaseCopies(root:string,options:{keep:number;now:number;protect?:readonly string[]}):string[] {
  const names=releaseCopiesToPrune(root,options);
  for(const name of names)rmSync(resolve(root,name),{recursive:true,force:true});
  return names;
}

if(import.meta.main){
  const keep=Number(process.argv.find(arg=>arg.startsWith("--keep="))?.slice(7)??"3");
  if(!Number.isInteger(keep)||keep<1)throw new Error("--keep must be a positive integer");
  const root=docsStateDir(kuramiHome());
  if(!existsSync(resolve(root,"release/build.json")))throw new Error("No promoted docs release found");
  const apply=process.argv.includes("--apply");
  const names=apply?pruneReleaseCopies(root,{keep,now:Date.now()}):releaseCopiesToPrune(root,{keep,now:Date.now()});
  console.log(JSON.stringify({apply,keep,removed:apply?names:[],wouldRemove:apply?[]:names}));
}
