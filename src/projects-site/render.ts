import { WRITER_STOP_TEXT, writerStopPresentation } from "../orchestrator/projects/writer-stop-presentation.ts";
import { codexLaunchUrl } from "../orchestrator/integrations/codex/deeplink.ts";
import { REVIEW_PROFILES } from "../orchestrator/projects/reviews/profiles.ts";
import {surfaceAttributes,LIVE_ATTRIBUTE} from "../ui-library/components/surface.ts";
import {browserStatusPresentation,statusPresentation} from "./action-presentation.ts";
import {canStartTask} from "./task-start.ts";
import {PROJECTS_CLIENT_VERSION} from "./client-version.ts";
import {escapeHtml as escape} from "../ui-library/foundations/html.ts";
import {randomUUID} from "node:crypto";
import {formatSiteDate} from "../ui-library/foundations/date.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {renderSiteFooter} from "../ui-library/patterns/site-footer.ts";
import {kuramiSites} from "../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderButton,renderLinkButton,type ButtonVariant} from "../ui-library/components/button.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderSearchField,renderSelectField,renderTextField} from "../ui-library/components/form.ts";
import {renderDialog,renderDialogActions} from "../ui-library/components/dialog.ts";
import {renderCallout} from "../ui-library/components/callout.ts";
import {renderIcon,iconPath,type IconName} from "../ui-library/components/icon.ts";
import {projectColorClass} from "../ui-library/components/project-color.ts";
import {renderPopover} from "../ui-library/components/popover.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {ciCheckUrl} from "./ci-checks.ts";
import {renderIdeasBlock} from "./ideas.ts";
import type {PrActionView} from "./pr-actions.ts";
import {renderToastRegion} from "../ui-library/components/toast.ts";
import {renderPill,type PillTone} from "../ui-library/components/pill.ts";
import {needsOwner,parseFilters,projectStageLabel,selectItems,type ProjectItem,type ProjectSummary,type ProjectsSnapshot,type Signal,type SortKey} from "./model.ts";
import {tr,sourceText,language,stateLabel,browserMessages,type Language} from "./i18n.ts";
import {renderKuramiPresence,renderKuramiState} from "../ui-library/components/kurami-mood.ts";
import {portalVoice} from "../portal-presence/voice.ts";

export function localTime(value:string|null,lang:Language="en"):string {
  if(!value||!Number.isFinite(Date.parse(value)))return tr("Unknown",lang);
  return formatSiteDate(value,lang,true);
}
function stateValue(label:string,tone:PillTone):string{return `<span class="projects-signal projects-signal--${tone}">${escape(label)}</span>`;}
function signal(value:Signal,lang:Language):string{return stateValue(stateLabel(value.state,lang),value.tone);}
type NoteTone="info"|"warning"|"failure"|"neutral";
function noteTone(state:string):NoteTone{return ["failed","rejected"].includes(state)?"failure":["uncertain","conflict","stale","unsupported","unavailable","superseded","no_head"].includes(state)?"warning":state==="ready"?"neutral":"info";}
function actionNote(label:string,tone:NoteTone="info",request?:{action:string;state:string}):string{return `<p class="projects-action-note" data-note-tone="${tone}"${request?` data-run-action-state="${escape(request.action)}" data-request-state="${escape(request.state)}" role="status"`:""}>${escape(label)}</p>`;}
function reviewFindings(item:ProjectItem,lang:Language):string {
  if(item.review.state!=="ready")return "";
  const counts=([['critical','failure'],['important','warning'],['suggestions','neutral']] as const)
    .filter(([kind])=>item.review[kind]>0).map(([kind,tone],index)=>`<span>${index?'<span aria-hidden="true">· </span>':''}<span data-note-tone="${tone}">${item.review[kind]} ${escape(tr(kind,lang))}</span></span>`).join('');
  return counts?`<p class="projects-findings">${counts}</p>`:"";
}
function previewExpiry(item:ProjectItem,lang:Language,at:string):string {
  const expiry=item.preview.expiresAt;if(!expiry||!Number.isFinite(Date.parse(expiry)))return "";
  const active=['running','outdated','expired'].includes(item.preview.state);
  const remaining=Date.parse(expiry)-Date.parse(at),warning=active&&Number.isFinite(remaining)&&remaining<=3_600_000;
  return `<p class="projects-info"${active?` data-preview-expiry="${escape(expiry)}"`:''} data-note-tone="${warning?'warning':'neutral'}">${escape(tr("Expires",lang))} ${escape(localTime(expiry,lang))}<span data-expiry-label>${active&&remaining<=0?` · ${tr("Expiry reached",lang)}`:warning?` · ${tr("Expires soon",lang)}`:""}</span></p>`;
}
function statusTone(item:ProjectItem,project:ProjectSummary):PillTone {
  return item.status===project.statuses.done?"success":item.status===project.statuses.review?"warning":item.status===project.statuses.active?"info":"neutral";
}
function runTone(item:ProjectItem):PillTone {
  if(item.taskStart)return ["failed","blocked","uncertain"].includes(item.taskStart.state)?"warning":"info";
  return item.attention.length||["waiting_human","needs_attention","preview_required"].includes(item.stage??item.runState??"")?"warning":
    ["failed","rejected"].includes(item.runState??"")?"failure":["archived","completed"].includes(item.runState??"")?"success":item.runId?"info":"neutral";
}
function itemUrl(params:URLSearchParams,id?:string):string {
  const next=new URLSearchParams(params);next.delete("item");next.delete("view");next.delete("status");
  if(id)next.set("item",id);
  return "/"+(next.size?`?${next}`:"");
}
function navigation(label:string,raw:string|null,lang:Language):string {
  if(!raw)return "";
  try{const url=new URL(raw);if(url.protocol!=="https:"||url.username||url.password)return "";}catch{return "";}
  return renderLinkButton({label:tr(label,lang),href:raw,variant:"link",iconPath:iconPath("arrow")});
}
function sortControl(key:SortKey,label:string,params:URLSearchParams,lang:Language):string {
  const filters=parseFilters(params);const selected=filters.sort===key;
  return renderButton({label:tr(label,lang),variant:"sort",className:"projects-sort",iconPath:iconPath(selected?filters.direction==="desc"?"sortDescending":"sortAscending":"sort"),iconPosition:"end",visibleLabel:true,ariaLabel:`${tr("Sort by",lang)} ${tr(label,lang)}${selected?` · ${tr(filters.direction==="desc"?"Descending":"Ascending",lang)}`:""}`,attributes:{"data-sort":key,"aria-pressed":selected?"true":"false"}});
}
function noCiEvidence(item:ProjectItem):boolean {
  return Boolean(item.writerStop && !item.ci.head && !(item.ci.checks?.length));
}
function checks(item:ProjectItem,lang:Language):string {
  return [["CI","ci",item.ci],["AI Review","review",item.review],["Preview","preview",item.preview]].map(([name,icon,value])=>{
    if(name==="CI"&&noCiEvidence(item))return "";
    const evidence=value as Signal;
    return evidence.state!=="none"?`<span class="projects-check">${renderIcon(icon as IconName)}<span class="projects-check-name">${tr(name as string,lang)}</span>${signal(evidence,lang)}</span>`:"";
  }).join("");
}
/** "1 задача ждёт", "2 задачи ждут", "5 задач ждут"; English: task / tasks. */
function yourMoveWords(count:number,lang:Language):string {
  if(lang==="en")return count===1?"task waits for you":"tasks wait for you";
  const ten=count%10,hundred=count%100;
  return ten===1&&hundred!==11?"задача ждёт тебя":ten>=2&&ten<=4&&(hundred<12||hundred>14)?"задачи ждут тебя":"задач ждут тебя";
}

export function renderProjectsDashboard(snapshot:ProjectsSnapshot,params=new URLSearchParams()):string {
  const lang=language(params),t=(key:string)=>tr(key,lang),filters=parseFilters(params),items=selectItems(snapshot,filters,lang);
  const selected=items.find(item=>item.id===params.get("item"));
  const projectOf=(item:ProjectItem)=>snapshot.projects.find(project=>project.key===item.project)!;
  const remaining=selectItems(snapshot,{...filters,activeOnly:false,attentionOnly:false,remainingOnly:true,sort:null}).length;
  const attention=selectItems(snapshot,{...filters,activeOnly:false,attentionOnly:true,remainingOnly:false,sort:null}).length;
  const active=selectItems(snapshot,{...filters,activeOnly:true,attentionOnly:false,remainingOnly:false,sort:null}).length;
  const counter=(key:"remaining"|"active"|"attention",count:number,label:string,icon:IconName,pressed:boolean,title:string)=>renderButton({label:t(label),compactLabel:"",count,variant:"toggle",iconPath:iconPath(icon),visibleLabel:true,attributes:{"data-task-filter":key,"aria-pressed":pressed?"true":"false",title:t(title)}});
  const delayed=!snapshot.available||snapshot.projects.some(project=>project.freshness!=="fresh");
  const freshBody=`<ul class="projects-sync-list list-reset">${snapshot.projects.map(project=>`<li><div>${navigation(project.name,project.boardUrl,lang)}${stateValue(t(project.freshness==="fresh"?"Updated":project.freshness==="stale"?"Stale data":"No snapshot"),project.freshness==="fresh"?"success":"warning")}</div><time>${escape(localTime(project.capturedAt,lang))}</time></li>`).join("")}</ul><p class="projects-update">${t("Checked")} ${escape(localTime(snapshot.generatedAt,lang))} · ${t("Vilnius")}<br>${t("Refreshes every 30 seconds")}</p>`;
  const columns=[t("Task"),t("Status"),"Kurami",t("Checks")];
  const table=items.length?renderTable({className:"projects-table",stack:true,rowHeaders:true,columns,
    headers:[{html:sortControl("task","Task",params,lang)},{html:sortControl("status","Status",params,lang)},{html:sortControl("kurami","Kurami",params,lang)},{html:`<span class="projects-checks-heading">${t("Checks")}</span>`}],
    sortDirections:(["task","status","kurami",null] as const).map(key=>key&&filters.sort===key?filters.direction==="desc"?"descending":"ascending":"none"),
    rowClassNames:items.map(item=>`projects-row${projectOf(item).color?` ${projectColorClass(projectOf(item).color!)}`:""}${needsOwner(item,projectOf(item))?" projects-row--attention":""}${selected?.id===item.id?" projects-row--selected":""}`),
    rows:items.map(item=>{
      const project=projectOf(item),identifier=item.number?`#${item.number}`:t("Draft"),evidence=checks(item,lang);
      return [{html:`<div class="projects-task" data-search="${escape(`${project.name} ${identifier} ${item.title} ${item.status??""}`.toLocaleLowerCase(lang))}"><div class="projects-task-meta"><span class="project-identity">${renderIcon((project.icon??"project") as IconName)}<span>${escape(project.name)}</span></span><span class="projects-task-id">${escape(identifier)}</span>${needsOwner(item,project)?`<span class="projects-attention" title="${t("Your decision needed")}">${renderIcon("alert")}<span class="sr-only">${t("Your decision needed")}</span></span>`:""}</div>${renderLinkButton({label:item.title||t("Untitled task"),href:itemUrl(params,item.id),variant:"text",attributes:{"data-item-link":item.id}})}${item.suggestedNext?`<div class="projects-suggestion">${renderPill({label:t("Suggested next"),tone:"info",icon:"spark",title:t("Suggested in Discord digest")})}</div>`:""}</div>`},
        {html:renderPill({label:item.status??t("No status"),tone:statusTone(item,project)})+(item.statusChange?.request&&["checking","writing","awaiting_sync","uncertain"].includes(item.statusChange.request.state)?`<small class="projects-status-pending">${renderIcon("refresh")}${escape(item.statusChange.request.target)}</small>`:"")},
        {html:`<div class="projects-stage">${stateValue(projectStageLabel(item,lang),runTone(item))}${item.owner==="cli"?`<small>${renderIcon("bot")}AI Agent</small>`:item.owner==="remote"?`<small>${renderIcon("person")}${t("You have control")}</small>`:""}</div>`},
        {html:evidence?`<div class="projects-checks">${evidence}</div>`:"—"}];
    })}):!snapshot.available?renderKuramiState({mood:"found-problem",title:t("Table unavailable"),text:t("The latest snapshot could not be read.")})
    :filters.attentionOnly?renderKuramiState({mood:"idle",title:t("Nothing is waiting for you"),text:t("Kurami will show tasks here when they need your answer.")})
    :renderKuramiState({mood:"idle",title:t("No matching tasks"),text:t("Try another project or search.")});
  // "Your move": the owner filter shows Kurami with open hands above the tasks that wait for an answer.
  const voice=filters.attentionOnly&&items.length?portalVoice({portal:"projects",mood:"needs-decision",reason:"owner-attention",facts:{count:items.length,project:filters.project}},lang):null;
  const firstTask=new URLSearchParams(params);if(items.length)firstTask.set("item",items[0]!.id);
  const yourMove=voice?renderKuramiPresence({...voice,mood:"needs-decision",className:"projects-your-move",meta:`<p>${items.length} ${yourMoveWords(items.length,lang)}</p>`,action:renderLinkButton({label:t("Open task"),href:`/?${firstTask}`,variant:"secondary",attributes:{"data-item-link":items[0]!.id}})}):"";
  const mobileSort=renderSelectField({name:"sort",label:t("Sort by"),value:filters.sort?`${filters.sort}:${filters.direction}`:"",options:[{value:"",label:t("Default order")},...([['task','Task'],['status','Status'],['kurami','Kurami']] as const).flatMap(([key,label])=>[{value:`${key}:asc`,label:`${t(label)} · ↑ ${t("Ascending")}`},{value:`${key}:desc`,label:`${t(label)} · ↓ ${t("Descending")}`}])]});
  return `<div class="projects-overview"><div class="projects-summary"><p>${renderIcon("project")}<span><strong data-visible-count>${items.length}</strong> ${t("of")} ${snapshot.items.length} ${t("tasks")}</span></p><div class="projects-filters">${counter("remaining",remaining,"remaining","sections",filters.remainingOnly,"Tasks not marked as Done, including Backlog and Deferred.")}${counter("active",active,"active","work",filters.activeOnly,"Tasks in progress or waiting for your attention.")}${counter("attention",attention,"need you","alert",filters.attentionOnly,"Tasks waiting for your attention.")}</div></div><div class="projects-sync"><span class="projects-sync-indicator projects-sync-indicator--${delayed?"delayed":"fresh"}" aria-hidden="true"></span>${renderButton({label:`${t("Sync")} · ${t(delayed?"Delayed":"Up to date")}`,compactLabel:lang==="ru"?t("Sync short"):t("Sync"),iconPath:iconPath("refresh"),visibleLabel:true,variant:"quiet",attributes:{popovertarget:"projects-sync-popover","data-sync-trigger":true,title:`${t("Sync")} · ${t(delayed?"Delayed":"Up to date")}`}})}${renderPopover({id:"projects-sync-popover",label:t("Sync"),body:freshBody})}</div></div>
    <div class="projects-mobile-sort" aria-label="${t("Sort by")}">${mobileSort}</div>
    ${snapshot.available?"":renderCallout({tone:"warning",title:t("Data temporarily unavailable"),body:t("Check the current state in GitHub or Discord.")})}
    <div class="projects-grid${selected?" projects-grid--detail":""}"><div class="projects-table-frame"${surfaceAttributes("lead",{quiet:true})}>${yourMove}${table}${items.length>10?`<div class="projects-more" data-tasks-more hidden>${renderButton({label:t("Show more"),variant:"quiet",attributes:{"data-show-more-tasks":true}})}</div>`:""}<div data-search-empty hidden>${renderCallout({tone:"note",title:t("No tasks match your search."),body:""})}</div></div>${selected?detail(selected,params,projectOf(selected),snapshot.generatedAt):""}</div>`;
}
function ciDetails(item:ProjectItem,project:ProjectSummary,lang:Language):string {
  const checks=item.ci.checks??[],t=(key:string)=>tr(key,lang);
  if(!checks.length)return item.ci.state!=="none"?`<p class="projects-action-note">${t("Check details unavailable")}</p>`:"";
  const rows=checks.map(check=>{
    const tone:Signal["tone"]=check.state==="passed"?"success":check.state==="failed"?"failure":check.state==="missing"?"warning":"neutral";
    const icon:IconName=check.state==="passed"?"check":check.state==="failed"?"close":check.state==="pending"?"clock":"alert";
    const url=ciCheckUrl(check.detailsUrl,project.repository),label=check.state==="missing"?t("Check not reported"):stateLabel(check.state,lang);
    const description=`${check.name} · ${label}`;
    const name=url?renderLinkButton({label:check.name,href:url,variant:"text",truncate:true,ariaLabel:`${description} · ${t("Open check in GitHub")}`,attributes:{title:description}}):`<span class="projects-ci-check-name">${escape(check.name)}</span><span class="sr-only"> · ${escape(label)}</span>`;
    return `<li class="projects-ci-check" title="${escape(description)}"><div class="projects-ci-check-content">${name}</div><span class="projects-ci-mark projects-ci-mark--${tone}" aria-hidden="true">${renderIcon(icon)}</span></li>`;
  }).join("");
  return renderDisclosure({summary:`${t("Checks")} · ${checks.length}`,variant:"inline",className:"projects-ci-details",key:`ci:${item.id}:${item.ci.head??"unknown"}`,open:checks.some(check=>["failed","missing"].includes(check.state)),body:`<ul class="projects-ci-checks">${rows}</ul>${item.ci.observedAt?`<p class="projects-update">${t("Checked")} ${escape(localTime(item.ci.observedAt,lang))}</p>`:""}`});
}
function previewReviewNote(item:ProjectItem,lang:Language):string {
  if(!item.preview.reviewed)return "";
  const current=Boolean(item.preview.head&&item.preview.head===item.ci.head);
  const verified=Boolean(item.preview.head&&item.ci.head);
  const state=current?"current":verified?"outdated":"unverified";
  return '<p class="projects-preview-review" data-preview-review="'+state+'">'+renderPill({label:tr(current?"Preview reviewed":verified?"Reviewed for an earlier commit":"Preview review not verified",lang),tone:current?"success":"warning",icon:current?"check":"alert"})+'</p>';
}
function reviewPanel(item:ProjectItem,lang:Language,commonHead:string|null):string {
  const t=(key:string)=>tr(key,lang);
  const reviews=item.reviews??{general:{...item.review,url:item.links.review,requestFailed:Boolean(item.reviewRequestFailed),control:item.aiReview,fix:item.reviewFix,fixActions:item.runActions,fixStartupFailure:item.reviewFixStartupFailure},clarity:{state:"none",tone:"neutral" as const,head:null,critical:0,important:0,suggestions:0,url:null,requestFailed:false}};
  if(item.writerStop&&!item.ci.head&&REVIEW_PROFILES.every(profile=>reviews[profile].state==="none"&&!reviews[profile].requestFailed&&!reviews[profile].fix&&!reviews[profile].fixStartupFailure))
    return "";
  const menu=(label:string,body:string,enabled:boolean)=>{
    if(!body)return "";
    const id=`projects-review-menu-${randomUUID()}`;
    return `<div class="projects-action-menu">`+renderButton({label:t(label),iconPath:iconPath("chevronDown"),visibleLabel:true,variant:"subtle",size:"compact",disabled:!enabled,attributes:{popovertarget:id,"aria-expanded":"false"}})+renderPopover({id,label:t(label),body:`<div class="projects-review-options projects-action-options">${body}</div>`})+`</div>`;
  };
  const fixActive=Object.values(reviews).some(review=>review.fix&&["queued","running","waiting_ci","resolving"].includes(review.fix.state));
  const launch=REVIEW_PROFILES.map(profile=>{
    const review=reviews[profile],control=review.control;
    if(!control||!item.runId||control.reason==="ready"||fixActive)return "";
    return renderButton({label:profile==="general"?"🔎 General":"🧩 Clarity",variant:"quiet",disabled:!control.enabled,busyLabel:t("Sending…"),attributes:{"data-review-profile":profile,"data-review-run":item.runId,"data-review-project":item.project,"data-review-item":item.id,"data-review-head":control.head??"","data-review-key":randomUUID()}});
  }).join("");
  const fixActions=item.runActions;
  const fixAction=fixActions?.actions.find(action=>action.action==="review_fix");
  const fixes=fixAction&&item.runId?renderButton({label:t("Fix findings"),iconPath:iconPath("work"),visibleLabel:true,variant:"secondary",size:"compact",disabled:!fixAction.enabled,busyLabel:t("Sending…"),attributes:{"data-review-fix-all":"true","data-run-action":"review_fix","data-run-id":item.runId,"data-run-project":item.project,"data-run-item":item.id,"data-run-fingerprint":fixActions!.fingerprint,"data-run-key":randomUUID()}}):"";
  const fixMessages:Record<string,string>={queued:"Review fixes queued.",running:"Fixing review findings…",waiting_ci:"Review fixes pushed. Waiting for CI.",resolving:"Checking fixes and resolving review threads.",succeeded:"Review fixes completed.",needs_attention:"Review fixes need attention. Check GitHub or Discord."};
  const rows=REVIEW_PROFILES.map(profile=>{
    const review=reviews[profile];
    const findings=reviewFindings({...item,review},lang);
    const fix=review.fix;
    const fixAction=review.fixActions?.actions.find(action=>action.action==="review_fix");
    const actionStates:Record<string,string>={pending:"Queued",processing:"Running",failed:"Not completed — check the state",rejected:"Rejected — check the state"};
    const fixBusy=fix&&["queued","running","waiting_ci","resolving"].includes(fix.state);
    const progress=fix&&fixMessages[fix.state]?`<p class="projects-action-note" data-review-fix-state="${escape(fix.state)}" data-note-tone="${fix.state==="needs_attention"?"warning":fix.state==="succeeded"?"neutral":"info"}" role="status">${escape(t(fixMessages[fix.state]!)+(fix.round?` · ${t("Round")} ${fix.round}`:""))}</p>`:"";
    const requestNote=fixAction?.state&&!fixBusy?actionNote(`${sourceText(fixAction.label,lang)} · ${t(actionStates[fixAction.state]??"")}`,noteTone(fixAction.state),{action:"review_fix",state:fixAction.state}):"";
    const note=progress+requestNote;
    const link=review.url?renderLinkButton({label:t("Open review"),href:review.url,variant:"quiet",size:"compact",iconPath:iconPath("review")}):"";
    const failure=review.requestFailed?actionNote(`${t("AI Review did not start")}. ${t("Refresh and retry for the current PR commit.")}`,"warning"):review.fixStartupFailure?actionNote(t(review.fixStartupFailure),"warning"):"";
    return `<div class="projects-review-profile" data-review-result="${profile}"><div class="projects-evidence-heading"><span class="projects-evidence-label"><strong>${profile==="general"?"🔎 General":"🧩 Clarity"}</strong></span>${signal(review,lang)}</div>${review.head&&review.head!==commonHead?`<code title="${escape(review.head)}">${escape(review.head.slice(0,12))}</code>`:""}${findings}${link}${note}${failure}</div>`;
  }).join("");
  return `<div class="projects-evidence-row"><div class="projects-evidence-label">${renderIcon("review")}<strong>${t("AI Review")}</strong></div><div class="projects-review-controls">${menu("Run review",launch,REVIEW_PROFILES.some(profile=>reviews[profile].control?.enabled))}${fixes}</div>${rows}</div>`;
}
function writerContext(item:ProjectItem,lang:Language):string {
  if(!item.writerStop)return item.detail?`<p class="projects-context">${escape(tr(sourceText(item.detail,lang),lang))}</p>`:"";
  const t=(key:string)=>tr(key,lang),url=codexLaunchUrl(item.writerStop.threadId);
  const open=url?renderLinkButton({label:t(WRITER_STOP_TEXT.session),href:url,variant:"subtle",size:"compact",iconPath:iconPath("arrow"),attributes:{"data-codex-session":true}}):"";
  const details=renderDisclosure({summary:t(WRITER_STOP_TEXT.report),variant:"inline",key:`writer-stop:${item.runId}:${item.writerStop.threadId??"unknown"}`,body:`<p class="projects-writer-report">${escape(item.writerStop.report??t(WRITER_STOP_TEXT.noReport))}</p>`});
  const presentation=writerStopPresentation(Boolean(item.links.pr));
  return renderCallout({tone:"warning",title:t(presentation.label),className:"projects-writer-stop",body:{html:`<p class="projects-writer-summary">${t(presentation.detail)}</p><div class="projects-writer-stop-actions">${open}</div>${details}`}});
}
function detail(item:ProjectItem,params:URLSearchParams,project:ProjectSummary,at:string):string {
  const lang=language(params),t=(key:string)=>tr(key,lang);
  const fixActive=Boolean(item.reviewFix&&["queued","running","waiting_ci","resolving"].includes(item.reviewFix.state));
  const heads=[item.ci.head,item.review.head,item.preview.head];
  const commonHead=heads.every(head=>head&&head===heads[0])?heads[0]:null;
  const evidence=(name:string,icon:IconName,value:Signal,extra="")=>`<div class="projects-evidence-row"><div class="projects-evidence-heading"><div class="projects-evidence-label">${renderIcon(icon)}<strong>${t(name)}</strong></div>${signal(value,lang)}</div>${!commonHead&&value.state!=="none"?`<code title="${escape(value.head??"")}">${value.head?escape(value.head.slice(0,12)):t("Unverified")}</code>`:""}${extra}</div>`;
  const resource=(name:string,url:string|null,icon:IconName)=>navigation(name,url,lang)?renderLinkButton({label:t(name),href:url!,variant:"subtle",size:"compact",iconPath:iconPath(icon)}):"";
  const reviewContent=reviewPanel(item,lang,commonHead);
  const ciContent=noCiEvidence(item)?`<p class="projects-evidence-availability">${t(reviewContent?WRITER_STOP_TEXT.noCi:WRITER_STOP_TEXT.noEvidence)}</p>`:evidence("CI","ci",item.ci,ciDetails(item,project,lang)+runActions(item,lang,["ci_repair"]));
  const links=resource("Issue",item.links.issue,"project")+resource("PR",item.links.pr,"branch")+resource("Discord",item.links.discord,"message");
  const editor=statusForm(item,lang,project);
  const statusEditor=editor?`<div class="projects-status-editor">${editor}</div>`:"";
  return `<aside class="projects-detail" id="project-details" data-detail-item="${escape(item.id)}" aria-labelledby="project-details-title" tabindex="-1"><div class="projects-detail-top"><p class="projects-detail-meta">${renderIcon("project")}${escape(project.name)}<span class="projects-task-id">${item.number?`#${item.number}`:t("Draft")}</span></p>${renderLinkButton({label:t("Back to tasks"),href:itemUrl(params),variant:"quiet",attributes:{"data-item-close":true}})}</div><h2 id="project-details-title">${escape(item.title||t("Untitled task"))}</h2><div class="projects-detail-badges">${renderPill({label:item.status??t("No status"),tone:statusTone(item,project)})}${stateValue(projectStageLabel(item,lang),runTone(item))}${item.suggestedNext?renderPill({label:t("Suggested next"),tone:"info",icon:"spark"}):""}</div><div class="projects-links">${links}</div>
    ${item.suggestedNext?`<div class="projects-recommendation">${renderIcon("spark")}<p>${escape(sourceText(item.suggestedNext.explanation,lang))}</p></div>`:""}
    ${statusEditor}${!fixActive?writerContext(item,lang):""}
    <section class="projects-detail-section"><h3>${renderIcon("ci")}${t("Evidence")}</h3>${commonHead?`<p class="projects-update">${t("Current commit")} <code title="${escape(commonHead)}">${escape(commonHead.slice(0,12))}</code></p>`:""}<div class="projects-evidence">${ciContent}${reviewContent}${evidence("Preview","preview",item.preview,`${previewReviewNote(item,lang)}${previewExpiry(item,lang,at)}${runActions(item,lang,["preview_start","preview_reviewed","preview_stop"],resource("Open preview",item.links.preview,"arrow"))}`)}</div>
    </section>${runActionControls(item,lang)}${item.runUpdatedAt?`<p class="projects-update">${t("Updated")} ${escape(localTime(item.runUpdatedAt,lang))}</p>`:""}</aside>`;
}
function runActionControls(item:ProjectItem,lang:Language):string {
  if(!item.runActions||!item.runId)return "";
  const t=(key:string)=>tr(key,lang);
  if(item.runActions.reason==="unavailable")return actionNote(t("Run controls are not available yet."),"warning");
  const pr=item.prControlsEnabled||item.prActions?`<div class="projects-run-action" data-pr-slot data-pr-project="${escape(item.project)}" data-pr-item="${escape(item.id)}">${renderProjectPrControl(item.prActions,lang)}</div>`:"";
  const controls=runActions(item,lang,["retry","take_control","recover_managed_task","recover_interrupted_review_fix"])+runActions(item,lang,["stop","discard_local","discard_published"],"",pr);
  const sections=controls?`<div class="projects-detail-section projects-run-actions">${controls}</div>`:"";
  return (item.runActions.reason==="stale"?actionNote(t("Wait for fresh sync data."),"warning"):"")+sections;
}
export function renderProjectPrControl(view:PrActionView|undefined,lang:Language):string {
  const t=(key:string)=>tr(key,lang);
  if(!view)return renderButton({label:t("Checking PR…"),variant:"subtle",iconPath:iconPath("refresh"),visibleLabel:true,size:"compact",disabled:true})+'<div class="projects-run-action-meta"></div>';
  if(!view.action)return renderButton({label:t(["PR merged.","PR closed."].includes(view.reason)?view.reason:"Merge PR"),variant:"subtle",iconPath:iconPath("branch"),visibleLabel:true,size:"compact",disabled:true})+`<div class="projects-run-action-meta">${actionNote(t(view.reason),view.noteTone??"warning")}</div>`;
  if(view.checkOnly)return renderButton({label:t("Check result"),variant:"subtle",iconPath:iconPath("refresh"),visibleLabel:true,size:"compact",disabled:!view.enabled,busyLabel:t("Sending…"),attributes:{"data-pr-action":view.action,"data-pr-check":true,"data-pr-method-value":view.method??"","data-pr-head":view.head,"data-pr-fingerprint":view.fingerprint,"data-pr-key":view.key}})+`<div class="projects-run-action-meta">${actionNote(t(view.reason),view.noteTone??"info")}</div>`;
  const merge=view.action==="merge",id=`projects-pr-confirm-${randomUUID()}`;
  const button=renderButton({label:t(merge?"Merge PR":"Ready for review"),variant:merge?"success":"subtle",iconPath:iconPath(merge?"branch":"check"),visibleLabel:true,size:"compact",disabled:!view.enabled,busyLabel:t("Sending…"),attributes:{"data-pr-action":view.action,"data-pr-head":view.head,"data-pr-fingerprint":view.fingerprint,"data-pr-key":randomUUID(),"data-pr-confirm-target":id,"aria-expanded":"false","aria-controls":id}});
  const note=view.reason?actionNote(t(view.reason),view.noteTone??(view.enabled?"info":"warning")):"";
  const labels={squash:"Squash",rebase:"Rebase",merge:"Merge commit"};
  const confirmLabels={squash:"Squash and merge",rebase:"Rebase and merge",merge:"Create merge commit"};
  const choices=merge?`<div class="projects-pr-methods projects-action-options" data-pr-choices>${view.methods.map(method=>renderButton({label:t(labels[method]),variant:"quiet",attributes:{"data-pr-method":method,"data-pr-confirm-label":t(confirmLabels[method])}})).join("")}</div>`:"";
  const confirm=`<div data-pr-confirmation${merge?" hidden":""}><p class="projects-action-note">${escape(t(merge?"Merge this PR into":"Mark this draft ready for review"))} ${merge?escape(view.base):""} · #${view.number} · <code>${escape(view.head.slice(0,12))}</code>?</p><div class="projects-confirm-buttons">${renderButton({label:t("Cancel"),variant:"quiet",attributes:{"data-pr-dismiss":true}})}${renderButton({label:t(merge?"Confirm merge":"Confirm"),variant:merge?"success":"subtle",attributes:{"data-pr-confirm":true,"data-haptic":"confirm"}})}</div></div>`;
  return button+`<div class="projects-run-action-meta">${note}<div class="projects-pr-popover projects-action-menu">${renderPopover({id,label:t(merge?"Merge method":"Ready for review"),body:choices+confirm})}</div></div>`;
}
function runActions(item:ProjectItem,lang:Language,actions:string[],leading="",trailing=""):string {
  const wrap=(control:string,notes="")=>`<div class="projects-run-action">${control}<div class="projects-run-action-meta">${notes}</div></div>`;
  const grid=(controls:string[],confirmations:string[]=[])=>`<div class="projects-action-grid">${Array.from({length:Math.ceil(controls.length/2)},(_,index)=>`<div class="projects-action-pair">${controls.slice(index*2,index*2+2).join("")}</div>`).join("")}${confirmations.join("")}</div>`;
  if(!item.runActions||!item.runId)return leading?grid([wrap(leading)]):"";
  const t=(key:string)=>tr(key,lang);
  const states:Record<string,string>={pending:"Queued",processing:"Running",failed:"Not completed — check the state",rejected:"Rejected — check the state"};
  const icons:Record<string,IconName>={retry:"refresh",take_control:"person",preview_start:"play",preview_stop:"close",preview_reviewed:"check",ci_repair:"ci",review_fix:"review",recover_interrupted_review_fix:"refresh",recover_managed_task:"refresh",stop:"close",discard_local:"trash",discard_published:"trash"};
  const variants:Record<string,ButtonVariant>={stop:"danger",discard_local:"danger",discard_published:"danger",ci_repair:"secondary",review_fix:"secondary",preview_stop:"warning",preview_reviewed:"success"};
  const available=item.runActions.actions.filter(action=>actions.includes(action.action));
  if(!available.length&&!leading&&!trailing)return "";
  const confirmations:string[]=[];
  const controls=available.map(action=>{
    const confirmId=action.confirmation?`projects-confirm-${randomUUID()}`:null;
    if(confirmId)confirmations.push(`<div id="${confirmId}" class="projects-action-confirmation" data-run-confirm-panel hidden><p class="projects-action-note">${escape(sourceText(action.confirmation!,lang))}</p><div class="projects-confirm-buttons">${renderButton({label:t("Cancel"),variant:"quiet",attributes:{"data-run-dismiss":true}})}${renderButton({label:t("Confirm deletion"),variant:"danger",attributes:{"data-run-confirm":true}})}</div></div>`);
    const control=renderButton({label:sourceText(action.label,lang),iconPath:iconPath(icons[action.action]!),visibleLabel:true,size:"compact",variant:variants[action.action]??"subtle",disabled:!action.enabled,busyLabel:t("Sending…"),attributes:{"data-run-action":action.action,"data-run-id":item.runId!,"data-run-project":item.project,"data-run-item":item.id,"data-run-fingerprint":item.runActions!.fingerprint,"data-run-key":randomUUID(),...(confirmId?{"data-run-confirmation":sourceText(action.confirmation!,lang),"data-run-confirm-target":confirmId}:{})}});
    const shownState=action.action==="review_fix"&&item.reviewFix&&["queued","running","waiting_ci","resolving"].includes(item.reviewFix.state)?null:action.state;
    const notes=(shownState?actionNote(`${sourceText(action.label,lang)} · ${t(states[shownState]??"")}`,noteTone(shownState),{action:action.action,state:shownState}):"")+(action.hint?actionNote(sourceText(action.hint,lang),action.enabled?"info":"warning"):"");
    return wrap(control,notes);
  });
  return grid([...(leading?[wrap(leading)]:[]),...controls,...(trailing?[trailing]:[])],confirmations);
}
function statusForm(item:ProjectItem,lang:Language,project:ProjectSummary):string {
  const control=item.statusChange;if(!control)return "";const t=(key:string)=>tr(key,lang);
  const presentation=statusPresentation(control.request?.state??control.reason);
  const pending=control.reason==="pending",request=control.request,from=pending&&request?request.from:item.status,selected=pending&&request?request.target:item.status??"";
  const waiting=Boolean(item.taskStart&&["checking","writing","awaiting_sync","awaiting_admission","starting","uncertain"].includes(item.taskStart.state));
  const start=waiting||(canStartTask(item,project)&&(!pending||(request?.from===project.statuses.backlog&&request.target===project.statuses.active)));
  if(start) {
    const labels={checking:"Requesting start…",writing:"Requesting start…",awaiting_sync:"Waiting for sync…",awaiting_admission:"Awaiting admission",starting:"Preparing task…",uncertain:"Start unconfirmed",failed:"Start work",blocked:"Start work"};
    const label=pending&&request?.checkAvailable?"Check result":item.taskStart?labels[item.taskStart.state]:"Start work";
    const note=item.taskStart?.message??(!control.enabled?presentation?.message:undefined)??"Start this task in Kurami.";
    const tone=item.taskStart?["uncertain","failed","blocked"].includes(item.taskStart.state)?"warning":"info":!control.enabled?presentation?.tone??"warning":"info";
    return `<form class="projects-status-form projects-task-start" method="post" action="/api/status" data-status-form data-start-task data-project="${escape(item.project)}" data-item="${escape(item.id)}" data-from="${escape(JSON.stringify(from))}" data-observed-at="${escape(item.observedAt)}" data-key="${pending&&request?escape(request.key):randomUUID()}" data-check="${pending}" data-target="${escape(project.statuses.active)}" data-start-state="${item.taskStart?.state??"idle"}">${renderButton({label:t(label),iconPath:iconPath(pending&&request?.checkAvailable?"refresh":"play"),visibleLabel:true,variant:"primary",type:"submit",disabled:pending?!request?.checkAvailable:waiting||!control.enabled,busyLabel:t("Requesting start…"),attributes:{"data-status-submit":true}})}<p class="projects-status-note" data-status-note data-note-tone="${tone}" role="status">${escape(t(note))}</p></form>`;
  }
  const choices=[{value:item.status??"",label:item.status??t("No status")},...control.choices.filter(choice=>choice.value!==item.status)];
  if(pending&&!choices.some(choice=>choice.value===selected))choices.push({value:selected,label:selected});
  const note=t(item.taskStart?.message??presentation?.message??"");
  const tone=item.taskStart?.state==="blocked"?"warning":presentation?.tone??noteTone(request?.state??control.reason);
  return `<form class="projects-status-form" method="post" action="/api/status" data-status-form data-project="${escape(item.project)}" data-item="${escape(item.id)}" data-from="${escape(JSON.stringify(from))}" data-observed-at="${escape(item.observedAt)}" data-key="${pending&&request?escape(request.key):randomUUID()}" data-check="${pending}" data-target="${escape(selected)}" data-hints="${escape(JSON.stringify(Object.fromEntries(control.choices.map(choice=>[choice.value,sourceText(choice.hint,lang)]))))}"><div class="projects-status-controls">${renderSelectField({name:"target",label:t("Status"),value:selected,options:choices,disabled:!control.enabled})}${renderButton({label:t(pending?"Check result":"Save"),iconPath:iconPath(pending?"refresh":"check"),visibleLabel:true,variant:pending?"subtle":"info",type:"submit",disabled:pending?!request?.checkAvailable:true,busyLabel:"…",attributes:{"data-status-submit":true}})}</div><p class="projects-status-note" data-status-note data-note-tone="${tone}" data-default-note="${escape(note)}"${control.enabled&&!request&&!item.taskStart?" hidden":""}>${escape(note)}</p></form>`;
}
/** The quick task form. `?capture=1` (from "+" in any header, a shortcut or Share → Kurami) opens it
 * prefilled: a shared title and text, the Kurami page it was sent from. Submits to /api/capture. */
export function renderCaptureDialog(snapshot:ProjectsSnapshot,params:URLSearchParams):string {
  const lang=language(params),t=(key:string)=>tr(key,lang),open=params.get("capture")==="1";
  const shared=[params.get("text"),params.get("url")].filter(Boolean).join("\n").slice(0,1000);
  const source=params.get("source")??"";
  const projects=[...snapshot.projects.map(project=>({value:project.key,label:project.name})),{value:"kurami",label:"Kurami"}];
  const wanted=params.get("project");
  const selected=wanted&&projects.some(project=>project.value===wanted)?wanted:source?"kurami":projects[0]!.value;
  // One field in the owner's own words; Kurami turns it into an issue from the project's issue form.
  const body=`<form class="projects-capture" data-capture-form data-key="${randomUUID()}" data-source="${escape(source)}" data-shared="${escape(shared)}">
    ${renderSelectField({name:"project",label:t("Project"),value:selected,options:projects})}
    ${renderTextField({name:"text",label:t("What should happen"),value:(params.get("title")??"").slice(0,4000),placeholder:t("In your own words: what is wrong or what you want"),required:true,maxLength:4000,rows:4,autofocus:true})}
    <p class="projects-capture__hint">${t("Kurami fills in the project's issue form and puts the task in Backlog.")}</p>
    ${shared?`<p class="projects-capture__context"><span>${t("Shared text")}</span>${escape(shared)}</p>`:""}
    ${source?`<p class="projects-capture__context"><span>${t("From page")}</span>${escape(source)}</p>`:""}
    ${renderDialogActions(renderButton({label:t("Cancel"),variant:"subtle",type:"button",attributes:{"data-dialog-close":true}})+renderButton({label:t("Hand to Kurami"),variant:"primary",type:"submit",busyLabel:"…",attributes:{"data-haptic":"confirm"}}))}</form>`;
  return renderDialog({id:"projects-capture",title:t("Quick task"),body,closeLabel:t("Cancel")}).replace("<dialog ",`<dialog${open?" data-open-on-load":""} `);
}

export function renderProjectsPage(snapshot:ProjectsSnapshot,params=new URLSearchParams()):string {
  const lang=language(params),t=(key:string)=>tr(key,lang),filters=parseFilters(params);
  const projectLink=(key:string)=>{const next=new URLSearchParams(params);next.delete("item");next.delete("view");next.delete("status");if(key)next.set("project",key);else next.delete("project");return "/"+(next.size?`?${next}`:"");};
  const otherLanguage=new URLSearchParams(params);otherLanguage.set("lang",lang==="en"?"ru":"en");
  return renderDocument({lang,title:"Projects · Kurami",description:lang==="en"?"Tasks and run status across projects.":"Задачи и состояние работы по всем проектам.",favicon:"/assets/favicon.svg",styles:{href:`/assets/projects.css?v=${PROJECTS_CLIENT_VERSION}`},themeScript:true,
    head:`<meta name="robots" content="noindex, nofollow"><script src="/assets/projects.js?v=${PROJECTS_CLIENT_VERSION}" defer></script>`,skipLabel:t("Skip to content"),
    header:renderSiteHeader({mobile:{app:"projects",lang},brand:{href:projectLink(""),ariaLabel:"Kurami Projects",foxSrc:"/assets/kurami-fox.webp",suffix:"Projects"},
      nav:{label:t("Projects"),scroll:true,attributes:{"data-project-tabs":true},links:[{href:projectLink(""),label:t("All projects"),mobileIcon:"projects",current:!filters.project?"page":undefined},...snapshot.projects.map(project=>({href:projectLink(project.key),label:project.name,mobileIcon:(project.icon??"project") as IconName,current:filters.project===project.key?"page" as const:undefined}))]},sites:kuramiSites("projects",lang),
      actions:renderButton({label:t("Quick task"),variant:"icon",type:"button",iconPath:iconPath("plus"),attributes:{"data-capture-open":true,"data-quick-capture":true}})+renderLinkButton({label:lang==="en"?"RU":"EN",href:`/?${otherLanguage}`,variant:"icon",ariaLabel:lang==="en"?"Switch to Russian":"Переключить на английский",attributes:{"data-language-link":true,hreflang:lang==="en"?"ru":"en"}})+renderThemeSwitch(lang)}),
    main:`<div data-projects-app data-messages="${escape(JSON.stringify(browserMessages(lang)))}" data-status-messages="${escape(JSON.stringify(browserStatusPresentation(lang)))}"><h1 class="sr-only">${t("Tasks")}</h1><div class="projects-toolbar"><form class="projects-search" role="search" method="get">${renderSearchField({name:"q",label:t("Search tasks"),labelHidden:true,icon:true,value:params.get("q")??"",placeholder:t("Search by title or issue number")})}<input type="hidden" name="lang" value="${lang}"><input type="hidden" name="remaining" value="${filters.remainingOnly?"1":"0"}"><input type="hidden" name="active" value="${filters.activeOnly?"1":""}"><input type="hidden" name="attention" value="${filters.attentionOnly?"1":""}">${filters.project?`<input type="hidden" name="project" value="${escape(filters.project)}">`:""}</form></div><div id="projects-dashboard"${LIVE_ATTRIBUTE}>${renderProjectsDashboard(snapshot,params)}</div>${renderIdeasBlock(snapshot.ideas,snapshot.projects,lang)}${renderCaptureDialog(snapshot,params)}${renderToastRegion(t("Dismiss notification"),{kurami:true})}</div>`,mainClass:"projects-page",footer:renderSiteFooter({lang,app:"Projects",updated:localTime(snapshot.generatedAt,lang)})});
}
