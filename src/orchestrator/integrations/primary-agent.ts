import { codexPrimaryAgent } from "./codex/primary-agent.ts";

export type AgentAttempt = {threadId:string;turnId:string;state:"running"|"completed"|"failed"|"interrupted";errorCode:string|null;errorMessage:string|null;summary:string|null};
export type IdleAgentSession = {id:string;processId:string};
export type PrimaryAgent = {
  readAttempt:(threadId:string,worktree:string)=>AgentAttempt|null;
  inspectIdleSession:(session:string,worktree:string)=>IdleAgentSession;
  sendContinuation:(session:IdleAgentSession,prompt:string)=>void;
};

/** Provider identity is persisted per run. Unsupported providers never fall back. */
export function primaryAgent(provider:string):PrimaryAgent|null {
  return provider === "codex" ? codexPrimaryAgent : null;
}
