import {resolve} from "node:path";
import {collectDocsAudit} from "./audit.ts";
import {prepareDraft} from "../approval/prepare.ts";
import {kuramiHome} from "../approval/store.ts";

/** Hermes currently schedules in UTC; only one of the two candidate ticks is 06:00 in Vilnius. */
export function isDocsAuditWindow(at:Date):boolean {
  const parts=new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Vilnius",weekday:"short",hour:"2-digit",hourCycle:"h23",
  }).formatToParts(at);
  const weekday=parts.find(part=>part.type==="weekday")?.value;
  const hour=parts.find(part=>part.type==="hour")?.value;
  return weekday==="Mon"&&hour==="06";
}

if(import.meta.main){
  if(!isDocsAuditWindow(new Date())){
    process.stdout.write('{"wakeAgent":false}\n');
  } else {
    const root=resolve(import.meta.dirname,"../../..");
    const docsBuildPath=process.env.KURAMI_DOCS_RELEASE_BUILD;
    if(!docsBuildPath)throw new Error("KURAMI_DOCS_RELEASE_BUILD is required for the scheduled audit");
    const snapshot=collectDocsAudit({
      repo:root,
      sourceRef:"HEAD",
      ledgerPath:resolve(root,"src/human-docs/changelog.json"),
      docsBuildPath,
      deploymentManifestPath:process.env.KURAMI_APP_DEPLOY_MANIFEST||undefined,
    });
    // The agent drafts into this worktree; the docs approval worker turns it into a PR and a #updates card.
    const draft=prepareDraft({sourceRoot:root,home:kuramiHome()});
    process.stdout.write(`${JSON.stringify({...snapshot,draft,wakeAgent:true})}\n`);
  }
}
