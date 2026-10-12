// The #updates card for one docs proposal. Pure: proposal row in, Components V2 payload out.
import {actionRow,button,componentMessage,container,separator,textDisplay,type DiscordObject} from "../../discord/ui.ts";
import {acceptsAction,controlId,type PageChange} from "./policy.ts";
import {pagesOf,type ProposalRow} from "./store.ts";

const PRIMARY=1,SECONDARY=2,SUCCESS=3,DANGER=4,LINK=5;
const MAX_PAGES=12;

const accent:Record<ProposalRow["state"],number>={
  drafting:0xfee75c,ready:0x5865f2,revising:0xfee75c,publishing:0xfee75c,
  published:0x57f287,rejected:0x99aab5,empty:0x99aab5,failed:0xed4245,
};

function ownerTime(value:string):string {
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Vilnius",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})
    .formatToParts(new Date(value)).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return `${parts.day}.${parts.month} ${parts.hour}:${parts.minute}`;
}

function ownerDay(value:string):string {
  return ownerTime(value).slice(0,5);
}

function pageLines(pages:PageChange[]):string {
  if(!pages.length)return "No page changes: only the changelog ledger or internal records.";
  const verb={added:"new",changed:"changed",removed:"removed"};
  const lines=pages.slice(0,MAX_PAGES).map(page=>`• ${page.title} — ${verb[page.change]}`);
  if(pages.length>MAX_PAGES)lines.push(`• and ${pages.length-MAX_PAGES} more`);
  return lines.join("\n");
}

function statusText(row:ProposalRow):string {
  switch(row.state){
    case "drafting":return "The audit is still writing the draft.";
    case "ready":return [
      row.last_error?`The last publish attempt failed: ${row.last_error}.`:"",
      row.thread_id
        ?"Ready for your decision. Write remarks in the discussion, then click Apply remarks."
        :"Ready for your decision. The site changes only after Publish.",
    ].filter(Boolean).join(" ");
    case "revising":return "Applying the discussion remarks. The card updates once the edits pass the checks.";
    case "publishing":return "Publishing: merging the PR and releasing the docs. This takes up to a couple of minutes.";
    case "published":{
      const sync=row.checkout_sync_json?JSON.parse(row.checkout_sync_json):null;
      const note=sync?.status==="synced"||sync?.status==="already_at_target"
        ?`Server checkout synchronized to the exact docs SHA \`${sync.target}\` (docs-only; not an application deployment).`
        :`Server checkout sync pending/blocked for \`${row.published_docs_sha??"unknown"}\`${sync?.reason?`: ${sync.reason}`:""}. Docs remain published; release-drift checks remain active.`;
      return `Published. The docs were built from \`${(row.published_docs_sha??"").slice(0,7)}\`; the previous release is kept for rollback.\n${note}`;
    }
    case "rejected":return "Rejected. The PR is closed; the branch stays on GitHub.";
    case "empty":return "Nothing to change.";
    case "failed":return row.merged_sha
      ?`The PR is merged, but the release failed and the site is unchanged: ${row.last_error??"no reason recorded"}. Retry release repeats only the release.`
      :`Checks failed: ${row.last_error??"no reason recorded"}`;
  }
}

function buttons(row:ProposalRow):DiscordObject[] {
  const merged=Boolean(row.merged_sha);
  const items:DiscordObject[]=[];
  if(acceptsAction(row.state,"publish",merged))items.push(button(merged?"Retry release":"Publish",SUCCESS,controlId("publish",row.proposal_id)));
  if(row.thread_id){
    if(acceptsAction(row.state,"revise",merged))items.push(button("Apply remarks",PRIMARY,controlId("revise",row.proposal_id)));
  } else if(acceptsAction(row.state,"discuss",merged))items.push(button("Discuss",SECONDARY,controlId("discuss",row.proposal_id)));
  if(acceptsAction(row.state,"reject",merged))items.push(button("Reject",DANGER,controlId("reject",row.proposal_id)));
  if(row.pr_url)items.push(button(row.pr_number?`PR #${row.pr_number}`:"PR",LINK,undefined,row.pr_url));
  return items;
}

export function cardPayload(row:ProposalRow):DiscordObject {
  const body:DiscordObject[]=[
    textDisplay(`## Docs proposal · ${ownerDay(row.created_at)}`),
  ];
  if(row.summary_en)body.push(textDisplay(row.summary_en));
  body.push(textDisplay(pageLines(pagesOf(row))));
  body.push(separator());
  body.push(textDisplay(statusText(row)));
  if(row.thread_id&&!["published","rejected"].includes(row.state))body.push(textDisplay(`Discussion: <#${row.thread_id}>`));
  const actions=buttons(row);
  if(actions.length)body.push(actionRow(actions));
  const revisions=row.revision_count?` · remarks applied: ${row.revision_count}`:"";
  body.push(textDisplay(`-# ${row.proposal_id}${revisions} · Updated ${ownerTime(row.updated_at)}`));
  return componentMessage([container(body,accent[row.state])]);
}

/** First message of a discussion thread: how to use it, with the same guarded button as the card. */
export function threadIntroPayload(row:ProposalRow):DiscordObject {
  return componentMessage([
    textDisplay("Write here what to change in the proposal: a page, a phrase or a fact. When you are done, click Apply remarks. An agent edits the same branch, reruns the checks and updates the card. Only your messages count."),
    actionRow([button("Apply remarks",PRIMARY,controlId("revise",row.proposal_id))]),
  ]);
}
