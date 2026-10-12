// Only invoked after successful Docs promotion; never converges application runtime.
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {withDeployLock} from "../../system/deploy/lock.ts";
import {isAllowedProposalPath} from "./policy.ts";
const exec=promisify(execFile);
export type CheckoutSync={status:"synced"|"already_at_target"|"blocked";target:string;from:string|null;head:string|null;reason?:string};
function repository(url:string):string|null {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(url)?.[1]??null;
}
export async function syncDocsCheckout(options:{app:string;home:string;repo:string;target:string}):Promise<CheckoutSync> {
  const {app,home,repo,target}=options;
  let from:string|null=null,head:string|null=null;
  const git=async(...args:string[])=>(await exec("git",["-c","core.hooksPath=/dev/null",...args],{cwd:app,timeout:120_000,maxBuffer:32*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:"0"}})).stdout.trim();
  try {
    if(!/^[a-f0-9]{40}$/.test(target))throw new Error("Invalid promoted docs SHA");
    return await withDeployLock(home,async()=>{
      const guard=async()=>{
        if(repository(await git("remote","get-url","origin"))!==repo)throw new Error("The live origin does not match the docs repository");
        if(await git("symbolic-ref","--quiet","HEAD")!=="refs/heads/main")throw new Error("The live checkout is not on main");
        if(await git("status","--porcelain=v1","--untracked-files=all"))throw new Error("The live checkout has tracked or untracked changes");
        head=await git("rev-parse","HEAD");
      };
      await guard();from=head;
      if(head===target)return {status:"already_at_target",target,from,head};
      // Fetch only the promoted object, no tracking refs, tags, forced update or latest-main activation.
      try {await git("cat-file","-e",`${target}^{commit}`);}
      catch {await git("fetch","--quiet","--no-tags","--no-write-fetch-head","--no-recurse-submodules","origin",target);}
      await git("merge-base","--is-ancestor",from!,target).catch(()=>{throw new Error("The live HEAD is ahead of or divergent from the promoted docs SHA");});
      // Include side history and compare merge commits against every parent. A reverted runtime change is still blocked.
      const paths=(await git("log","--format=","--name-only","-z","--no-renames","--diff-merges=separate",`${from}..${target}`)).split("\0").filter(Boolean);
      const outside=paths.filter(path=>!isAllowedProposalPath(path));
      if(outside.length)throw new Error(`The promoted interval contains non-docs paths: ${outside.slice(0,3).join(", ")}`);
      await guard();
      if(head!==from)throw new Error("The live HEAD changed during validation");
      await git("merge","--ff-only","--no-edit","--no-autostash","-q",target);
      head=await git("rev-parse","HEAD");
      if(head!==target)throw new Error("The live checkout did not reach the exact promoted SHA");
      return {status:"synced",target,from,head};
    });
  } catch(error) {
    head=await git("rev-parse","HEAD").catch(()=>head);
    return {status:"blocked",target,from,head,reason:(error instanceof Error?error.message:String(error)).slice(0,400)};
  }
}
