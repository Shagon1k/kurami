// Before the Monday audit: give the agent a clean draft worktree on its own branch, or explain why not.
import {randomBytes} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {ACTIVE_STATES,branchName} from "./policy.ts";
import {docsStateDir,ProposalStore} from "./store.ts";

export type DraftAssignment=
  | {proposalId:string;path:string;summaryPath:string}
  | {blockedBy:string;state:string}
  | {error:string};

export function prepareDraft(options:{sourceRoot:string;home:string;now?:Date}):DraftAssignment {
  const now=options.now??new Date();
  const store=ProposalStore.open(options.home,()=>now);
  try{
    const active=store.inStates(ACTIVE_STATES);
    if(active.length)return {blockedBy:active[0].proposal_id,state:active[0].state};
    const proposalId=`dp_${randomBytes(6).toString("hex")}`;
    const directory=resolve(docsStateDir(options.home),"drafts",proposalId);
    const path=resolve(directory,"worktree");
    const summaryPath=resolve(directory,"summary.json");
    const branch=branchName(proposalId,now);
    const git=(...args:string[])=>execFileSync("git",["-c","core.hooksPath=/dev/null",...args],{cwd:options.sourceRoot,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
    const base=git("rev-parse","HEAD");
    mkdirSync(directory,{recursive:true,mode:0o700});
    git("worktree","add","--quiet","-b",branch,path,base);
    store.create({proposal_id:proposalId,draft_path:path,summary_path:summaryPath,branch,base_sha:base});
    return {proposalId,path,summaryPath};
  }catch(error){
    return {error:error instanceof Error?error.message.slice(0,300):String(error)};
  }finally{store.close();}
}
