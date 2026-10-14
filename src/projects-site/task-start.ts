import {PROJECTS_STALE_AFTER_MS,type ProjectItem,type ProjectSummary} from "./model.ts";
import type {StatusRequestRow,StatusRequestState} from "./status-state.ts";

export type TaskStart = {state:"checking"|"writing"|"awaiting_sync"|"awaiting_admission"|"starting"|"uncertain"|"failed"|"blocked";message:string};
export type ActivationEvent = {project:string;item_id:string;event_id:string;from_status:string|null;to_status:string|null;observed_at:string;processing_state:string;processing_note:string|null};
export function canStartTask(item:ProjectItem,project:ProjectSummary):boolean {
  return !item.automationExcluded&&item.kind==="Issue"&&Boolean(item.number&&item.links.issue)&&item.status===project.statuses.backlog&&
    (!item.runId||["archived","completed","cancelled","discarded","rejected"].includes(item.runState??""));
}
function blockedMessage(reason:string|null):string {
  if(reason?.startsWith("WIP limit reached:"))return "Task start is blocked by work limits. Return it to Backlog and retry when capacity is available.";
  if(reason?.startsWith("Resource guard blocked admission:"))return "Task start is blocked by resource limits. Check Hub before retrying.";
  if(reason==="Issue description is empty")return "Add an issue description, then return it to Backlog and start again.";
  if(reason==="Issue is not open or readiness metadata is missing")return "The issue is closed or its readiness could not be verified. Check GitHub before retrying.";
  if(reason?.startsWith("Live run already exists:"))return "A previous run still exists. Check its controls before starting again.";
  return "Kurami could not accept this task. Check its activity before retrying.";
}

/** Projects observes the existing status receipt and admission event; it never creates a run. */
export function taskStartProgress(item:ProjectItem,project:ProjectSummary,request:StatusRequestRow|undefined,state:StatusRequestState|null,event:ActivationEvent|undefined,runTrigger:string|null,rejection:string|null):TaskStart|undefined {
  if(item.automationExcluded)return;
  if(item.kind!=="Issue"||![project.statuses.backlog,project.statuses.active].includes(item.status??""))return;
  const requested=request?.from_status===project.statuses.backlog&&request.to_status===project.statuses.active;
  if(requested&&state&&["checking","writing","awaiting_sync","uncertain","failed"].includes(state)&&!(state==="failed"&&item.status!==project.statuses.backlog)) {
    const messages={checking:"Checking the task in GitHub before starting.",writing:"Requesting task start in GitHub.",awaiting_sync:"Start requested. Waiting for Kurami to observe the status change.",uncertain:"Task start is unconfirmed. Check the same request before trying again.",failed:"The start request failed. Check the task and retry."};
    return {state:state as keyof typeof messages,message:messages[state as keyof typeof messages]};
  }
  if(item.status!==project.statuses.active)return;
  const activation=event?.to_status===project.statuses.active&&event.from_status===project.statuses.backlog&&
    (!requested||Date.parse(event.observed_at)>=Date.parse(request!.created_at??request!.updated_at))?event:undefined;
  if(activation&&runTrigger===activation.event_id) {
    if(item.runState==="rejected")return {state:"blocked",message:blockedMessage(rejection)};
    if(item.runState==="admission_pending")return {state:"awaiting_admission",message:"Task accepted. Waiting for workspace preparation."};
    if(item.runState==="starting")return {state:"starting",message:"Kurami is preparing the workspace and agent session."};
    return;
  }
  // An older terminal run is not evidence that this activation started a new one.
  if(item.runId&&!["archived","completed","cancelled","discarded","rejected"].includes(item.runState??"")&&runTrigger!==activation?.event_id)return;
  if(activation&&["ignored","failed"].includes(activation.processing_state))return {state:"blocked",message:blockedMessage(activation.processing_note)};
  if(!activation&&project.freshness==="fresh"&&(!requested||Date.parse(item.observedAt)-Date.parse(request!.updated_at)>=PROJECTS_STALE_AFTER_MS)&&
    (!item.runId||["archived","completed","cancelled","discarded","rejected"].includes(item.runState??"")))return {state:"blocked",message:"No launch was observed. Return the task to Backlog and start it again."};
  if(!item.runId||["archived","completed","cancelled","discarded","rejected"].includes(item.runState??""))return {
    state:activation?"awaiting_admission":"awaiting_sync",message:activation?"Status confirmed. Waiting for Kurami to accept the task.":"The task is active, but no launch has been observed yet. Waiting for sync.",
  };
}
