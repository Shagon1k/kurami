import {createHash,randomUUID} from "node:crypto";
import {mkdir,writeFile,readFile,rename,lstat,rm} from "node:fs/promises";
import {join} from "node:path";
import {calculateReview,dateOnly,parseReviewInput,validateReviewDraft,type ReviewInput,type ReviewDraft} from "./model.ts";
export type ReviewSlot="weekly"|"monthly";
export type StoredReview={version:1;id:string;acceptedAt:string;input:ReviewInput;draft:ReviewDraft};
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const idFor=(input:ReviewInput,draft:ReviewDraft)=>digest({input,draft});
export function parseStoredReview(value:unknown):StoredReview{
  const v=value as StoredReview;
  if(v?.version!==1||!Number.isFinite(Date.parse(v.acceptedAt)))throw Error("Invalid stored review");
  parseReviewInput(v.input);validateReviewDraft(v.input,v.draft);
  if(v.id!==idFor(v.input,v.draft))throw Error("Stored review integrity mismatch");
  return v;
}
async function privateRead(path:string){
  const stat=await lstat(path);
  if(stat.isSymbolicLink()||!stat.isFile()||(stat.mode&0o077)||stat.size>3_000_000)throw Error("Unsafe review file");
  return JSON.parse(await readFile(path,"utf8"));
}
export async function loadReview(root:string,slot:ReviewSlot):Promise<StoredReview|null>{
  if(!["weekly","monthly"].includes(slot))throw Error("Invalid review slot");
  try{
    const pointer=await privateRead(join(root,"latest-"+slot+".json"));
    if(!/^[a-f0-9]{64}$/.test(pointer.id))throw Error("Invalid review pointer");
    const report=parseStoredReview(await privateRead(join(root,pointer.id+".json")));
    if(report.input.mode!==slot||report.id!==pointer.id)throw Error("Wrong review slot or identity");
    return report;
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
}
/** Explicit acceptance only. Generation failures never touch the last success. */
export async function acceptReview(root:string,input:ReviewInput,draft:ReviewDraft,acceptedAt=new Date().toISOString()){
  parseReviewInput(input);validateReviewDraft(input,draft);
  if(input.mode==="trial")throw Error("Trial cannot replace a weekly or monthly report");
  const parts=Number.isFinite(Date.parse(acceptedAt))?new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Vilnius",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(acceptedAt)):[];
  const acceptedDate=["year","month","day"].map(type=>parts.find(part=>part.type===type)?.value??"").join("-");
  if(!dateOnly(acceptedDate)||acceptedDate<input.asOfDate)throw Error("Invalid acceptance date");
  await mkdir(root,{recursive:true,mode:0o700});
  const stat=await lstat(root);if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o077))throw Error("Unsafe review directory");
  const lock=join(root,"accept.lock");await writeFile(lock,"locked",{flag:"wx",mode:0o600});
  try{
    const previous=await loadReview(root,input.mode);
    if(previous&&previous.input.asOfDate>input.asOfDate)throw Error("Older review cannot replace newer report");
    const report:StoredReview={version:1,id:idFor(input,draft),acceptedAt,input,draft};
    if(previous?.id===report.id)return previous;
    const path=join(root,report.id+".json");
    try{await writeFile(path,JSON.stringify(report)+"\n",{flag:"wx",mode:0o600});}
    catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;parseStoredReview(await privateRead(path));}
    const temporary=join(root,"pointer-"+randomUUID()+".json");
    await writeFile(temporary,JSON.stringify({id:report.id})+"\n",{flag:"wx",mode:0o600});
    try{await rename(temporary,join(root,"latest-"+input.mode+".json"));}finally{await rm(temporary,{force:true});}
    return report;
  }finally{await rm(lock,{force:true});}
}
export function reviewFreshness(report:StoredReview,at:string,baseline?:ReviewInput["baseline"]){
  if(!Number.isFinite(Date.parse(at)))return {stale:true,changedHoldings:false,needsConfirmation:true};
  const age=(Date.parse(at)-Date.parse(report.input.asOfDate+"T00:00:00Z"))/86400000;
  const changed=baseline?digest(baseline)!==digest(report.input.baseline):false;
  return {stale:!Number.isFinite(age)||age<0||age>(report.input.mode==="monthly"?35:8),
    changedHoldings:changed,needsConfirmation:!baseline||changed||calculateReview(report.input).requiresPositionConfirmation
      ||report.input.baseline.asOfLocalDate<new Date(Date.parse(at)-30*86400000).toISOString().slice(0,10)};
}
