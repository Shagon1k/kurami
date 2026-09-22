import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";
import {snapshotReview} from "./cli.ts";
import {collectIssuerEvidence,type ResearchTarget} from "./collect.ts";
import {collectVuaa,applyVuaa} from "./vanguard.ts";
import {collectPrimaryDocuments} from "./primary.ts";
import {primaryPacket,primaryEvidence,mergePrimaryEvidence,validatePrimaryCheck} from "./primary-evidence.ts";
import {buildReviewPacket} from "./packet.ts";
import {calculateReview,parseReviewInput,type ReviewInput} from "./model.ts";
const read=async(path:string)=>JSON.parse(await readFile(path,"utf8"));
const save=async(dir:string,name:string,value:unknown)=>writeFile(join(dir,name),JSON.stringify(value,null,2)+"\n",{mode:0o600,flag:"wx"});
/** Bounded collection pipeline. Acceptance and broker operations remain outside it. */
export async function prepareReviewRun(date:string,baseline:string,allTargets:ResearchTarget[],directory:string,mode:ReviewInput["mode"]="trial"){
  await mkdir(directory,{mode:0o700});
  let stage="snapshot";
  try{
    let input=await snapshotReview(baseline,{sources:[],facts:[]},date);
    input=parseReviewInput({...input,mode});
    if(!calculateReview(input).complete)throw Error("Current quote snapshot is incomplete");
    const held=new Set(input.baseline.positions.filter(p=>p.symbol!=="VUAA").map(p=>p.symbol));
    const targets=allTargets.filter(t=>held.has(t.symbol));
    if(targets.length!==held.size||new Set(targets.map(t=>t.symbol)).size!==held.size)throw Error("Issuer registry does not cover portfolio");
    stage="fund";
    const fund=await collectVuaa(date);await save(directory,"fund.json",fund);
    if(fund.state!=="ready")throw Error("Current fund source unavailable");
    input=applyVuaa(input,fund);
    stage="metrics";
    const sec=await collectIssuerEvidence(targets,date);await save(directory,"sec.json",sec);
    input.sources.push(...sec.sources);input.facts.push(...sec.facts);
    input.researchCoverage=[...(input.researchCoverage??[]),...sec.coverage.map(c=>({symbol:c.symbol,state:c.state==="ready"?"fresh" as const:"partial" as const,note:c.reason}))];
    input=parseReviewInput(input);await save(directory,"input-preliminary.json",input);
    const gaps=targets.filter(t=>sec.coverage.find(c=>c.symbol===t.symbol)?.state!=="ready");
    if(!gaps.length){
      await save(directory,"input.json",input);await save(directory,"draft-packet.json",await buildReviewPacket(input));
      await save(directory,"prepared.json",{stage:"draft-ready",published:false,scheduled:false,sourceRequests:sec.requests+2});
      return {stage:"draft-ready",directory};
    }
    stage="primary";
    const primary=await collectPrimaryDocuments(gaps,date);await save(directory,"primary.json",primary);
    if(primary.documents.length!==gaps.length)throw Error("Primary source coverage incomplete");
    await save(directory,"extraction-packet.json",primaryPacket(primary));
    await save(directory,"prepared.json",{stage:"extraction-ready",published:false,scheduled:false,sourceRequests:sec.requests+primary.requests+2});
    return {stage:"extraction-ready",directory,documents:primary.documents.length};
  }catch(error){
    await save(directory,"failed.json",{stage,error:error instanceof Error?error.message:"Unknown failure",published:false,scheduled:false});
    throw error;
  }
}
export async function finishSources(directory:string,extractionPath:string,reviewed:boolean){
  const input=parseReviewInput(await read(join(directory,"input-preliminary.json"))),collection=await read(join(directory,"primary.json")),extraction=await read(extractionPath);
  const evidence=primaryEvidence(collection,extraction);
  if(evidence.coverage.some(c=>c.state!=="extracted"))throw Error("Source facts missing");
  const merged=mergePrimaryEvidence(input,collection,extraction,reviewed);
  await save(directory,"input.json",merged);
  await save(directory,"draft-packet.json",await buildReviewPacket(merged));
  return {stage:"draft-ready",directory,positions:merged.baseline.positions.length,facts:merged.facts.length};
}
if(import.meta.main){
  const [command,...args]=process.argv.slice(2);
  if(command==="prepare"){
    const [date,baseline,targets,directory]=args;if(!date||!baseline||!targets||!directory)throw Error("prepare <date> <baseline> <public-targets> <new-private-directory>");
    console.log(JSON.stringify(await prepareReviewRun(date,baseline,await read(targets),directory)));
  }else if(command==="finish-checked"){
    const [directory,extraction,check]=args;if(!directory||!extraction||!check)throw Error("finish-checked <directory> <extraction> <independent-check>");
    validatePrimaryCheck(await read(join(directory,"primary.json")),await read(extraction),await read(check));
    console.log(JSON.stringify(await finishSources(directory,extraction,true)));
  }else if(command==="finish-reviewed"){
    const [directory,extraction]=args;if(!directory||!extraction)throw Error("finish-reviewed <directory> <extraction>");
    console.log(JSON.stringify(await finishSources(directory,extraction,true)));
  }else throw Error("Use prepare or finish-reviewed; no publication/acceptance/scheduling operation");
}
