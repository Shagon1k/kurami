const dashboard=document.getElementById("hub-dashboard");
const hubLanguage=document.documentElement.lang==="en"?"en":"ru";
let refreshing=false;
const dialog=document.getElementById("hub-control-dialog");
const controlContent=document.getElementById("hub-control-content");
const confirmation=document.getElementById("hub-control-confirm");
const controlResult=document.getElementById("hub-control-result");
const csrf=document.querySelector('meta[name="hub-control-token"]')?.content??"";
const text=(ru,en)=>hubLanguage==="ru"?ru:en;
let pending=null,controlView=null,controlBusy=false,opener=null;
const periodChoices=new Map();
function setPeriod(key,days){
  if(!dashboard||!['7','30'].includes(days)||!/^[a-z][a-z0-9-]*$/.test(key))return;
  periodChoices.set(key,days);
  for(const panel of dashboard.querySelectorAll(`[data-period-panel="${key}"]`))panel.hidden=panel.dataset.periodDays!==days;
  for(const button of dashboard.querySelectorAll(`[data-period-key="${key}"]`))button.setAttribute('aria-pressed',String(button.dataset.periodDays===days));
}
function initializePeriods(){
  for(const key of new Set([...dashboard.querySelectorAll('[data-period-key]')].map(button=>button.dataset.periodKey))){
    let days=periodChoices.get(key);
    if(!days){try{days=localStorage.getItem('kurami-hub-period-'+key);}catch{}}
    setPeriod(key,['7','30'].includes(days)?days:'30');
  }
}
if(dashboard)initializePeriods();
document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-period-key]');
  if(!button||!dashboard?.contains(button))return;
  const {periodKey:key,periodDays:days}=button.dataset;
  setPeriod(key,days);
  try{localStorage.setItem('kurami-hub-period-'+key,days);}catch{}
});
async function refreshHub(force=false){
  if(!dashboard||refreshing||document.visibilityState!=="visible"||!force&&(dashboard.contains(document.activeElement)||dialog?.open))return;
  refreshing=true;
  try {
    const response=await fetch("/api/fragment?lang="+hubLanguage,{cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error("Hub refresh failed");
    const html=await response.text();
    if(dashboard.innerHTML!==html){
      const opened=new Set([...dashboard.querySelectorAll("details[open]")].map(element=>element.querySelector("summary")?.textContent));
      dashboard.innerHTML=html;
      initializePeriods();
      for(const element of dashboard.querySelectorAll("details"))if(opened.has(element.querySelector("summary")?.textContent))element.open=true;
    }
    dashboard.removeAttribute("data-disconnected");
  } catch {
    dashboard.setAttribute("data-disconnected","true");
    const status=dashboard.querySelector(".hub__live");
    if(status)status.textContent=hubLanguage==="en"?"Offline · last available data":"Нет связи · последние данные";
  }
  finally {refreshing=false;}
}
setInterval(refreshHub,60_000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")void refreshHub();});
if("serviceWorker" in navigator)window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js").catch(()=>{});});

const errors={controls_unavailable:["Управление ещё не подключено","Controls are not connected"],unauthorized:["Нет доступа. Обнови страницу и войди снова","Access denied. Reload and sign in again"],invalid_origin:["Обнови страницу перед повтором","Reload the page before retrying"],stale_settings:["Данные изменились. Открой настройки заново","Values changed. Reopen the settings"],action_in_progress:["Другое действие ещё выполняется","Another action is still running"],command_failed:["Команда отклонена. Обнови состояние и повтори","Command rejected. Refresh the state and retry"],provider_unsupported:["Этот provider настраивается в Hermes","Configure this provider in Hermes"],noCredit:["Нет доступных сбросов","No resets available"],nothingToReset:["Нет лимита для сброса","No eligible limit to reset"]};
function errorText(code){const pair=errors[code];return pair?text(...pair):text("Действие не выполнено","Action did not complete");}
async function api(action,payload){
  const response=await fetch("/api/controls?lang="+hubLanguage+(payload?"":"&action="+encodeURIComponent(action)),{
    method:payload?"POST":"GET",credentials:"same-origin",cache:"no-store",
    headers:payload?{"Content-Type":"application/json","X-Hub-Control-Token":csrf}:{},
    body:payload?JSON.stringify({...payload,action,confirm:true}):undefined,
  });
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(errorText(result.error));
  return result;
}
function showDialog(button){
  if(!dialog)return;
  if(!dialog.open)opener=button;controlResult.textContent="";
  if(!dialog.open)dialog.showModal();
}
function confirmAction(action,payload,message){
  pending={action,payload};
  controlContent.hidden=true;confirmation.hidden=false;
  document.getElementById("hub-confirm-message").textContent=message;
  dialog.querySelector("[data-hub-confirm]").focus();
}
async function loadControl(action){
  controlView=action;pending=null;confirmation.hidden=true;controlContent.hidden=false;
  controlContent.textContent=text("Загрузка…","Loading…");
  try{const result=await api(action);controlContent.innerHTML=result.html;}
  catch(error){controlContent.textContent=error.message;}
}
document.addEventListener("click",event=>{
  const button=event.target.closest?.("[data-hub-control],[data-dialog-close],[data-hub-confirm],[data-hub-cancel]");
  if(!button||controlBusy)return;
  if(button.hasAttribute("data-dialog-close")){dialog.close();return;}
  if(button.hasAttribute("data-hub-cancel")){
    pending=null;confirmation.hidden=true;controlContent.hidden=false;
    if(!controlView)dialog.close();return;
  }
  if(button.hasAttribute("data-hub-confirm")){void performAction(button);return;}
  showDialog(button);
  const action=button.dataset.hubControl;
  if(["models","settings","composio-check"].includes(action)){void loadControl(action);return;}
  if(action==="codex-reset"){
    controlView=null;
    let key=sessionStorage.getItem("kurami-reset-attempt");
    if(!key){key=crypto.randomUUID();sessionStorage.setItem("kurami-reset-attempt",key);}
    confirmAction(action,{idempotencyKey:key},text("Использовать один доступный сброс лимитов Codex?","Use one available Codex rate-limit reset?"));
  }else if(action==="restart"){
    controlView=null;
    confirmAction(action,{},text("Перезапустить Hermes gateway после завершения активных ходов?","Restart Hermes gateway after active turns finish?"));
  }else if(action==="composio-apply"){
    confirmAction(action,{contour:button.dataset.contour,revision:button.dataset.revision},text("Синхронизировать показанные изменения Composio: ","Sync the displayed Composio changes: ")+button.dataset.contour+"?");
  }else if(action?.startsWith("settings-")){
    confirmAction(action,{revision:Number(button.dataset.revision)},action==="settings-reset"?text("Восстановить настройки по умолчанию?","Restore default settings?"):text("Откатить последнее изменение настроек?","Undo the last settings change?"));
  }
});
document.addEventListener("submit",event=>{
  const form=event.target;
  if(!form.matches?.("[data-hub-submit]"))return;
  event.preventDefault();if(controlBusy||!form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));const action=form.dataset.hubSubmit;
  if(action==="model-apply"){
    const selected=JSON.parse(form.dataset.models).find(model=>model.value===values.model);
    const effort=form.dataset.effort;let message=`${form.dataset.target}: ${form.dataset.expectedModel} → ${values.model}`;
    if(form.dataset.target==="codex"&&effort&&selected?.efforts?.length&&!selected.efforts.includes(effort))message+=`\nReasoning: ${effort} → ${selected.defaultEffort}`;
    confirmAction(action,{target:form.dataset.target,expectedModel:form.dataset.expectedModel,expectedEffort:form.dataset.target==="codex"?(effort||null):undefined,model:values.model},message);
  }
  if(action==="health-apply")confirmAction(action,{revision:Number(form.dataset.revision),minutes:Number(values.minutes)},`System Health: ${values.minutes} min`);
  if(action==="settings-apply"){
    const settings={project_wip:{}};const current=JSON.parse(form.dataset.current);const changes=[];
    for(const [name,value] of Object.entries(values)){
      if(name.startsWith("project_wip.")){const project=name.slice(12);settings.project_wip[project]=Number(value);if(Number(value)!==current.project_wip[project])changes.push(`${project} WIP: ${current.project_wip[project]} → ${value}`);}
      else{settings[name]=Number(value);if(Number(value)!==current[name])changes.push(`${form.elements.namedItem(name).closest("label").querySelector("span").textContent}: ${current[name]} → ${value}`);}
    }
    if(!changes.length){controlResult.textContent=text("Без изменений","No changes");return;}
    confirmAction(action,{revision:Number(form.dataset.revision),settings},changes.join("\n"));
  }
});
async function performAction(button){
  if(!pending||controlBusy)return;
  const operation=pending;controlBusy=true;button.setAttribute("aria-busy","true");button.dataset.busyLabel=text("Выполняется…","Working…");
  controlResult.textContent="";
  try{
    const result=await api(operation.action,operation.payload);
    if(operation.action==="codex-reset"){
      sessionStorage.removeItem("kurami-reset-attempt");
      controlResult.textContent=["reset","alreadyRedeemed"].includes(result.outcome)?text("Лимиты сброшены","Limits reset"):errorText(result.outcome);
    }else controlResult.textContent=operation.action==="restart"?text("Перезапуск запрошен","Restart requested"):text("Применено","Applied");
    if(result.auditWarning)controlResult.textContent+=text(" · Запись аудита не сохранена"," · Audit record could not be saved");
    pending=null;confirmation.hidden=true;controlContent.hidden=false;
    if(controlView)await loadControl(controlView);else controlContent.textContent="";
    await refreshHub(true);
  }catch(error){controlResult.textContent=error.message??errorText();}
  finally{controlBusy=false;button.removeAttribute("aria-busy");}
}
dialog?.addEventListener("cancel",event=>{if(controlBusy)event.preventDefault();});
dialog?.addEventListener("close",()=>{pending=null;opener?.focus();});
