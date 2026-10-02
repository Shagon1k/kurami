import {escapeHtml as escape} from "../ui-library/foundations/html.ts";
import {randomUUID} from "node:crypto";
import {formatSiteDate} from "../ui-library/foundations/date.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {renderSiteFooter} from "../ui-library/patterns/site-footer.ts";
import {kuramiSites} from "../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderButton,renderLinkButton} from "../ui-library/components/button.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderSearchField,renderSelectField} from "../ui-library/components/form.ts";
import {renderCallout} from "../ui-library/components/callout.ts";
import {renderIcon,iconPath,type IconName} from "../ui-library/components/icon.ts";
import {renderPopover} from "../ui-library/components/popover.ts";
import {renderToastRegion} from "../ui-library/components/toast.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {renderPill,type PillTone} from "../ui-library/components/pill.ts";
import {needsOwner,parseFilters,selectItems,type ProjectItem,type ProjectSummary,type ProjectsSnapshot,type Signal,type SortKey} from "./model.ts";
import {tr,sourceText,language,stateLabel,browserMessages,type Language} from "./i18n.ts";

export function localTime(value:string|null,lang:Language="en"):string {
  if(!value||!Number.isFinite(Date.parse(value)))return tr("Unknown",lang);
  return formatSiteDate(value,lang,true);
}
function stateValue(label:string,tone:PillTone):string{return `<span class="projects-signal projects-signal--${tone}">${escape(label)}</span>`;}
function signal(value:Signal,lang:Language):string{return stateValue(stateLabel(value.state,lang),value.tone);}
function statusTone(item:ProjectItem,project:ProjectSummary):PillTone {
  return item.status===project.statuses.done?"success":item.status===project.statuses.review?"warning":item.status===project.statuses.active?"info":"neutral";
}
function runTone(item:ProjectItem):PillTone {
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
  return renderButton({label:tr(label,lang),variant:"quiet",className:"projects-sort",iconPath:iconPath("sort"),iconPosition:"end",visibleLabel:true,ariaLabel:`${tr("Sort by",lang)} ${tr(label,lang)}${selected?` · ${filters.direction}`:""}`,attributes:{"data-sort":key,"aria-pressed":selected?"true":"false"}});
}
function checks(item:ProjectItem,lang:Language):string {
  return [["CI","ci",item.ci],["AI Review","review",item.review],["Preview","preview",item.preview]].map(([name,icon,value])=>{
    const evidence=value as Signal;
    return evidence.state!=="none"?`<span class="projects-check">${renderIcon(icon as IconName)}<span class="projects-check-name">${tr(name as string,lang)}</span>${signal(evidence,lang)}</span>`:"";
  }).join("");
}
export function renderProjectsDashboard(snapshot:ProjectsSnapshot,params=new URLSearchParams()):string {
  const lang=language(params),t=(key:string)=>tr(key,lang),filters=parseFilters(params),items=selectItems(snapshot,filters,lang);
  const selected=items.find(item=>item.id===params.get("item"));
  const projectOf=(item:ProjectItem)=>snapshot.projects.find(project=>project.key===item.project)!;
  const attention=selectItems(snapshot,{...filters,activeOnly:false,attentionOnly:true,sort:null}).length;
  const active=selectItems(snapshot,{...filters,activeOnly:true,attentionOnly:false,sort:null}).length;
  const counter=(key:"active"|"attention",count:number,label:string,icon:IconName,pressed:boolean,title:string)=>renderButton({label:t(label),compactLabel:"",count,variant:"toggle",iconPath:iconPath(icon),visibleLabel:true,attributes:{"data-task-filter":key,"aria-pressed":pressed?"true":"false",title:t(title)}});
  const delayed=snapshot.projects.some(project=>project.freshness!=="fresh");
  const freshBody=`<ul class="projects-sync-list list-reset">${snapshot.projects.map(project=>`<li><div>${navigation(project.name,project.boardUrl,lang)}${stateValue(t(project.freshness==="fresh"?"Updated":project.freshness==="stale"?"Stale data":"No snapshot"),project.freshness==="fresh"?"success":"warning")}</div><time>${escape(localTime(project.capturedAt,lang))}</time></li>`).join("")}</ul><p class="projects-update">${t("Checked")} ${escape(localTime(snapshot.generatedAt,lang))} · ${t("Vilnius")}<br>${t("Refreshes every 30 seconds")}</p>`;
  const columns=[t("Task"),t("Status"),"Kurami",t("Checks")];
  const table=items.length?renderTable({className:"projects-table",stack:true,rowHeaders:true,columns,
    headers:[{html:sortControl("task","Task",params,lang)},{html:sortControl("status","Status",params,lang)},{html:sortControl("kurami","Kurami",params,lang)},{html:`<span class="projects-checks-heading">${t("Checks")}</span>`}],
    sortDirections:(["task","status","kurami",null] as const).map(key=>key&&filters.sort===key?filters.direction==="desc"?"descending":"ascending":"none"),
    rowClassNames:items.map(item=>`projects-row${needsOwner(item,projectOf(item))?" projects-row--attention":""}${selected?.id===item.id?" projects-row--selected":""}`),
    rows:items.map(item=>{
      const project=projectOf(item),identifier=item.number?`#${item.number}`:t("Draft"),evidence=checks(item,lang);
      return [{html:`<div class="projects-task" data-search="${escape(`${project.name} ${identifier} ${item.title} ${item.status??""}`.toLocaleLowerCase(lang))}"><div class="projects-task-meta">${renderIcon("project")}<span>${escape(project.name)}</span><span class="projects-task-id">${escape(identifier)}</span>${needsOwner(item,project)?`<span class="projects-attention" title="${t("Your decision needed")}">${renderIcon("alert")}<span class="sr-only">${t("Your decision needed")}</span></span>`:""}</div>${renderLinkButton({label:item.title||t("Untitled task"),href:itemUrl(params,item.id),variant:"text",attributes:{"data-item-link":item.id}})}${item.suggestedNext?`<div class="projects-suggestion">${renderPill({label:t("Suggested next"),tone:"info",icon:"spark",title:t("Suggested in Discord digest")})}</div>`:""}</div>`},
        {html:renderPill({label:item.status??t("No status"),tone:statusTone(item,project)})+(item.statusChange?.request&&["checking","writing","awaiting_sync","uncertain"].includes(item.statusChange.request.state)?`<small class="projects-status-pending">${renderIcon("refresh")}${escape(item.statusChange.request.target)}</small>`:"")},
        {html:`<div class="projects-stage">${stateValue(stateLabel(item.stage??item.runState,lang),runTone(item))}${item.owner==="cli"?`<small>${renderIcon("bot")}AI Agent</small>`:item.owner==="remote"?`<small>${renderIcon("person")}${t("You have control")}</small>`:""}</div>`},
        {html:evidence?`<div class="projects-checks">${evidence}</div>`:"—"}];
    })}):renderCallout({tone:"note",title:t(snapshot.available?"No matching tasks":"Table unavailable"),body:t(snapshot.available?"Try another project or search.":"The latest snapshot could not be read.")});
  return `<div class="projects-overview"><div class="projects-summary"><p>${renderIcon("project")}<span><strong data-visible-count>${items.length}</strong> ${t("of")} ${snapshot.items.length} ${t("tasks")}</span></p><div class="projects-filters">${counter("active",active,"active","work",filters.activeOnly,"Tasks in progress or waiting for your attention.")}${counter("attention",attention,"need you","alert",filters.attentionOnly,"Tasks waiting for your attention.")}</div></div><div class="projects-sync">${renderButton({label:`${t("Sync")} · ${t(delayed?"Delayed":"Up to date")}`,compactLabel:lang==="ru"?t("Sync short"):t("Sync"),iconPath:iconPath("refresh"),visibleLabel:true,variant:"quiet",attributes:{popovertarget:"projects-sync-popover","data-sync-trigger":true}})}${renderPopover({id:"projects-sync-popover",label:t("Sync"),body:freshBody})}</div></div>
    <div class="projects-mobile-sort" aria-label="${t("Sort by")}">${sortControl("task","Task",params,lang)}${sortControl("status","Status",params,lang)}${sortControl("kurami","Kurami",params,lang)}</div>
    ${snapshot.available?"":renderCallout({tone:"warning",title:t("Data temporarily unavailable"),body:t("Check the current state in GitHub or Discord.")})}
    <div class="projects-grid${selected?" projects-grid--detail":""}"><div class="projects-table-frame">${table}<div data-search-empty hidden>${renderCallout({tone:"note",title:t("No tasks match your search."),body:""})}</div></div>${selected?detail(selected,params,projectOf(selected)):""}</div>`;
}
function detail(item:ProjectItem,params:URLSearchParams,project:ProjectSummary):string {
  const lang=language(params),t=(key:string)=>tr(key,lang);
  const reasons:Record<string,string>={pending:"A review or another action is already running.",unstable:"Review is available after current work finishes.",no_head:"The current PR commit is not verified yet.",ready:"This commit has already been reviewed.",stale:"Wait for fresh sync data.",superseded:"This run is no longer current."};
  const review=item.aiReview&&item.runId?`<div class="projects-review-action">${item.aiReview.reason!=="ready"?renderButton({label:"AI Review",iconPath:iconPath("review"),visibleLabel:true,variant:"subtle",size:"compact",disabled:!item.aiReview.enabled,busyLabel:t("Sending…"),attributes:{"data-review-run":item.runId,"data-review-project":item.project,"data-review-item":item.id,"data-review-head":item.aiReview.head??"","data-review-key":randomUUID()}}):""}${!item.aiReview.enabled?`<p class="projects-action-note">${t(reasons[item.aiReview.reason]??"Review is currently unavailable.")}</p>`:""}</div>`:"";
  const heads=[item.ci.head,item.review.head,item.preview.head];
  const commonHead=heads.every(head=>head&&head===heads[0])?heads[0]:null;
  const evidence=(name:string,icon:IconName,value:Signal,extra="")=>`<div class="projects-evidence-row"><div class="projects-evidence-heading"><div class="projects-evidence-label">${renderIcon(icon)}<strong>${t(name)}</strong></div>${signal(value,lang)}</div>${!commonHead&&value.state!=="none"?`<code title="${escape(value.head??"")}">${value.head?escape(value.head.slice(0,12)):t("Unverified")}</code>`:""}${extra}</div>`;
  const findingCounts=item.review.state==="ready"?[item.review.critical?`${item.review.critical} ${t("critical")}`:"",item.review.important?`${item.review.important} ${t("important")}`:"",item.review.suggestions?`${item.review.suggestions} ${t("suggestions")}`:""].filter(Boolean).join(" · "):"";
  const resource=(name:string,url:string|null,icon:IconName)=>navigation(name,url,lang)?renderLinkButton({label:t(name),href:url!,variant:"quiet",size:"compact",iconPath:iconPath(icon)}):"";
  const links=resource("Issue",item.links.issue,"project")+resource("PR",item.links.pr,"branch")+resource("Review",item.links.review,"review")+resource("Discord",item.links.discord,"message");
  const editor=statusForm(item,lang);
  const statusEditor=editor?renderDisclosure({summary:t("Change status"),body:editor,variant:"inline",className:"projects-status-editor",key:`status-${item.id}`,open:!!item.statusChange?.request}):"";
  return `<aside class="projects-detail" id="project-details" data-detail-item="${escape(item.id)}" aria-labelledby="project-details-title" tabindex="-1"><div class="projects-detail-top"><p class="projects-detail-meta">${renderIcon("project")}${escape(project.name)}<span class="projects-task-id">${item.number?`#${item.number}`:t("Draft")}</span></p>${renderLinkButton({label:t("Back to tasks"),href:itemUrl(params),variant:"quiet",attributes:{"data-item-close":true}})}</div><h2 id="project-details-title">${escape(item.title||t("Untitled task"))}</h2><div class="projects-detail-badges">${renderPill({label:item.status??t("No status"),tone:statusTone(item,project)})}${stateValue(stateLabel(item.stage??item.runState,lang),runTone(item))}${item.suggestedNext?renderPill({label:t("Suggested next"),tone:"info",icon:"spark"}):""}</div><div class="projects-links">${links}</div>
    ${item.suggestedNext?`<div class="projects-recommendation">${renderIcon("spark")}<p>${escape(sourceText(item.suggestedNext.explanation,lang))}</p></div>`:""}
    ${statusEditor}${item.detail?`<p class="projects-context">${escape(sourceText(item.detail,lang))}</p>`:""}
    <section class="projects-detail-section"><h3>${renderIcon("ci")}${t("Evidence")}</h3>${commonHead?`<p class="projects-update">${t("Current commit")} <code title="${escape(commonHead)}">${escape(commonHead.slice(0,12))}</code></p>`:""}<div class="projects-evidence">${evidence("CI","ci",item.ci,runActions(item,lang,["ci_repair"]))}${evidence("AI Review","review",item.review,`${findingCounts?`<p class="projects-findings">${escape(findingCounts)}</p>`:""}${review}${runActions(item,lang,["review_fix"])}`)}${evidence("Preview","preview",item.preview,`${resource("Open preview",item.links.preview,"arrow")}${item.preview.expiresAt?`<p class="projects-update">${t("Expires")} ${escape(localTime(item.preview.expiresAt,lang))}</p>`:""}${runActions(item,lang,["preview_start","preview_reviewed","preview_stop"])}`)}</div>
    ${item.reviewRequestFailed?renderCallout({tone:"warning",title:t("AI Review did not start"),body:t("Refresh and retry for the current PR commit.")}):""}</section>${runActionControls(item,lang)}${item.runUpdatedAt?`<p class="projects-update">${t("Updated")} ${escape(localTime(item.runUpdatedAt,lang))}</p>`:""}</aside>`;
}
function runActionControls(item:ProjectItem,lang:Language):string {
  if(!item.runActions||!item.runId)return "";
  const t=(key:string)=>tr(key,lang);
  if(item.runActions.reason==="unavailable")return `<p class="projects-action-note">${t("Run controls are not available yet.")}</p>`;
  const groups:[string,string[]][]=[["Work",["take_control","recover_managed_task"]],["Cleanup",["stop","discard_local","discard_published"]]];
  const sections=groups.map(([group,actions])=>{
    const available=item.runActions!.actions.filter(action=>actions.includes(action.action));if(!available.length)return "";
    return `<section class="projects-detail-section projects-run-actions"><h3>${renderIcon(group==="Cleanup"?"trash":"work")}${t(group)}</h3>${runActions(item,lang,actions)}</section>`;
  }).join("");
  return (item.runActions.reason==="stale"?`<p class="projects-action-note">${t("Wait for fresh sync data.")}</p>`:"")+sections;
}
function runActions(item:ProjectItem,lang:Language,actions:string[]):string {
  if(!item.runActions||!item.runId)return "";
  const t=(key:string)=>tr(key,lang);
  const states:Record<string,string>={pending:"Queued",processing:"Running",failed:"Not completed — check the state",rejected:"Rejected — check the state"};
  const icons:Record<string,IconName>={take_control:"person",preview_start:"play",preview_stop:"close",preview_reviewed:"check",ci_repair:"ci",review_fix:"review",recover_managed_task:"refresh",stop:"close",discard_local:"trash",discard_published:"trash"};
  const available=item.runActions.actions.filter(action=>actions.includes(action.action));
  return available.length?`<div class="projects-action-grid">${available.map(action=>`<div class="projects-run-action">${renderButton({label:sourceText(action.label,lang),iconPath:iconPath(icons[action.action]!),visibleLabel:true,size:"compact",variant:action.action.startsWith("discard_")?"danger":"subtle",disabled:!action.enabled,busyLabel:t("Sending…"),attributes:{"data-run-action":action.action,"data-run-id":item.runId!,"data-run-project":item.project,"data-run-item":item.id,"data-run-fingerprint":item.runActions!.fingerprint,"data-run-key":randomUUID(),...(action.confirmation?{"data-run-confirmation":sourceText(action.confirmation,lang)}:{})}})}${action.state?`<p class="projects-action-note">${t(states[action.state]??"")}</p>`:""}${action.hint?`<p class="projects-action-note">${escape(sourceText(action.hint,lang))}</p>`:""}${action.confirmation?`<div data-run-confirm-panel hidden><p class="projects-action-note">${escape(sourceText(action.confirmation,lang))}</p><div class="projects-confirm-buttons">${renderButton({label:t("Cancel"),variant:"quiet",attributes:{"data-run-dismiss":true}})}${renderButton({label:t("Confirm deletion"),variant:"danger",attributes:{"data-run-confirm":true}})}</div></div>`:""}</div>`).join("")}</div>`:"";
}
function statusForm(item:ProjectItem,lang:Language):string {
  const control=item.statusChange;if(!control)return "";const t=(key:string)=>tr(key,lang);
  const messages:Record<string,string>={stale:"Wait for fresh sync data.",unsupported:"Project status field is not configured.",unavailable:"Status changes are not available yet.",checking:"Checking the current status in GitHub.",writing:"Saving status in GitHub.",awaiting_sync:"GitHub updated. Waiting for Kurami sync.",uncertain:"The write is unconfirmed. Check its result before another change.",conflict:"Status changed in GitHub. Check the current state.",failed:"Status change is unconfirmed. You can retry."};
  const pending=control.reason==="pending",request=control.request,from=pending&&request?request.from:item.status,selected=pending&&request?request.target:item.status??"";
  const choices=[{value:item.status??"",label:item.status??t("No status")},...control.choices.filter(choice=>choice.value!==item.status)];
  if(pending&&!choices.some(choice=>choice.value===selected))choices.push({value:selected,label:selected});
  const note=t(messages[request?.state??control.reason]??"");
  return `<form class="projects-status-form" method="post" action="/api/status" data-status-form data-project="${escape(item.project)}" data-item="${escape(item.id)}" data-from="${escape(JSON.stringify(from))}" data-observed-at="${escape(item.observedAt)}" data-key="${pending&&request?escape(request.key):randomUUID()}" data-check="${pending}" data-target="${escape(selected)}" data-hints="${escape(JSON.stringify(Object.fromEntries(control.choices.map(choice=>[choice.value,sourceText(choice.hint,lang)]))))}"><div class="projects-status-controls">${renderSelectField({name:"target",label:t("Status"),value:selected,options:choices,disabled:!control.enabled})}${renderButton({label:t(pending?"Check result":"Save"),iconPath:iconPath(pending?"refresh":"check"),visibleLabel:true,variant:"subtle",type:"submit",disabled:pending?!request?.checkAvailable:true,busyLabel:"…",attributes:{"data-status-submit":true}})}</div><p class="projects-status-note" data-status-note data-default-note="${escape(note)}"${control.enabled&&!request?" hidden":""}>${escape(note)}</p></form>`;
}
export function renderProjectsPage(snapshot:ProjectsSnapshot,params=new URLSearchParams()):string {
  const lang=language(params),t=(key:string)=>tr(key,lang),filters=parseFilters(params);
  const projectLink=(key:string)=>{const next=new URLSearchParams(params);next.delete("item");next.delete("view");next.delete("status");if(key)next.set("project",key);else next.delete("project");return "/"+(next.size?`?${next}`:"");};
  const otherLanguage=new URLSearchParams(params);otherLanguage.set("lang",lang==="en"?"ru":"en");
  return renderDocument({lang,title:"Projects · Kurami",description:lang==="en"?"Tasks and run status across projects.":"Задачи и состояние работы по всем проектам.",favicon:"/assets/favicon.svg",styles:{href:"/assets/projects.css"},themeScript:true,
    head:'<meta name="robots" content="noindex, nofollow"><script src="/assets/projects.js" defer></script>',skipLabel:t("Skip to content"),
    header:renderSiteHeader({brand:{href:projectLink(""),ariaLabel:"Kurami Projects",foxSrc:"/assets/kurami-fox.webp",suffix:"Projects"},
      nav:{label:t("Projects"),scroll:true,attributes:{"data-project-tabs":true},links:[{href:projectLink(""),label:t("All projects"),current:!filters.project?"page":undefined},...snapshot.projects.map(project=>({href:projectLink(project.key),label:project.name,current:filters.project===project.key?"page" as const:undefined}))]},sites:kuramiSites("projects",lang),
      actions:renderLinkButton({label:lang==="en"?"RU":"EN",href:`/?${otherLanguage}`,variant:"icon",ariaLabel:lang==="en"?"Switch to Russian":"Переключить на английский",attributes:{"data-language-link":true,hreflang:lang==="en"?"ru":"en"}})+renderThemeSwitch(lang)}),
    main:`<div data-projects-app data-messages="${escape(JSON.stringify(browserMessages(lang)))}"><h1 class="sr-only">${t("Tasks")}</h1><div class="projects-toolbar"><form class="projects-search" role="search" method="get">${renderSearchField({name:"q",label:t("Search tasks"),labelHidden:true,icon:true,value:params.get("q")??"",placeholder:t("Search by title or issue number")})}<input type="hidden" name="lang" value="${lang}"><input type="hidden" name="active" value="${filters.activeOnly?"1":""}"><input type="hidden" name="attention" value="${filters.attentionOnly?"1":""}">${filters.project?`<input type="hidden" name="project" value="${escape(filters.project)}">`:""}</form></div><div id="projects-dashboard">${renderProjectsDashboard(snapshot,params)}</div>${renderToastRegion(t("Dismiss notification"))}</div>`,mainClass:"projects-page",footer:renderSiteFooter({lang,app:"Projects",updated:localTime(snapshot.generatedAt,lang)})});
}
