import { execFileSync } from "node:child_process";
import { capturePrimaryAttempt } from "./primary-diagnostic.ts";
import { transcriptBusy, transcriptWaitingOnApproval } from "../../runtime/codex-terminal.ts";
import type { PrimaryAgent } from "../primary-agent.ts";

function tmux(args:string[]):string {
  return execFileSync("tmux",args,{encoding:"utf8",timeout:15000,stdio:["ignore","pipe","pipe"]}).trimEnd();
}
export function emptyPrimaryInput(transcript:string):boolean {
  const prompt=[...transcript.matchAll(/^\s*›([^\n]*)$/gmu)].at(-1)?.[1]?.trim();
  return (prompt===""||prompt==="Ask Codex to do anything")&&!transcriptBusy(transcript)&&!transcriptWaitingOnApproval(transcript);
}
export const codexPrimaryAgent:PrimaryAgent = {
  readAttempt:capturePrimaryAttempt,
  inspectIdleSession(session,worktree){
    const pane=tmux(["display-message","-p","-t",`${session}:0.0`,"#{pane_id}\t#{pane_pid}\t#{pane_current_command}\t#{pane_current_path}"]).split("\t");
    if(pane.length!==4||!/^%\d+$/.test(pane[0]!)||!/^\d+$/.test(pane[1]!)||!/^codex(?:-[\w.-]+)?$/.test(pane[2]!)||pane[3]!==worktree)
      throw new Error("The managed Codex pane changed");
    if(!emptyPrimaryInput(tmux(["capture-pane","-p","-J","-t",pane[0]!,"-S","-100"])))
      throw new Error("The agent is busy, awaiting input, or has a nonempty prompt");
    return {id:pane[0]!,processId:pane[1]!};
  },
  sendContinuation(session,prompt){
    tmux(["send-keys","-t",session.id,"-l","--",prompt]);
    tmux(["send-keys","-t",session.id,"Enter"]);
  },
};
