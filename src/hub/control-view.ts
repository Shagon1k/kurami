import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderButton} from "../ui-library/components/button.ts";
import {renderSelectField,renderNumberField,renderCheckbox} from "../ui-library/components/form.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {renderIcon} from "../ui-library/components/icon.ts";
import {renderInfoButton,renderInfoNote} from "../ui-library/components/info-tip.ts";
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
    return `<form class="control-form" data-hub-submit="settings-apply" data-revision="${state.revision}" data-current="${escapeHtml(JSON.stringify(current))}">${locked?`<p class="control-summary">${tr(lang,"Изменение доступно после завершения активной работы","Changes unlock when active work finishes")}</p>`:""}<div class="control-fields">${schema.fields.map((field:typeof settingsSchema.fields[number])=>renderNumberField({name:field.name,label:field.label[lang],value:current[field.name],min:field.min,max:field.max,disabled:locked})).join("")}${Object.entries(current.project_wip).map(([name,value])=>renderNumberField({name:`project_wip.${name}`,label:`${name} · WIP`,value:Number(value),min:schema.projectWip.min,max:schema.projectWip.max,disabled:locked})).join("")}</div><div class="control-actions">${apply(lang,locked)}${["reset","rollback"].map(operation=>renderButton({label:operation==="reset"?tr(lang,"По умолчанию","Defaults"):tr(lang,"Откатить","Undo"),variant:operation==="reset"?"warning":"secondary",disabled:locked||operation==="rollback"&&state.revision===0,attributes:{"data-hub-control":`settings-${operation}`,"data-revision":state.revision}})).join("")}</div></form>`+autopilotForm(result.autopilot,lang);
  }
  if(action==="server")return `${releaseSection(result.release,lang)}<form class="control-form" data-hub-submit="health-apply" data-revision="${result.health.revision}"><h3>System Health</h3>${renderSelectField({name:"minutes",label:tr(lang,"Интервал · минуты","Interval · minutes"),value:String(result.health.intervalMinutes),options:result.health.allowedIntervals.map((minutes:number)=>({value:String(minutes),label:String(minutes)}))})}<div class="control-actions">${apply(lang)}</div></form>
      ${devResourcesForm(result.devResources,lang)}`;
  if(action==="appearance")return appearanceForm(result.appearance,lang)+pushSection(lang);
  if(action==="composio-check")return `<p class="control-about">${tr(lang,"Что проверяется","What this checks")}${renderInfoButton({id:"hub-composio-about",label:tr(lang,"Что проверяется","What this checks")})}</p>${renderInfoNote({id:"hub-composio-about",text:tr(lang,"Сравнение настроек с ожидаемой конфигурацией. Проверка ничего не меняет и не проверяет доступность провайдеров.","Compares settings with the expected configuration. This check changes nothing and does not test provider availability.")})}<div class="composio-contours">${result.contours.map((item:any)=>{
    const details=(item.diff.length?renderTable({columns:[tr(lang,"Поле","Field"),tr(lang,"Сейчас","Current"),tr(lang,"Будет","Proposed")],rows:item.diff.map((entry:any)=>[String(entry.field),String(entry.before??"—"),String(entry.after??"—")])}):"")+item.warnings.map((warning:string)=>`<p class="control-summary">${escapeHtml(warning)}</p>`).join("");
    return `<section class="composio-contour"><div class="composio-contour__heading">${renderIcon(!item.ok?"alert":item.diff.length?"controls":"check")}<strong>${escapeHtml(item.contour)}</strong><span>${item.ok?`${item.tools} ${tr(lang,"инструм.","tools")}`:tr(lang,"Сбой проверки","Check failed")}</span></div><p class="composio-contour__state">${!item.ok?tr(lang,"Не удалось сравнить конфигурацию","Could not compare configuration"):item.diff.length?`${item.diff.length} ${tr(lang,"изменений","changes")}`:tr(lang,"Синхронизировано","In sync")}</p>${details?renderDisclosure({summary:tr(lang,"Подробности","Details"),body:details,variant:"inline",open:!item.ok||!!item.diff.length}):""}${item.ok&&item.diff.length?`<div class="control-actions">${renderButton({label:tr(lang,"Синхронизировать","Sync"),variant:"subtle",size:"compact",attributes:{"data-hub-control":"composio-apply","data-contour":item.contour,"data-revision":item.revision}})}</div>`:""}</section>`;
  }).join("")}</div><div class="control-actions">${renderButton({label:tr(lang,"Проверить ещё раз","Check again"),variant:"subtle",size:"compact",attributes:{"data-hub-control":"composio-check"}})}</div>`;
  return "";
}

/** Push notifications on this device. Hidden until the browser proves it can receive them (client.js). */
function pushSection(lang:HubLanguage):string {
  return `<section class="control-form push-settings" data-push-settings hidden><h3>${tr(lang,"Уведомления на этом устройстве","Notifications on this device")}</h3>
    <p class="control-about">${tr(lang,"Когда задача ждёт тебя, что-то сломалось или вышел дайджест, Kurami пришлёт уведомление. Нажатие открывает нужную карточку.","When a task waits for you, something breaks or the Digest is out, Kurami sends a notification. A tap opens the right card.")}</p>
    <p class="control-summary" data-push-state></p>
    <div class="control-actions">${renderButton({label:tr(lang,"Включить","Turn on"),type:"button",variant:"primary",attributes:{"data-push-toggle":true}})}</div></section>`;
}

/** Autopilot per project: brings tasks in Human Review to the owner's decision (src/orchestrator/runtime/autopilot.ts). */
function autopilotForm(state:{revision:number;projects:Record<string,boolean>;next?:Record<string,boolean>;names?:Record<string,string>}|null|undefined,lang:HubLanguage):string {
  if(!state)return "";
  const boxes=Object.entries(state.projects).map(([key,on])=>renderCheckbox({name:"autopilot",value:key,label:state.names?.[key]??key,checked:on})).join("");
  const nextBoxes=Object.keys(state.projects).map(key=>renderCheckbox({name:"autopilot-next",value:key,label:state.names?.[key]??key,checked:state.next?.[key]===true})).join("");
  return `<form class="control-form" data-hub-submit="autopilot-apply" data-revision="${state.revision}"><h3>${tr(lang,"Автопилот","Autopilot")}${renderInfoButton({id:"hub-autopilot-about",label:tr(lang,"Что делает автопилот","What the autopilot does")})}</h3>
    ${renderInfoNote({id:"hub-autopilot-about",text:tr(lang,"Для задач в Human Review с PR Kurami сам просит следующий шаг: исправить CI, если он упал (один раз), AI Review нового коммита, один раунд правок по существенным замечаниям. Слияние всегда за тобой. Шаги тратят лимит Codex, как если бы ты нажал кнопки сам.","For tasks in Human Review with a PR, Kurami asks for the next step itself: a CI repair when CI failed (once), AI Review of a new commit, one round of fixes for major findings. Merging always stays with you. The steps spend the Codex limit as if you pressed the buttons yourself.")})}
    <p class="control-summary">${tr(lang,"Доводить до решения","Bring to a decision")}</p><div class="control-fields">${boxes}</div>
    <p class="control-summary">${tr(lang,"Брать следующую задачу — по одной: когда в проекте нет задач в работе и на ревью, Kurami сам начинает задачу, которую триаж отметил следующей","Take the next task — one at a time: when the project has nothing in progress or in review, Kurami starts the task triage marked as next")}</p><div class="control-fields">${nextBoxes}</div><div class="control-actions">${apply(lang)}</div></form>`;
}

type ReleaseStatus={head:string|null;remote:string|null;tested?:string|null;rollbackTo:string|null;drift:{code:string;ru:string;en:string}[];last:{action:string;status:string;to:string;finishedAt?:string;startedAt:string;steps:{name:string;status:string;detail?:string}[];notes:string[]}|null};
const short=(sha:string|null)=>sha?sha.slice(0,7):"—";
/** Release: what runs against main, the last release with its steps, and the two owner actions. */
function releaseSection(release:ReleaseStatus|null|undefined,lang:HubLanguage):string {
  if(!release)return "";
  const statusLabel:Record<string,[string,string]>={running:["Идёт","Running"],succeeded:["Готово","Done"],failed:["Сбой","Failed"],rolled_back:["Откачено","Rolled back"]};
  const stepLabel:Record<string,[string,string]>={done:["готово","done"],skipped:["не нужно","not needed"],running:["идёт","running"],failed:["сбой","failed"]};
  const drift=release.drift.length?`<ul class="list-reset release-drift">${release.drift.map(item=>`<li>${escapeHtml(tr(lang,item.ru,item.en))}</li>`).join("")}</ul>`:`<p class="control-about">${tr(lang,"Всё выложено: сервер работает на том, что в main.","Everything is released: the server runs what main holds.")}</p>`;
  const last=release.last?renderDisclosure({summary:`${tr(lang,"Последняя выкладка","Last release")} · ${tr(lang,...(statusLabel[release.last.status]??[release.last.status,release.last.status]))} · ${short(release.last.to)}`,body:`<ol class="list-reset release-steps">${release.last.steps.map(step=>`<li><span>${escapeHtml(step.name)}</span> <small>${escapeHtml(tr(lang,...(stepLabel[step.status]??[step.status,step.status])))}${step.detail?` · ${escapeHtml(step.detail)}`:""}</small></li>`).join("")}</ol>${release.last.notes.map(note=>`<p class="control-summary">${escapeHtml(note)}</p>`).join("")}`}):"";
  const behind=Boolean(release.remote&&release.remote!==release.head);
  const canRelease=Boolean(release.remote)&&(behind||release.drift.length>0)&&release.last?.status!=="running";
  const releaseButton=`<form class="control-form release-action" data-hub-submit="release-apply" data-target="${escapeHtml(release.remote??"")}" data-head="${escapeHtml(release.head??"")}">${renderButton({label:tr(lang,`Выложить main · ${short(release.remote)}`,`Release main · ${short(release.remote)}`),type:"submit",variant:"primary",disabled:!canRelease})}</form>`;
  const rollbackButton=release.rollbackTo&&release.rollbackTo!==release.head?`<form class="control-form release-action" data-hub-submit="release-rollback" data-target="${escapeHtml(release.rollbackTo)}" data-head="${escapeHtml(release.head??"")}">${renderButton({label:tr(lang,`Откатить на ${short(release.rollbackTo)}`,`Roll back to ${short(release.rollbackTo)}`),type:"submit",variant:"subtle",disabled:release.last?.status==="running"})}</form>`:"";
  return `<section class="control-form release"><h3>${tr(lang,"Выкладка","Release")}${renderInfoButton({id:"hub-release-about",label:tr(lang,"Про выкладку","About releasing")})}</h3>
    ${renderInfoNote({id:"hub-release-about",text:tr(lang,"Сначала прогоняет тесты, если этот main ещё не проверен. Затем переводит рабочую версию на main и делает только нужное: миграции, сборку Digest, выпуск документации, копии Hermes и перезапуск сервисов, чей код изменился. В конце проверяет, что ничего не отстаёт; при сбое возвращает прошлую версию.","First runs the tests unless this main already passed them. Then moves the live version to main and does only what is needed: migrations, the Digest build, the docs release, the Hermes copies and restarts of services whose code changed. It ends by checking that nothing lags; on a failure it returns to the previous version.")})}
    <dl class="release-state"><div><dt>${tr(lang,"Сейчас","Live")}</dt><dd>${short(release.head)}</dd></div><div><dt>main</dt><dd>${short(release.remote)}</dd></div><div class="release-state__tests"><dt>${tr(lang,"Тесты","Tests")}</dt><dd>${release.tested?tr(lang,`пройдены ${release.tested.slice(5,16).replace("T"," ")}`,`passed ${release.tested.slice(5,16).replace("T"," ")}`):tr(lang,"запустятся перед выкладкой, 5–15 мин","run before the release, 5–15 min")}</dd></div></dl>
    ${drift}${last}<div class="control-actions">${rollbackButton}${releaseButton}</div></section>`;
}

/** How much of the server development work (Codex workers, tests, builds) may take; see dev-resources.ts. */
function devResourcesForm(resources:{revision:number;cores:number;testJobs:number;memoryGiB:number;serverCores:number;memoryChoices:number[]}|undefined,lang:HubLanguage):string {
  if(!resources)return "";
  const range=(to:number)=>Array.from({length:to},(_,index)=>({value:String(index+1),label:String(index+1)}));
  const memory=resources.memoryChoices.map(value=>({value:String(value),label:value?`${value} GiB`:tr(lang,"Без лимита","No limit")}));
  return `<form class="control-form" data-hub-submit="dev-resources-apply" data-revision="${resources.revision}"><h3>${tr(lang,"Ресурсы разработки","Development resources")}${renderInfoButton({id:"hub-dev-resources-about",label:tr(lang,"Про ресурсы разработки","About development resources")})}</h3>
    ${renderInfoNote({id:"hub-dev-resources-about",text:tr(lang,`Воркеры Codex всех проектов, их тесты и сборки, а также тесты Kurami работают в отдельном слайсе systemd. Им доступно не больше выбранного числа ядер из ${resources.serverCores}, и они уступают процессор сервисам. Новый лимит действует сразу, в том числе на уже идущие процессы. Потоки — сколько наборов тестов Kurami запускает одновременно.`,`Codex workers of every project, their tests and builds, and Kurami's own tests run in a separate systemd slice. They get at most the chosen number of the server's ${resources.serverCores} cores and yield CPU to services. A new limit applies at once, also to running processes. Test jobs is how many Kurami test suites run at the same time.`)})}
    <div class="control-fields">${renderSelectField({name:"cores",label:tr(lang,"Ядра","Cores"),value:String(resources.cores),options:range(resources.serverCores)})}${renderSelectField({name:"testJobs",label:tr(lang,"Потоки тестов","Test jobs"),value:String(resources.testJobs),options:range(resources.serverCores)})}${renderSelectField({name:"memoryGiB",label:tr(lang,"Память","Memory"),value:String(resources.memoryGiB),options:memory})}</div><div class="control-actions">${apply(lang)}</div></form>`;
}

/** The theme every Kurami app opens with; the header menu only changes it for one session. */
function appearanceForm(appearance:{revision:number;theme:string;mode:string|null;themes:Record<string,string[]>}|undefined,lang:HubLanguage):string {
  if(!appearance)return "";
  const labels:Record<string,string>={paper:"Paper",neon:"Neon"};
  const themes=Object.keys(appearance.themes).map(value=>({value,label:labels[value]??value}));
  const modes=[{value:"light",label:tr(lang,"Светлая","Light")},{value:"dark",label:tr(lang,"Тёмная","Dark")}];
  const mode=appearance.mode??"light";
  return `<form class="control-form" data-hub-submit="appearance-apply" data-revision="${appearance.revision}" data-themes="${escapeHtml(JSON.stringify(appearance.themes))}"><h3>${tr(lang,"Оформление","Appearance")}${renderInfoButton({id:"hub-appearance-about",label:tr(lang,"Про оформление","About appearance")})}</h3>
    ${renderInfoNote({id:"hub-appearance-about",text:tr(lang,"С этой темой открываются все приложения Kurami на всех устройствах. Меню темы в шапке меняет её только до закрытия приложения.","Every Kurami app opens with this theme on every device. The theme menu in the header changes it only until the app is closed.")})}
    ${renderSelectField({name:"theme",label:tr(lang,"Тема","Theme"),value:appearance.theme,options:themes})}${renderSelectField({name:"mode",label:tr(lang,"Режим","Mode"),value:mode,options:modes})}<div class="control-actions">${apply(lang)}</div></form>`;
}
