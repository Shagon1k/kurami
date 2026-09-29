// Owner click handler for docs proposal cards, called by the Hermes Discord plugin.
// Usage: node controls.ts <status|discuss|record-thread|revise|publish|reject> --proposal-id dp_… [--thread-id N] [--actor-id N] [--apply]
// Each action is a fast, guarded state change; merge, release and revisions happen in the worker.
// The last stdout line is JSON: {"ok":true,…} or {"ok":false,"error":…}.
import {acceptsAction,PROPOSAL_ID,stateAfterAction,type OwnerAction} from "./policy.ts";
import {ProposalStore,type ProposalRow} from "./store.ts";
import {surfaceFor,type Surface} from "./surface.ts";

process.umask(0o077);

const COMMANDS=["status","discuss","record-thread","revise","publish","reject"] as const;
type Command=typeof COMMANDS[number];

export type ControlResult={ok:true;[key:string]:unknown};

function option(args:string[],name:string):string|undefined {
  const index=args.indexOf(name);
  return index>=0?args[index+1]:undefined;
}

function publicStatus(row:ProposalRow){
  return {proposalId:row.proposal_id,state:row.state,prUrl:row.pr_url,discussionThreadId:row.thread_id,headSha:row.head_sha,merged:Boolean(row.merged_sha)};
}

function refuse(row:ProposalRow,action:OwnerAction):never {
  throw new Error(row.merged_sha&&action!=="publish"
    ?"The PR is already merged; only a release retry is available"
    :`This card is outdated: the proposal is now ${row.state}`);
}

/** Discord follow-ups are best effort and bounded: the state change is already saved and the plugin waits 15 s. */
async function bestEffort(work:()=>Promise<void>):Promise<void> {
  let timer:NodeJS.Timeout|undefined;
  try{await Promise.race([work(),new Promise<void>(done=>{timer=setTimeout(done,5000);})]);}
  catch{/* the worker re-renders on its next tick */}
  finally{clearTimeout(timer);}
}

async function refresh(surface:Surface|undefined,store:ProposalStore,proposalId:string):Promise<void> {
  if(surface)await bestEffort(()=>surface.showCard(store.get(proposalId)));
}

export async function runControl(store:ProposalStore,command:Command,proposalId:string,options:{threadId?:string;actorId?:string;apply:boolean},surface?:Surface):Promise<ControlResult> {
  if(!PROPOSAL_ID.test(proposalId))throw new Error("Invalid docs proposal ID");
  const row=store.get(proposalId);
  if(command==="status")return {ok:true,...publicStatus(row)};
  if(!options.apply)throw new Error("Refusing to change a docs proposal without --apply");
  const merged=Boolean(row.merged_sha);
  if(command==="record-thread"){
    if(!options.threadId||!/^\d+$/.test(options.threadId))throw new Error("Invalid Discord thread ID");
    if(row.thread_id)return {ok:true,...publicStatus(row)};
    if(!acceptsAction(row.state,"discuss",merged))refuse(row,"discuss");
    store.update(proposalId,{thread_id:options.threadId});
    store.event(proposalId,"thread-recorded",{actorId:options.actorId??null});
    const updated=store.get(proposalId);
    if(surface)await bestEffort(()=>surface.threadIntro(updated));
    await refresh(surface,store,proposalId);
    return {ok:true,...publicStatus(store.get(proposalId))};
  }
  const action=command as OwnerAction;
  if(!acceptsAction(row.state,action,merged))refuse(row,action);
  if(action==="discuss")return {ok:true,needsThread:!row.thread_id,title:`Docs proposal · ${row.proposal_id}`,...publicStatus(row)};
  if(action==="revise"&&!row.thread_id)throw new Error("Open the discussion and write your remarks first");
  const next=action==="reject"?"rejected":stateAfterAction(action)!;
  const changed=store.update(proposalId,{
    state:next,
    last_error:null,
    requested_by:options.actorId??null,
    requested_at:store.now(),
    requested_head_sha:action==="publish"?row.head_sha:row.requested_head_sha,
  },[row.state]);
  if(!changed)throw new Error("The proposal changed at the same moment as the click; check the card again");
  store.event(proposalId,`owner-${action}`,{actorId:options.actorId??null,headSha:row.head_sha});
  await refresh(surface,store,proposalId);
  return {ok:true,...publicStatus(store.get(proposalId))};
}

if(import.meta.main){
  const args=process.argv.slice(2);
  const command=args[0] as Command;
  let store:ProposalStore|undefined;
  try{
    if(!COMMANDS.includes(command))throw new Error(`Unknown docs proposal command: ${args[0]}`);
    const proposalId=option(args,"--proposal-id")??"";
    store=ProposalStore.open();
    const surface=command==="status"?undefined:surfaceFor(store);
    const result=await runControl(store,command,proposalId,{threadId:option(args,"--thread-id"),actorId:option(args,"--actor-id"),apply:args.includes("--apply")},surface);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }catch(error){
    process.stdout.write(`${JSON.stringify({ok:false,error:error instanceof Error?error.message:String(error)})}\n`);
    process.exitCode=1;
  }finally{store?.close();}
}
