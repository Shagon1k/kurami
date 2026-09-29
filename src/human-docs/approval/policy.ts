// Pure rules for owner-approved documentation proposals: identities, allowed paths and state transitions.
// Nothing here touches Git, GitHub, Discord or the docs release; the worker and controls enforce these rules.

export const PROPOSAL_ID=/^dp_[a-f0-9]{12}$/;

export type ProposalState=
  | "drafting"   // the Monday audit is writing into the draft worktree
  | "ready"      // PR open, card has Publish / Discuss / Reject
  | "revising"   // owner asked to apply the discussion; the revision agent runs
  | "publishing" // owner clicked Publish; merge + docs release in progress
  | "published"
  | "rejected"
  | "empty"      // the audit found nothing to change
  | "failed";    // the draft or a later step failed checks; the card shows why

export type OwnerAction="discuss"|"revise"|"publish"|"reject";

export const ACTIVE_STATES:readonly ProposalState[]=["drafting","ready","revising","publishing"];
export const FINAL_STATES:readonly ProposalState[]=["published","rejected","empty"];

/** Which states accept each owner click. A click on a stale card is refused, never replayed later. */
const ACCEPTS:Record<OwnerAction,readonly ProposalState[]>={
  discuss:["ready","failed"],
  revise:["ready","failed"],
  publish:["ready"],
  reject:["ready","failed"],
};

/** After a merge whose release failed, Publish retries only the release and the other actions are closed. */
export function acceptsAction(state:ProposalState,action:OwnerAction,merged=false):boolean {
  if(merged)return state==="failed"&&action==="publish";
  return ACCEPTS[action].includes(state);
}

/** State the proposal enters when the owner's click is accepted; the worker performs the slow part. */
export function stateAfterAction(action:OwnerAction):ProposalState|undefined {
  return action==="publish"?"publishing":action==="revise"?"revising":undefined;
}

/**
 * A weekly proposal may only change reader-facing docs sources, the reviewed changelog ledger,
 * the docs copy test and the coverage record. Structure, renderer, build and application code stay out.
 */
export function isAllowedProposalPath(path:string):boolean {
  if(/^src\/human-docs\/content\/[a-z-]+\.ts$/.test(path))return path!=="src/human-docs/content/schema.ts";
  return [
    "src/human-docs/changelog.json",
    "tests/human-docs/verify.ts",
    "docs/human-docs-coverage-audit.md",
  ].includes(path);
}

export function disallowedPaths(paths:readonly string[]):string[] {
  return paths.filter(path=>!isAllowedProposalPath(path));
}

export function controlId(action:OwnerAction,proposalId:string):string {
  if(!PROPOSAL_ID.test(proposalId))throw new Error(`Invalid docs proposal ID: ${proposalId}`);
  return `kurami:docs_${action}:${proposalId}`;
}

/** Branch names are dated in the owner's time zone so two proposals on one day stay distinct by ID. */
export function branchName(proposalId:string,at:Date):string {
  const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Vilnius",year:"numeric",month:"2-digit",day:"2-digit"}).format(at);
  return `docs/weekly-${day}-${proposalId.slice(3,9)}`;
}

export type ProposalSummary={summaryRu:string;summaryEn:string};

/** The agent's summary is display text only; it never selects files, commands or states. */
export function parseSummary(raw:unknown):ProposalSummary {
  if(!raw||typeof raw!=="object")throw new Error("Proposal summary must be a JSON object");
  const value=raw as Record<string,unknown>;
  const text=(key:string)=>{
    const field=value[key];
    if(typeof field!=="string"||field.trim().length<10||field.length>700)throw new Error(`Proposal summary ${key} must be 10–700 characters`);
    return field.trim().replace(/@(everyone|here)/g,"@​$1").replace(/<@[!&]?\d+>/g,"");
  };
  return {summaryRu:text("summaryRu"),summaryEn:text("summaryEn")};
}

export type PageChange={slug:string;titleRu:string;change:"added"|"changed"|"removed"};

type PageDigest=Record<string,{titleRu:string;hash:string}>;

export function changedPages(before:PageDigest,after:PageDigest):PageChange[] {
  const changes:PageChange[]=[];
  for(const [slug,page] of Object.entries(after)){
    if(!before[slug])changes.push({slug,titleRu:page.titleRu,change:"added"});
    else if(before[slug].hash!==page.hash)changes.push({slug,titleRu:page.titleRu,change:"changed"});
  }
  for(const [slug,page] of Object.entries(before))if(!after[slug])changes.push({slug,titleRu:page.titleRu,change:"removed"});
  return changes;
}
