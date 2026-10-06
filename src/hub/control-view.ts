import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderButton} from "../ui-library/components/button.ts";
import {renderSelectField,renderNumberField} from "../ui-library/components/form.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {renderIcon} from "../ui-library/components/icon.ts";
import type {HubLanguage} from "./render.ts";
import {settingsSchema} from "../orchestrator/settings/settings-schema.ts";

const tr=(lang:HubLanguage,ru:string,en:string)=>lang==="ru"?ru:en;
const apply=(lang:HubLanguage,disabled=false)=>renderButton({label:tr(lang,"Применить","Apply"),type:"submit",variant:"info",disabled});
export function renderControlView(action:string,result:any,lang:HubLanguage):string {
  if(action==="models")return ["hermes","codex"].map(target=>{
    const disabled=target==="hermes"&&result.hermesProvider!=="openai-codex";
    const options=[...result.models];if(!options.some(item=>item.value===result[target]))options.unshift({value:result[target],label:result[target]});
    return `<form class="control-form" data-hub-submit="model-apply" data-target="${target}" data-expected-model="${escapeHtml(result[target])}" data-effort="${escapeHtml(result.codexEffort??"")}" data-models="${escapeHtml(JSON.stringify(result.models))}"><h3>${target==="hermes"?"Hermes":tr(lang,"Codex · новые сессии","Codex · new sessions")}</h3>${renderSelectField({name:"model",label:target==="hermes"?result.hermesProvider:tr(lang,"Модель по умолчанию","Default model"),value:result[target],options,disabled})}<div class="control-actions">${apply(lang,disabled)}</div></form>`;
  }).join("");
  if(action==="settings"){
    const state=result.settings;const current=state.settings;const locked=!state.idle.idle;
    const schema=state.schema??settingsSchema;
    return `<form class="control-form" data-hub-submit="settings-apply" data-revision="${state.revision}" data-current="${escapeHtml(JSON.stringify(current))}">${locked?`<p class="control-summary">${tr(lang,"Изменение доступно после завершения активной работы","Changes unlock when active work finishes")}</p>`:""}<div class="control-fields">${schema.fields.map((field:typeof settingsSchema.fields[number])=>renderNumberField({name:field.name,label:field.label[lang],value:current[field.name],min:field.min,max:field.max,disabled:locked})).join("")}${Object.entries(current.project_wip).map(([name,value])=>renderNumberField({name:`project_wip.${name}`,label:`${name} · WIP`,value:Number(value),min:schema.projectWip.min,max:schema.projectWip.max,disabled:locked})).join("")}</div><div class="control-actions">${apply(lang,locked)}${["reset","rollback"].map(operation=>renderButton({label:operation==="reset"?tr(lang,"По умолчанию","Defaults"):tr(lang,"Откатить","Undo"),variant:operation==="reset"?"warning":"secondary",disabled:locked||operation==="rollback"&&state.revision===0,attributes:{"data-hub-control":`settings-${operation}`,"data-revision":state.revision}})).join("")}</div></form>
      <form class="control-form" data-hub-submit="health-apply" data-revision="${result.health.revision}"><h3>System Health</h3>${renderSelectField({name:"minutes",label:tr(lang,"Интервал · минуты","Interval · minutes"),value:String(result.health.intervalMinutes),options:result.health.allowedIntervals.map((minutes:number)=>({value:String(minutes),label:String(minutes)}))})}<div class="control-actions">${apply(lang)}</div></form>
      ${appearanceForm(result.appearance,lang)}`;
  }
  if(action==="composio-check")return `<p class="control-summary">${tr(lang,"Сравнение настроек с ожидаемой конфигурацией. Проверка ничего не меняет и не проверяет доступность провайдеров.","Compares settings with the expected configuration. This check changes nothing and does not test provider availability.")}</p><div class="composio-contours">${result.contours.map((item:any)=>{
    const details=(item.diff.length?renderTable({columns:[tr(lang,"Поле","Field"),tr(lang,"Сейчас","Current"),tr(lang,"Будет","Proposed")],rows:item.diff.map((entry:any)=>[String(entry.field),String(entry.before??"—"),String(entry.after??"—")])}):"")+item.warnings.map((warning:string)=>`<p class="control-summary">${escapeHtml(warning)}</p>`).join("");
    return `<section class="composio-contour"><div class="composio-contour__heading">${renderIcon(!item.ok?"alert":item.diff.length?"controls":"check")}<strong>${escapeHtml(item.contour)}</strong><span>${item.ok?`${item.tools} ${tr(lang,"инструм.","tools")}`:tr(lang,"Сбой проверки","Check failed")}</span></div><p class="composio-contour__state">${!item.ok?tr(lang,"Не удалось сравнить конфигурацию","Could not compare configuration"):item.diff.length?`${item.diff.length} ${tr(lang,"изменений","changes")}`:tr(lang,"Синхронизировано","In sync")}</p>${details?renderDisclosure({summary:tr(lang,"Подробности","Details"),body:details,variant:"inline",open:!item.ok||!!item.diff.length}):""}${item.ok&&item.diff.length?`<div class="control-actions">${renderButton({label:tr(lang,"Синхронизировать","Sync"),variant:"subtle",size:"compact",attributes:{"data-hub-control":"composio-apply","data-contour":item.contour,"data-revision":item.revision}})}</div>`:""}</section>`;
  }).join("")}</div><div class="control-actions">${renderButton({label:tr(lang,"Проверить ещё раз","Check again"),variant:"subtle",size:"compact",attributes:{"data-hub-control":"composio-check"}})}</div>`;
  return "";
}

/** Default appearance for every device that has not picked its own theme in the header menu. */
function appearanceForm(appearance:{revision:number;theme:string;mode:string|null;themes:Record<string,string[]>}|undefined,lang:HubLanguage):string {
  if(!appearance)return "";
  const labels:Record<string,string>={paper:"Paper",neon:"Neon"};
  const themes=Object.keys(appearance.themes).map(value=>({value,label:labels[value]??value}));
  const modes=[{value:"light",label:tr(lang,"Светлая","Light")},{value:"dark",label:tr(lang,"Тёмная","Dark")}];
  const mode=appearance.mode??"light";
  return `<form class="control-form" data-hub-submit="appearance-apply" data-revision="${appearance.revision}" data-themes="${escapeHtml(JSON.stringify(appearance.themes))}"><h3>${tr(lang,"Оформление","Appearance")}</h3>
    <p class="control-summary">${tr(lang,"Тема по умолчанию для всех устройств, где тема не выбрана в шапке. «Как в Hub» в меню темы возвращает устройство к ней.","The default for every device that has not picked a theme in the header. “Hub default” in the theme menu returns a device to it.")}</p>
    ${renderSelectField({name:"theme",label:tr(lang,"Тема","Theme"),value:appearance.theme,options:themes})}${renderSelectField({name:"mode",label:tr(lang,"Режим","Mode"),value:mode,options:modes})}<div class="control-actions">${apply(lang)}</div></form>`;
}
