import {execFile} from "node:child_process";
import {promisify} from "node:util";

export type MergeMethod = "squash" | "rebase" | "merge";
export type PullRequestState = {
  id:string; url:string; head:string; base:string; state:"OPEN"|"CLOSED"|"MERGED";
  draft:boolean; canUpdate:boolean; canMerge:boolean; mergeable:string; mergeState:string;
  methods:MergeMethod[]; queued:boolean; queueEnabled:boolean; stacked:boolean; defaultBase:boolean;
  rulesKnown?:boolean;
};
export type MergeResult = {state:"pending"|"merged"|"enqueued"|"failed"; uuid:string|null};
export type PullRequestClient = {
  read(repository:string,number:number):Promise<PullRequestState>;
  ready(id:string,mutationId:string):Promise<void>;
  merge(repository:string,number:number,head:string,method:MergeMethod):Promise<MergeResult>;
  result(repository:string,number:number,uuid:string):Promise<MergeResult>;
};
export class GitHubPrRejected extends Error {}
const exec=promisify(execFile);
export const READ_PULL_REQUEST_ACTIONS=`query ProjectsPullRequest($owner:String!,$repo:String!,$number:Int!) {
  repository(owner:$owner,name:$repo) {
    nameWithOwner viewerPermission isArchived mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    defaultBranchRef { name }
    pullRequest(number:$number) {
      id url headRefOid baseRefName state isDraft viewerCanUpdate mergeable mergeStateStatus
      baseRef { branchProtectionRule { requiresLinearHistory } }
      isInMergeQueue isMergeQueueEnabled stack { id }
    }
  }
}`;
export const READY_PULL_REQUEST=`mutation ProjectsReady($id:ID!,$key:String!) {
  markPullRequestReadyForReview(input:{pullRequestId:$id,clientMutationId:$key}) {
    clientMutationId pullRequest { id isDraft }
  }
}`;

async function api(path:string,method="GET",body?:unknown):Promise<any> {
  const args=["api",path,"--method",method,"-H","Accept: application/vnd.github+json","-H","X-GitHub-Api-Version: 2026-03-10"];
  if(body!==undefined)args.push("--input","-");
  try {
    const child=exec(process.env.KURAMI_GH_BIN??"gh",args,{env:process.env,timeout:8_000,maxBuffer:1_048_576,encoding:"utf8"});
    if(body!==undefined)child.child.stdin!.end(JSON.stringify(body));
    const {stdout}=await child;
    const value=JSON.parse(stdout);
    if(value.errors?.length)throw new GitHubPrRejected("GitHub rejected the PR operation");
    return value;
  } catch(error) {
    // Transport details can contain private repository data; callers receive only a safe classification.
    if(error instanceof GitHubPrRejected)throw error;
    if(method==="PUT"&&path.endsWith("/merge-async")&&/HTTP 409\b/.test(String((error as {stderr?:string}).stderr??""))) {
      try {
        const value=JSON.parse(String((error as {stdout?:string}).stdout??"")),expected=body as {sha:string;merge_method:string};
        if(value.status==="pending"&&value.details?.expected_head_sha===expected.sha&&value.details?.merge_method===expected.merge_method)
          return value;
      } catch {}
    }
    if(/HTTP (?:400|401|403|404|405|409|422)\b/.test(String((error as {stderr?:string}).stderr??"")))
      throw new GitHubPrRejected("GitHub rejected the PR operation");
    throw new Error("GitHub PR response unavailable");
  }
}
function mergeResult(value:any):MergeResult {
  const state=value.status;
  if(!["pending","merged","enqueued","failed"].includes(state))throw new Error("GitHub merge result unavailable");
  const uuid=value.details?.uuid??null;
  if(state==="pending"&&!(typeof uuid==="string"&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(uuid)))throw new Error("GitHub merge request identity unavailable");
  return {state,uuid};
}
export function createPullRequestClient(request:typeof api=api):PullRequestClient {return {
  async read(repository,number) {
    const [owner,repo]=repository.split("/");
    const response=await request("graphql","POST",{query:READ_PULL_REQUEST_ACTIONS,variables:{owner,repo,number}});
    const r=response.data?.repository,p=r?.pullRequest;
    if(!r||r.nameWithOwner?.toLowerCase()!==repository.toLowerCase()||!p||typeof p.id!=="string"||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(p.headRefOid)||typeof p.baseRefName!=="string"||!p.baseRefName||
      !["OPEN","CLOSED","MERGED"].includes(p.state)||
      [p.isDraft,p.viewerCanUpdate,p.isInMergeQueue,p.isMergeQueueEnabled,r.isArchived,r.mergeCommitAllowed,r.squashMergeAllowed,r.rebaseMergeAllowed].some(value=>typeof value!=="boolean")||
      typeof p.mergeable!=="string"||typeof p.mergeStateStatus!=="string"||p.stack===undefined||!r.defaultBranchRef?.name||
      p.url?.toLowerCase()!==`https://github.com/${repository}/pull/${number}`.toLowerCase())throw new Error("GitHub PR identity unavailable");
    let methods:MergeMethod[]=(['squash','rebase','merge'] as const).filter(method=>r[{squash:"squashMergeAllowed",rebase:"rebaseMergeAllowed",merge:"mergeCommitAllowed"}[method]]);
    // Effective branch rules narrow repository methods, even when the owner has admin privileges.
    let rulesKnown=true;
    try {
      const branch=await request(`repos/${repository}/branches/${encodeURIComponent(p.baseRefName)}`);
      if(branch.name!==p.baseRefName||typeof branch.protected!=="boolean")throw new Error("GitHub target branch unavailable");
      const rules=branch.protected?await request(`repos/${repository}/rules/branches/${encodeURIComponent(p.baseRefName)}`):[];
      if(!Array.isArray(rules))throw new Error("GitHub branch rules unavailable");
      if(p.baseRef?.branchProtectionRule?.requiresLinearHistory===true)methods=methods.filter(method=>method!=="merge");
      for(const rule of rules) {
        if(rule.type==="required_linear_history")methods=methods.filter(method=>method!=="merge");
        if(rule.type==="pull_request"&&rule.parameters?.allowed_merge_methods!=null) {
          if(!Array.isArray(rule.parameters.allowed_merge_methods))throw new Error("GitHub merge methods unavailable");
          methods=methods.filter(method=>rule.parameters.allowed_merge_methods.includes(method));
        }
      }
    } catch {rulesKnown=false;methods=[];}
    return {id:p.id,url:p.url,head:p.headRefOid,base:p.baseRefName,state:p.state,draft:p.isDraft,
      canUpdate:!r.isArchived&&p.viewerCanUpdate,canMerge:!r.isArchived&&["WRITE","MAINTAIN","ADMIN"].includes(r.viewerPermission),
      mergeable:p.mergeable,mergeState:p.mergeStateStatus,methods,queued:p.isInMergeQueue,queueEnabled:p.isMergeQueueEnabled,
      stacked:p.stack!==null,defaultBase:p.baseRefName===r.defaultBranchRef.name,rulesKnown};
  },
  async ready(id,mutationId) {
    const value=await request("graphql","POST",{query:READY_PULL_REQUEST,variables:{id,key:mutationId}});
    const result=value.data?.markPullRequestReadyForReview;
    if(result?.clientMutationId!==mutationId||result.pullRequest?.id!==id||result.pullRequest.isDraft!==false)
      throw new Error("GitHub ready-for-review result unconfirmed");
  },
  async merge(repository,number,head,method) {
    return mergeResult(await request(`repos/${repository}/pulls/${number}/merge-async`,"PUT",{
      sha:head,merge_method:method,merge_action:"direct_merge",bypass_rules:false,
    }));
  },
  async result(repository,number,uuid) {
    return mergeResult(await request(`repos/${repository}/pulls/${number}/merge-async/${uuid}`));
  },
};}
export const githubPullRequests=createPullRequestClient();
