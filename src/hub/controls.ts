import {validAppearance} from "../system/appearance/appearance-settings.ts";
import {validDevResources} from "../system/dev-resources/dev-resources.ts";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {appendFile,mkdir,open,readFile} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {createHash} from "node:crypto";
import {parse} from "yaml";
import {resolveKuramiHome} from "../core/kurami-home.ts";
import {codexAccount} from "./codex-account.ts";
import {settingsSchema,settingsInteger} from "../orchestrator/settings/settings-schema.ts";

const exec=promisify(execFile);
export class HubControlError extends Error {code:string;constructor(code:string){super(code);this.code=code;}}
const bad=()=>{throw new HubControlError("invalid_request");};
const settingValue=(value:unknown,field:{name:string;min:number;max:number})=>{try{return settingsInteger(value,field);}catch{return bad();}};
const integer=(value:unknown,min:number,max:number)=>{if(!Number.isInteger(value)||Number(value)<min||Number(value)>max)return bad();return Number(value);};
const modelName=(value:unknown)=>{if(typeof value!=="string"||!/^[A-Za-z0-9._/-]{1,120}$/.test(value))return bad();return value;};
const uuid=(value:unknown)=>{if(typeof value!=="string"||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return bad();return value;};
type Run=(binary:string,args:string[])=>Promise<string>;

export function createHubControls(options:{home?:string;hermesHome?:string;run?:Run;rpc?:(method:string,params?:any)=>Promise<any>}={}) {
  const home=options.home??resolveKuramiHome(resolve(import.meta.dirname,"../../.."));
  const hermesHome=options.hermesHome??process.env.HERMES_HOME??"/home/shagon1k/_hermes/_core";
  const run:Run=options.run??(async(binary,args)=>{
    try{return (await exec(binary,args,{env:{...process.env,KURAMI_HOME:home,HERMES_HOME:hermesHome,NODE_NO_WARNINGS:"1"},timeout:60_000,maxBuffer:2_000_000})).stdout;}
    catch{throw new HubControlError("command_failed");}
  });
  const rpc=options.rpc??((method,params)=>codexAccount.call(method,params));
  const node=process.execPath;
  const actor=process.env.HUB_CONTROL_ACTOR_ID??"0";
  const settingsPath=resolve(home,"app/src/orchestrator/settings/orchestrator-settings.ts");
  const healthPath=resolve(home,"app/src/system/health/health-settings.ts");
  const appearancePath=resolve(home,"app/src/system/appearance/appearance-settings.ts");
  const devResourcesPath=resolve(home,"app/src/system/dev-resources/dev-resources.ts");
  const deployPath=resolve(home,"app/src/system/deploy/deploy.ts");
  // A release restarts services (Hub included) and writes the checkout, which Hub's sandbox cannot:
  // it runs as its own transient systemd unit and reports progress in state/deploy/last.json.
  const startRelease=(args:string[])=>run("systemd-run",["--user","--collect","--quiet",`--unit=kurami-release-${Date.now()}`,"-p",`Environment=PATH=${dirname(node)}:/usr/local/bin:/usr/bin:/bin`,"-p",`Environment=KURAMI_HOME=${home}`,"--",node,deployPath,...args,"--actor",actor]);
  const composioPath=resolve(home,"app/src/connectors/composio/cli.ts");
  const hermes=resolve(hermesHome,"hermes-agent/venv/bin/hermes");
  // Three panels: run settings; the server (System Health interval, development resources); appearance.
  async function settings(){return {settings:JSON.parse(await run(node,[settingsPath,"status"]))};}
  async function server(){
    const [health,devResources,release]=await Promise.all([run(node,[healthPath,"status"]),run(node,[devResourcesPath,"status"]),run(node,[deployPath,"status"]).catch(()=>null)]);
    return {health:JSON.parse(health),devResources:JSON.parse(devResources),release:release?JSON.parse(release):null};
  }
  async function appearance(){return {appearance:JSON.parse(await run(node,[appearancePath,"status"]))};}
  async function models(){
    const [catalog,config,hermesConfig]=await Promise.all([rpc("model/list",{limit:100,includeHidden:false}),rpc("config/read",{includeLayers:false}),readFile(resolve(hermesHome,"config.yaml"),"utf8")]);
    const hermesModel=parse(hermesConfig)?.model;
    return {models:(catalog.data??[]).filter((item:any)=>!item.hidden).map((item:any)=>({value:item.model,label:item.displayName??item.model,efforts:(item.supportedReasoningEfforts??[]).map((entry:any)=>entry.reasoningEffort),defaultEffort:item.defaultReasoningEffort})),
      codex:config.config?.model??"",codexEffort:config.config?.model_reasoning_effort??null,codexVersion:config.origins?.model?.version??null,
      hermes:hermesModel?.default??"",hermesProvider:hermesModel?.provider??""};
  }
  async function composioCheck(){
    return Promise.all(["broad","read","automation"].map(async contour=>{
      try {
        const output=JSON.parse(await run(node,[composioPath,"check","--contour",contour,"--json"]));
        const result={contour,ok:output.ok===true,diff:output.diff??[],warnings:output.warnings??[],tools:Array.isArray(output.tools)?output.tools.length:0};
        return {...result,revision:createHash("sha256").update(JSON.stringify(result)).digest("hex")};
      }catch{return {contour,ok:false,diff:[],warnings:[],tools:0,revision:""};}
    }));
  }
  async function execute(action:string,payload:Record<string,unknown>={},identity="") :Promise<any>{
    if(action==="settings")return settings();
    if(action==="server")return server();
    if(action==="appearance")return appearance();
    if(action==="models")return models();
    if(action==="composio-check")return {contours:await composioCheck()};
    const auditPath=resolve(home,"state/hub/control-audit.jsonl");
    // Fail before changing anything if the audit destination is not writable.
    await mkdir(resolve(home,"state/hub"),{recursive:true});
    await (await open(auditPath,"a",0o600)).close();
    let result:any;
    if(action==="codex-reset"){
      const key=uuid(payload.idempotencyKey);
      result=await rpc("account/rateLimitResetCredit/consume",{idempotencyKey:key});
      result={...result,account:await rpc("account/rateLimits/read",{})};
    }else if(action==="model-apply"){
      if(payload.target!=="codex"&&payload.target!=="hermes")return bad();
      const model=modelName(payload.model);const current=await models();
      if(!current.models.some((item:any)=>item.value===model))return bad();
      if(payload.expectedModel!==current[payload.target])throw new HubControlError("stale_settings");
      if(payload.target==="codex"){
        if(payload.expectedEffort!==undefined&&payload.expectedEffort!==current.codexEffort)throw new HubControlError("stale_settings");
        const selected=current.models.find((item:any)=>item.value===model)!;
        const changeEffort=current.codexEffort&&selected.efforts.length&&!selected.efforts.includes(current.codexEffort);
        if(changeEffort){
          await rpc("config/batchWrite",{expectedVersion:current.codexVersion,edits:[{keyPath:"model",value:model,mergeStrategy:"replace"},{keyPath:"model_reasoning_effort",value:selected.defaultEffort,mergeStrategy:"replace"}]});
        }else await rpc("config/value/write",{keyPath:"model",value:model,mergeStrategy:"replace",expectedVersion:current.codexVersion});
      }else {
        if(current.hermesProvider!=="openai-codex")throw new HubControlError("provider_unsupported");
        await run(hermes,["config","set","model.default",model]);
      }
      result={ok:true,model,target:payload.target};
    }else if(action==="restart"){
      await run("systemctl",["--user","kill","--kill-whom=main","--signal=SIGUSR1","hermes-gateway.service"]);
      result={ok:true,action:"restart_requested"};
    }else if(["settings-apply","settings-reset","settings-rollback"].includes(action)){
      const revision=integer(payload.revision,0,1e9);const operation=action.slice(9);
      const args=[settingsPath,operation,"--expected-revision",String(revision),"--actor-id",actor,"--via","cli"];
      if(operation==="apply"){
        const input=payload.settings as Record<string,unknown>;
        if(!input||typeof input!=="object")return bad();
        for(const field of settingsSchema.fields)args.push(field.flag,String(settingValue(input[field.name],field)));
        const wip=input.project_wip as Record<string,unknown>;
        if(!wip||typeof wip!=="object")return bad();
        for(const [project,count] of Object.entries(wip)){if(!/^[a-z0-9-]{1,80}$/.test(project))return bad();args.push(settingsSchema.projectWip.flag,`${project}=${settingValue(count,settingsSchema.projectWip)}`);}
      }
      result=JSON.parse(await run(node,args));
    }else if(action==="health-apply"){
      const minutes=Number(payload.minutes);if(!Number.isInteger(payload.minutes)||!settingsSchema.health.allowedIntervals.includes(minutes))return bad();
      result=JSON.parse(await run(node,[healthPath,"apply","--minutes",String(minutes),"--expected-revision",String(integer(payload.revision,0,1e9)),"--actor-id",actor]));
    }else if(action==="appearance-apply"){
      if(!validAppearance(payload.theme,payload.mode))return bad();
      result=JSON.parse(await run(node,[appearancePath,"apply","--theme",payload.theme,"--mode",String(payload.mode),"--expected-revision",String(integer(payload.revision,0,1e9)),"--actor-id",actor]));
    }else if(action==="dev-resources-apply"){
      const limits={cores:Number(payload.cores),testJobs:Number(payload.testJobs),memoryGiB:Number(payload.memoryGiB)};
      if(!validDevResources(limits))return bad();
      result=JSON.parse(await run(node,[devResourcesPath,"apply","--cores",String(limits.cores),"--test-jobs",String(limits.testJobs),"--memory-gib",String(limits.memoryGiB),"--expected-revision",String(integer(payload.revision,0,1e9)),"--actor-id",actor]));
    }else if(action==="release-apply"||action==="release-rollback"){
      const target=String(payload.target??"");if(!/^[0-9a-f]{40}$/.test(target))return bad();
      await startRelease(action==="release-apply"?["deploy",target]:["rollback","--to",target]);
      result={ok:true,action:"started",target};
    }else if(action==="composio-apply"){
      if(!["broad","read","automation"].includes(String(payload.contour)))return bad();
      const check=(await composioCheck()).find(item=>item.contour===payload.contour)!;
      if(!check.ok||!check.revision||check.revision!==payload.revision)throw new HubControlError("stale_settings");
      result=JSON.parse(await run(node,[composioPath,"apply","--contour",check.contour,"--json"]));
    }else return bad();
    // Audit only bounded action metadata, never subprocess outputs, credentials or config contents.
    try {
      await appendFile(auditPath,JSON.stringify({at:new Date().toISOString(),action,identity,target:payload.target,model:payload.model,contour:payload.contour,theme:action==="appearance-apply"?payload.theme:undefined,mode:action==="appearance-apply"?payload.mode:undefined,...(action==="dev-resources-apply"?{cores:Number(payload.cores),testJobs:Number(payload.testJobs),memoryGiB:Number(payload.memoryGiB)}:{}),outcome:result?.outcome??result?.action??"ok"})+"\n",{mode:0o600});
    }catch {
      // A completed mutation must not appear to have failed and invite a duplicate action.
      result={...result,auditWarning:true};
      console.error("Hub control completed, but its audit record could not be saved");
    }
    return result;
  }
  return {execute};
}
