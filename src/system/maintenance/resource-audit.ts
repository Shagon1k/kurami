import {readFileSync,statSync,mkdirSync,writeFileSync,renameSync} from "node:fs";
import {resolve} from "node:path";

export type AuditDecision={id:string;recommendation:"consider"|"keep";ru:string;en:string};
export type ResourceAudit={version:1;id:string;checkedAt:string;status:"ready"|"failed";sessionId:string|null;
  summary:{ru:string;en:string};analysis:{ru:string;en:string};
  disk:{usedBytes:number;availableBytes:number;usedPercent:number;unaccountedBytes:number|null};
  memory:{MemTotal:number;MemAvailable:number;usedBytes:number;processGroups:{name:string;pssBytes:number;processes:number}[];unreadableProcesses:number};
  locations:{path:string;bytes:number}[];
  candidates:{id:string;path:string;bytes:number;kind:string;protected:boolean}[];
  decisions:AuditDecision[];limitations:{ru:string;en:string}[];databaseMounts:string[]};
const validId=(value:unknown):value is string=>typeof value==="string"&&/^resource-[a-f0-9]{32}$/.test(value);
const nonnegative=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)&&value>=0;
const pair=(value:any)=>value&&["ru","en"].every(lang=>typeof value[lang]==="string"&&value[lang].length<=8000);
export function readResourceAudit(home:string):ResourceAudit|null {
  try{
    const path=resolve(home,"state/resource-audit/latest.json");if(statSync(path).size>1_000_000)return null;
    const value=JSON.parse(readFileSync(path,"utf8"));
    if(value.version!==1||!validId(value.id)||!Number.isFinite(Date.parse(value.checkedAt))||!["ready","failed"].includes(value.status)||!pair(value.summary)||!pair(value.analysis))return null;
    if(!value.disk||![value.disk.usedBytes,value.disk.availableBytes,value.disk.usedPercent].every(nonnegative)||!value.memory||![value.memory.MemTotal,value.memory.MemAvailable,value.memory.usedBytes].every(nonnegative))return null;
    for(const key of ["locations","candidates","decisions","limitations","databaseMounts"]){if(!Array.isArray(value[key])||value[key].length>100)return null;}
    if(!Array.isArray(value.memory.processGroups)||value.memory.processGroups.length>30)return null;
    if(value.locations.some((x:any)=>typeof x.path!=="string"||!nonnegative(x.bytes))||value.candidates.some((x:any)=>typeof x.id!=="string"||typeof x.path!=="string"||!nonnegative(x.bytes)||typeof x.protected!=="boolean"))return null;
    if(value.decisions.some((x:any)=>typeof x.id!=="string"||!["consider","keep"].includes(x.recommendation)||!pair(x))||value.limitations.some((x:unknown)=>!pair(x))||value.databaseMounts.some((x:unknown)=>typeof x!=="string")||value.memory.processGroups.some((x:any)=>typeof x.name!=="string"||!nonnegative(x.pssBytes)||!nonnegative(x.processes)))return null;
    return value;
  }catch{return null;}
}
export function resourceAuditPending(home:string,audit:ResourceAudit):boolean {
  try{return JSON.parse(readFileSync(resolve(home,"state/hub/resource-audit-ack.json"),"utf8")).id!==audit.id;}catch{return true;}
}
/** Acknowledgement clears only this report's notice. It never approves or executes cleanup. */
export function acknowledgeResourceAudit(home:string,id:unknown,actor:string):void {
  const audit=readResourceAudit(home);
  if(!validId(id)||!audit||audit.id!==id)throw new Error("stale_audit");
  const directory=resolve(home,"state/hub");mkdirSync(directory,{recursive:true});
  const path=resolve(directory,"resource-audit-ack.json"),temporary=`${path}.${process.pid}.tmp`;
  writeFileSync(temporary,JSON.stringify({id,actor,at:new Date().toISOString()}),{mode:0o600});renameSync(temporary,path);
}
