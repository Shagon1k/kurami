import { execFileSync } from "node:child_process";
import { createGitHubAppJwt, createGitHubAppInstallationToken, loadGitHubAppCredentialsFromFile, loadOwnerGitHubTokenFromFileSync } from "../integrations/github/app-auth.ts";

export type DecisionComment = {id:number;authorId:string;login:string;type:string;association:string;body:string;url:string};
export type DecisionThread = {id:string;resolved:boolean;outdated:boolean;comments:DecisionComment[]};
export type DecisionPull = {id:string;head:string;url:string;path:string;threads:DecisionThread[]};
export type DecisionGitHub = {
  identity(owner:string): string;
  botIdentity(): string;
  pull(repository:string,number:number,head:string): DecisionPull;
  create(pull:DecisionPull,body:string): void;
};
function requireGitHub(ok: unknown): asserts ok { if (!ok) throw new Error("Owner decision GitHub identity or bounded evidence unavailable"); }

/** All external effects are bounded; raw gh stderr and credentials never escape. */
export function ownerDecisionGitHub(home:string): DecisionGitHub {
  return decisionAdapter(loadOwnerGitHubTokenFromFileSync(home),false);
}

/** Only this adapter can publish; failed App setup never falls back to an owner token. */
export async function ownerDecisionPublisher(home:string):Promise<DecisionGitHub> {
  try {
    const credentials=await loadGitHubAppCredentialsFromFile(home);
    const app=JSON.parse(execFileSync(process.env.GH_BIN?.trim() || "gh",["api","app"],{encoding:"utf8",
      env:{...process.env,GH_TOKEN:createGitHubAppJwt(credentials.appId,credentials.privateKey)},
      timeout:15_000,maxBuffer:64*1024,stdio:["ignore","pipe","pipe"]}));
    requireGitHub(String(app.id) === credentials.appId && app.slug === "kurami-ai");
    return decisionAdapter(await createGitHubAppInstallationToken(credentials),true);
  } catch {
    const unavailable=():never=>{throw new Error("Owner decision reviewer App unavailable; check installation permissions");};
    return {identity:unavailable,botIdentity:unavailable,pull:unavailable,create:unavailable};
  }
}
function decisionAdapter(token:string,publisher:boolean):DecisionGitHub {
  const request = (endpoint:string,payload?:object): any => {
    try {
      const value = JSON.parse(execFileSync(process.env.GH_BIN?.trim() || "gh",["api","--method",payload ? "POST" : "GET",endpoint,
        ...(payload ? ["--input","-"] : [])],{encoding:"utf8",input:payload ? JSON.stringify(payload) : undefined,
        env:{...process.env,GH_TOKEN:token},timeout:15_000,maxBuffer:4*1024*1024,stdio:["pipe","pipe","pipe"]}));
      requireGitHub(!value.errors); return value;
    } catch { throw new Error("Owner decision GitHub unavailable"); }
  };
  const fields = `id isResolved isOutdated comments(first:100){nodes{databaseId body url author{__typename login ... on User{databaseId} ... on Bot{databaseId}} authorAssociation} pageInfo{hasNextPage}}`;
  return {
    identity(owner) {
      const expected = request(`users/${encodeURIComponent(owner)}`);
      requireGitHub(expected.type === "User" && Number.isSafeInteger(expected.id) && expected.id > 0 && expected.login.toLowerCase() === owner.toLowerCase());
      return String(expected.id);
    },
    botIdentity() {
      const bot=request("users/kurami-ai%5Bbot%5D");
      requireGitHub(bot.type === "Bot" && bot.login === "kurami-ai[bot]" && Number.isSafeInteger(bot.id) && bot.id>0);
      return String(bot.id);
    },
    pull(repository,number,head) {
      requireGitHub(/^[\w.-]+\/[\w.-]+$/u.test(repository) && Number.isSafeInteger(number) && number > 0);
      const [owner,name] = repository.split("/");
      const threads:DecisionThread[] = []; let after:string|null = null;
      for (let page=0;page<10;page++) {
        const value = request("graphql",{query:`query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){nameWithOwner pullRequest(number:$number){id number url state merged headRefOid files(first:1){nodes{path}} reviewThreads(first:100,after:$after){nodes{${fields}} pageInfo{hasNextPage endCursor}}}}}`,variables:{owner,name,number,after}});
        const repo = value.data?.repository, pr = repo?.pullRequest, connection = pr?.reviewThreads;
        requireGitHub(repo?.nameWithOwner === repository && pr.number === number && pr.url === `https://github.com/${repository}/pull/${number}` &&
          typeof pr.id === "string" && Array.isArray(connection?.nodes));
        if (pr.state !== "OPEN" || pr.merged !== false) throw new Error("Owner decision refused: PR is closed or merged");
        if (pr.headRefOid !== head) throw new Error("Owner decision refused: PR head changed");
        for (const t of connection.nodes) {
          requireGitHub(typeof t.id === "string" && typeof t.isResolved === "boolean" && typeof t.isOutdated === "boolean" && !t.comments?.pageInfo?.hasNextPage && Array.isArray(t.comments?.nodes) && t.comments.nodes.length > 0);
          const comments = t.comments.nodes.map((c:any):DecisionComment => {
            requireGitHub(Number.isSafeInteger(c.databaseId) && c.databaseId > 0 && typeof c.body === "string" && typeof c.author?.login === "string" && typeof c.url === "string");
            return {id:c.databaseId,body:c.body,url:c.url,authorId:String(c.author.databaseId),login:c.author.login,
              type:c.author.__typename,association:c.authorAssociation};
          });
          threads.push({id:t.id,resolved:t.isResolved,outdated:t.isOutdated,comments});
        }
        requireGitHub(typeof connection.pageInfo?.hasNextPage === "boolean");
        if (!connection.pageInfo.hasNextPage) {
          const path = pr.files?.nodes?.[0]?.path;
          requireGitHub(typeof path === "string" && path.length > 0);
          return {id:pr.id,head,url:pr.url,path,threads};
        }
        requireGitHub(typeof connection.pageInfo.endCursor === "string" && connection.pageInfo.endCursor !== after);
        after = connection.pageInfo.endCursor;
      }
      throw new Error("Owner decision review collection exceeds the bounded snapshot");
    },
    create(pull,body) {
      requireGitHub(publisher);
      request("graphql",{query:`mutation($pr:ID!,$path:String!,$body:String!){addPullRequestReviewThread(input:{pullRequestId:$pr,path:$path,subjectType:FILE,body:$body}){thread{id}}}`,
        variables:{pr:pull.id,path:pull.path,body}});
    },
  };
}
