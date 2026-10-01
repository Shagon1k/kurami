import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderButton} from "../ui-library/components/button.ts";
import {renderSelectField,renderNumberField} from "../ui-library/components/form.ts";
import {renderTable} from "../ui-library/components/table.ts";
import type {HubLanguage} from "./render.ts";
import {settingsSchema} from "../orchestrator/settings/settings-schema.ts";

const tr=(lang:HubLanguage,ru:string,en:string)=>lang==="ru"?ru:en;
const apply=(lang:HubLanguage,disabled=false)=>renderButton({label:tr(lang,"Применить","Apply"),type:"submit",variant:"primary",disabled});
export function renderControlView(action:string,result:any,lang:HubLanguage):string {
  if(action==="models")return ["hermes","codex"].map(target=>{
    const disabled=target==="hermes"&&result.hermesProvider!=="openai-codex";
    const options=[...result.models];if(!options.some(item=>item.value===result[target]))options.unshift({value:result[target],label:result[target]});
    return `<form class="control-form" data-hub-submit="model-apply" data-target="${target}" data-expected-model="${escapeHtml(result[target])}" data-effort="${escapeHtml(result.codexEffort??"")}" data-models="${escapeHtml(JSON.stringify(result.models))}"><h3>${target==="hermes"?"Hermes":tr(lang,"Codex · новые сессии","Codex · new sessions")}</h3>${renderSelectField({name:"model",label:target==="hermes"?result.hermesProvider:tr(lang,"Модель по умолчанию","Default model"),value:result[target],options,disabled})}<div class="control-actions">${apply(lang,disabled)}</div></form>`;
  }).join("");
  if(action==="settings"){
    const state=result.settings;const current=state.settings;const locked=!state.idle.idle;
    const schema=state.schema??settingsSchema;
    return `<form class="control-form" data-hub-submit="settings-apply" data-revision="${state.revision}" data-current="${escapeHtml(JSON.stringify(current))}">${locked?`<p class="control-summary">${tr(lang,"Изменение доступно после завершения активной работы","Changes unlock when active work finishes")}</p>`:""}<div class="control-fields">${schema.fields.map((field:typeof settingsSchema.fields[number])=>renderNumberField({name:field.name,label:field.label[lang],value:current[field.name],min:field.min,max:field.max,disabled:locked})).join("")}${Object.entries(current.project_wip).map(([name,value])=>renderNumberField({name:`project_wip.${name}`,label:`${name} · WIP`,value:Number(value),min:schema.projectWip.min,max:schema.projectWip.max,disabled:locked})).join("")}</div><div class="control-actions">${apply(lang,locked)}${["reset","rollback"].map(operation=>renderButton({label:operation==="reset"?tr(lang,"По умолчанию","Defaults"):tr(lang,"Откатить","Undo"),variant:"secondary",disabled:locked||operation==="rollback"&&state.revision===0,attributes:{"data-hub-control":`settings-${operation}`,"data-revision":state.revision}})).join("")}</div></form>
      <form class="control-form" data-hub-submit="health-apply" data-revision="${result.health.revision}"><h3>System Health</h3>${renderSelectField({name:"minutes",label:tr(lang,"Интервал · минуты","Interval · minutes"),value:String(result.health.intervalMinutes),options:result.health.allowedIntervals.map((minutes:number)=>({value:String(minutes),label:String(minutes)}))})}<div class="control-actions">${apply(lang)}</div></form>`;
  }
  if(action==="composio-check")return result.contours.map((item:any)=>`<section class="control-form"><h3>${escapeHtml(item.contour)} · ${item.ok?`${item.tools} tools`:tr(lang,"Сбой проверки","Check failed")}</h3>${item.diff.length?renderTable({columns:[tr(lang,"Поле","Field"),tr(lang,"Сейчас","Current"),tr(lang,"Будет","Proposed")],rows:item.diff.map((entry:any)=>[String(entry.field),String(entry.before??"—"),String(entry.after??"—")])}):`<p class="control-summary">${item.ok?tr(lang,"Синхронизировано","In sync"):"—"}</p>`}${item.warnings.map((warning:string)=>`<p class="control-summary">${escapeHtml(warning)}</p>`).join("")}${item.ok&&item.diff.length?renderButton({label:tr(lang,"Синхронизировать","Sync"),variant:"primary",attributes:{"data-hub-control":"composio-apply","data-contour":item.contour,"data-revision":item.revision}}):""}</section>`).join("");
  return "";
}
