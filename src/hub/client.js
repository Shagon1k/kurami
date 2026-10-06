const dashboard=document.getElementById("hub-dashboard");
const hubLanguage=document.documentElement.lang==="en"?"en":"ru";
let refreshing=false;
const dialog=document.getElementById("hub-control-dialog");
const controlsPopover=document.getElementById("hub-controls-popover");
const controlsTrigger=document.querySelector('header [data-hub-control="menu"]');
const nativePopoverOpen=()=>typeof controlsPopover?.showPopover==='function'&&controlsPopover.matches(':popover-open');
const popoverOpen=()=>nativePopoverOpen()||controlsPopover?.classList.contains('is-open');
function hideControls(){
  if(nativePopoverOpen())controlsPopover.hidePopover();
  controlsPopover?.classList.remove('is-open');controlsTrigger?.setAttribute('aria-expanded','false');
}
function positionControls(){
  if(!controlsPopover||!controlsTrigger)return;
  const rect=controlsTrigger.getBoundingClientRect(),width=Math.min(264,innerWidth-16);
  controlsPopover.style.setProperty('--popover-left',Math.max(8,Math.min(innerWidth-width-8,rect.right-width))+'px');
  controlsPopover.style.setProperty('--popover-top',Math.max(8,Math.min(rect.bottom+8,innerHeight-264))+'px');
}
function toggleControls(){
  if(!controlsPopover)return;
  if(popoverOpen()){hideControls();controlsTrigger?.focus();return;}
  if(dialog?.open)dialog.close();positionControls();
  if(controlsPopover.showPopover)controlsPopover.showPopover();else controlsPopover.classList.add('is-open');
  controlsTrigger?.setAttribute('aria-expanded','true');
  controlsPopover.querySelector('button')?.focus();
}
controlsPopover?.addEventListener('toggle',event=>controlsTrigger?.setAttribute('aria-expanded',String(event.newState==='open')));
controlsPopover?.addEventListener('beforetoggle',event=>{if(event.newState==='open')positionControls();});
controlsPopover?.addEventListener('toggle',event=>{if(event.newState==='open')controlsPopover.querySelector('button')?.focus();});
addEventListener('resize',()=>{if(popoverOpen())positionControls();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&popoverOpen()){event.preventDefault();hideControls();controlsTrigger?.focus();}});
document.addEventListener('click',event=>{if(controlsPopover?.classList.contains('is-open')&&!controlsPopover.contains(event.target)&&!controlsTrigger?.contains(event.target))hideControls();});
const controlContent=document.getElementById("hub-control-content");
const confirmation=document.getElementById("hub-control-confirm");
const controlResult=document.getElementById("hub-control-result");
const toastRegion=document.querySelector("[data-toast-region]");
const hubToast=toastRegion&&typeof createKuramiToast==="function"?createKuramiToast(toastRegion,()=>null):null;
/** Success goes to the shared toast; the dialog line stays for errors and notes. */
function reportSuccess(message){if(hubToast){controlResult.textContent="";hubToast.show(message,{tone:"success"});}else controlResult.textContent=message;}
const csrf=document.querySelector('meta[name="hub-control-token"]')?.content??"";
const text=(ru,en)=>hubLanguage==="ru"?ru:en;
let pending=null,controlView=null,controlBusy=false,opener=null;
let controlReadVersion=0;
let selectedPeriod=null;
const workFilters={project:'all',agent:'all'};
let selectedRepositories=null;
function applyWorkFilters(){
  const activity=dashboard?.querySelector('.activity');if(!activity)return;
  for(const key of ['project','agent']){
    const select=activity.querySelector(`[name="activity-${key}"]`);if(!select)continue;
    if(![...select.options].some(option=>option.value===workFilters[key]))workFilters[key]='all';
    select.value=workFilters[key];
  }
  const rows=[...activity.querySelectorAll('[data-work-id]')].sort((a,b)=>Date.parse(b.dataset.workAt)-Date.parse(a.dataset.workAt));
  const main=activity.querySelector('.activity-list'),more=activity.querySelector('.activity-more'),moreList=more.querySelector('ol');
  let count=0;
  for(const row of rows){
    const match=(workFilters.project==='all'||row.dataset.workProject===workFilters.project)&&(workFilters.agent==='all'||row.dataset.workAgent===workFilters.agent);
    row.hidden=!match||count>=20;
    if(match&&count>=5&&count<20)moreList.append(row);else main.append(row);
    if(match)count++;
  }
  more.hidden=count<=5;
  more.querySelector('summary').textContent=text('Ещё','More')+' · '+Math.min(15,Math.max(0,count-5));
  activity.querySelector('.activity-empty').hidden=count>0;
}
function applyRepositoryFilter(){
  const source=dashboard?.querySelector('[data-commit-repositories]');if(!source)return;
  const data=JSON.parse(source.dataset.commitRepositories),unavailable=JSON.parse(source.dataset.commitUnavailable);
  const inputs=[...dashboard.querySelectorAll('[name="commit-repository"]')];
  if(selectedRepositories===null)selectedRepositories=new Set(inputs.map(input=>input.value));
  for(const input of inputs)input.checked=selectedRepositories.has(input.value);
  if(!Object.keys(data).length)return;
  const selected=inputs.filter(input=>input.checked);
  const partial=selected.some(input=>unavailable.includes(input.value));
  const coverage=dashboard.querySelector('[data-commit-coverage]');
  if(coverage)coverage.textContent=partial?text('Git · частичные данные','Git · partial data'):text('Git · выбрано ','Git · selected ')+selected.length+'/'+inputs.length;
  for(const label of dashboard.querySelectorAll('.period-metric .metric__label'))for(const node of label.childNodes)if(node.nodeType===Node.TEXT_NODE)node.textContent=text('Коммиты','Commits')+' · '+label.closest('[data-period-panel]').dataset.periodDays+text(' дней',' days')+(partial?text(' · частично',' · partial'):'');
  for(const panel of source.querySelectorAll('[data-period-panel=commits]')){
    const days=Number(panel.dataset.periodDays),chart=panel.querySelector('[data-chart]');if(!chart)continue;
    const spec=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(chart.dataset.chartSpec.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0))));
    const counts=spec.categories.map((_,index)=>inputs.filter(input=>input.checked).reduce((sum,input)=>sum+(data[input.value]?.slice(-days)[index]?.count??0),0));
    const missing=inputs.filter(input=>input.checked).length>0&&inputs.filter(input=>input.checked).every(input=>unavailable.includes(input.value));
    const total=counts.reduce((sum,count)=>sum+count,0);
    panel.querySelector('[data-commit-total]').textContent=missing?'—':String(total);
    const metric=dashboard.querySelector(`.period-metric [data-period-days="${days}"] .metric__value`);if(metric)metric.textContent=missing?'—':new Intl.NumberFormat(hubLanguage).format(total);
    chart.dispatchEvent(new CustomEvent('kurami:chart-update',{detail:{
      values:[counts.map(count=>missing?null:count)],state:missing?'unavailable':partial?'partial':'ready',
      message:missing?text('Git · нет данных','Git · unavailable'):partial?text('Git · частичные данные','Git · partial data'):text('Данные доступны','Data available'),
    }}));
  }
}
function initializeFilters(){
  for(const key of ['project','agent']){try{workFilters[key]=localStorage.getItem('kurami-hub-activity-'+key)||workFilters[key];}catch{}}
  if(selectedRepositories===null){try{const saved=JSON.parse(localStorage.getItem('kurami-hub-repositories'));if(Array.isArray(saved))selectedRepositories=new Set(saved);}catch{}}
  applyWorkFilters();applyRepositoryFilter();
}
function setPeriod(key,days){
  if(!dashboard||key!=='global'||!['7','30'].includes(days))return;
  selectedPeriod=days;
  for(const panel of dashboard.querySelectorAll('[data-period-panel]'))panel.hidden=panel.dataset.periodDays!==days;
  for(const button of document.querySelectorAll('[data-period-key="global"]'))button.setAttribute('aria-pressed',String(button.dataset.periodDays===days));
  for(const trigger of document.querySelectorAll('[data-period-trigger="global"]')){trigger.textContent=days+(hubLanguage==='ru'?'д':'d');if(trigger.hasAttribute('data-period-cycle'))trigger.setAttribute('aria-label',text('Период: ','Period: ')+days+text(' дней. Переключить на ',' days. Switch to ')+(days==='7'?'30':'7')+text(' дней',' days'));}
}
function initializePeriods(){
  let days=selectedPeriod;
  if(!days){try{days=localStorage.getItem('kurami-hub-period-global')||localStorage.getItem('kurami-hub-period-commits');}catch{}}
  setPeriod('global',['7','30'].includes(days)?days:'30');
}
if(dashboard){initializePeriods();initializeFilters();}
document.addEventListener('change',event=>{
  const input=event.target;
  if(input.matches?.('[name="commit-repository"]')){selectedRepositories=new Set([...dashboard.querySelectorAll('[name="commit-repository"]:checked')].map(input=>input.value));try{localStorage.setItem('kurami-hub-repositories',JSON.stringify([...selectedRepositories]));}catch{}applyRepositoryFilter();}
  if(input.matches?.('[name="activity-project"],[name="activity-agent"]')){const key=input.name.slice(9);workFilters[key]=input.value;try{localStorage.setItem('kurami-hub-activity-'+key,input.value);}catch{}applyWorkFilters();}
});
document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-period-key]');
  if(!button||button.dataset.periodKey!=='global'||!dashboard)return;
  const {periodKey:key,periodDays:days}=button.dataset;
  setPeriod(key,days);
  try{localStorage.setItem('kurami-hub-period-'+key,days);}catch{}
});
async function refreshHub(force=false){
  if(!dashboard||refreshing||document.visibilityState!=="visible"||!force&&(dashboard.contains(document.activeElement)||dialog?.open))return;
  refreshing=true;
  try {
    const response=await fetch(kuramiAppUrl("/api/fragment?lang="+hubLanguage),{cache:"no-store",credentials:"same-origin"});
    if(!response.ok)throw new Error("Hub refresh failed");
    const html=await response.text();
    if(dashboard.innerHTML!==html){
      const disclosureKey=element=>element.dataset.disclosureKey;
      const opened=new Set([...dashboard.querySelectorAll("details[open][data-disclosure-key]")].map(disclosureKey));
      dashboard.innerHTML=html;
      document.dispatchEvent(new Event("kurami:charts-mount"));
      initializePeriods();
      initializeFilters();
      for(const element of dashboard.querySelectorAll("details"))if(opened.has(disclosureKey(element)))element.open=true;
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
if("serviceWorker" in navigator)window.addEventListener("load",()=>{void navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).catch(()=>{});});

const errors={controls_unavailable:["Управление ещё не подключено","Controls are not connected"],unauthorized:["Нет доступа. Обнови страницу и войди снова","Access denied. Reload and sign in again"],invalid_origin:["Обнови страницу перед повтором","Reload the page before retrying"],stale_settings:["Данные изменились. Открой настройки заново","Values changed. Reopen the settings"],action_in_progress:["Другое действие ещё выполняется","Another action is still running"],command_failed:["Команда отклонена. Обнови состояние и повтори","Command rejected. Refresh the state and retry"],provider_unsupported:["Этот provider настраивается в Hermes","Configure this provider in Hermes"],noCredit:["Нет доступных сбросов","No resets available"],nothingToReset:["Нет лимита для сброса","No eligible limit to reset"]};
function errorText(code){const pair=errors[code];return pair?text(...pair):text("Действие не выполнено","Action did not complete");}
async function api(action,payload){
  const response=await fetch(kuramiAppUrl("/api/controls?lang="+hubLanguage+(payload?"":"&action="+encodeURIComponent(action))),{
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
  if(!dialog.open)opener=controlsPopover?.contains(button)?controlsTrigger:button;
  hideControls();controlResult.textContent="";
  if(!dialog.open)dialog.showModal();
}
function confirmAction(action,payload,message,changes=[]){
  pending={action,payload};
  controlContent.hidden=true;confirmation.hidden=false;
  document.getElementById("hub-confirm-message").textContent=message;
  const table=document.getElementById("hub-confirm-changes");table.hidden=!changes.length;
  const body=table.querySelector('tbody');body.replaceChildren();
  for(const change of changes){const row=document.createElement('tr');change.forEach((value,index)=>{const cell=document.createElement(index?'td':'th');if(!index)cell.scope='row';cell.textContent=String(value);row.append(cell);});body.append(row);}
  const confirm=dialog.querySelector("[data-hub-confirm]");
  confirm.classList.remove("button--info","button--warning","button--subtle");
  const tone=["restart","codex-reset","settings-reset"].includes(action)?"warning":action==="settings-rollback"?"subtle":"info";
  confirm.classList.add("button--"+tone);
  confirm.focus();
}
function controlTitle(action){
  const titles={models:text('Модели','Models'),settings:text('Настройки','Settings'),server:text('Сервер','Server'),appearance:text('Оформление','Appearance'),'composio-check':text('Проверка Composio','Composio check'),restart:text('Перезапуск Hermes','Restart Hermes'),'codex-reset':text('Сброс лимитов Codex','Reset Codex limits')};
  document.getElementById('hub-control-dialog-title').textContent=titles[action]??titles[controlView]??text('Управление','Controls');
}
async function loadControl(action){
  const version=++controlReadVersion;
  controlView=action;pending=null;confirmation.hidden=true;controlContent.hidden=false;
  controlTitle(action);controlContent.textContent=action==='composio-check'?text('Проверяем конфигурацию Composio…','Checking Composio configuration…'):text("Загрузка…","Loading…");
  controlContent.setAttribute('aria-busy','true');
  try{const result=await api(action);if(version===controlReadVersion&&dialog.open&&controlView===action)controlContent.innerHTML=result.html;}
  catch(error){if(version===controlReadVersion&&dialog.open&&controlView===action)controlContent.textContent=error.message;}
  finally{if(version===controlReadVersion)controlContent.removeAttribute('aria-busy');}
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
  if(button.dataset.hubControl==='menu'){if(!controlsPopover?.showPopover)toggleControls();return;}
  showDialog(button);
  const action=button.dataset.hubControl;
  controlTitle(action);
  if(["models","settings","server","appearance","composio-check"].includes(action)){void loadControl(action);return;}
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
function markChangedFields(event){
  const input=event.target;
  if(!input.matches?.('[data-hub-submit] input,[data-hub-submit] select'))return;
  const original=input.tagName==='SELECT'?[...input.options].find(option=>option.defaultSelected)?.value:input.defaultValue;
  const changed=input.type==='number'?Number(input.value)!==Number(original):input.value!==original;
  input.closest('.form-field')?.setAttribute('data-dirty',String(changed&&!input.disabled));
}
/** Appearance: a theme offers only its own modes (Neon is dark only for now). */
function syncAppearanceModes(form){
  if(!form?.matches?.('[data-hub-submit="appearance-apply"]'))return;
  const modes=JSON.parse(form.dataset.themes)[form.elements.theme.value]??[];
  for(const option of form.elements.mode.options)option.disabled=!modes.includes(option.value);
  if(!modes.includes(form.elements.mode.value))form.elements.mode.value=modes[0];
}
document.addEventListener('change',event=>syncAppearanceModes(event.target.closest?.('form')));
new MutationObserver(()=>document.querySelectorAll('[data-hub-submit="appearance-apply"]').forEach(syncAppearanceModes)).observe(document.body,{childList:true,subtree:true});
document.addEventListener('input',markChangedFields);
document.addEventListener('change',markChangedFields);
document.addEventListener("submit",event=>{
  const form=event.target;
  if(!form.matches?.("[data-hub-submit]"))return;
  event.preventDefault();if(controlBusy||!form.reportValidity())return;
  const values=Object.fromEntries(new FormData(form));const action=form.dataset.hubSubmit;
  if(action==="model-apply"){
    const selected=JSON.parse(form.dataset.models).find(model=>model.value===values.model);
    const effort=form.dataset.effort,changes=[[text('Модель','Model'),form.dataset.expectedModel,values.model]];
    if(form.dataset.target==="codex"&&effort&&selected?.efforts?.length&&!selected.efforts.includes(effort))changes.push(['Reasoning',effort,selected.defaultEffort]);
    confirmAction(action,{target:form.dataset.target,expectedModel:form.dataset.expectedModel,expectedEffort:form.dataset.target==="codex"?(effort||null):undefined,model:values.model},form.dataset.target,changes);
  }
  if(action==="health-apply")confirmAction(action,{revision:Number(form.dataset.revision),minutes:Number(values.minutes)},'System Health',[[text('Интервал · минуты','Interval · minutes'),[...form.elements.minutes.options].find(option=>option.defaultSelected)?.value,values.minutes]]);
  if(action==="appearance-apply"){
    const option=(name,value)=>[...form.elements[name].options].find(item=>item.value===value)?.textContent??value;
    const before={theme:[...form.elements.theme.options].find(item=>item.defaultSelected)?.value,mode:[...form.elements.mode.options].find(item=>item.defaultSelected)?.value};
    const changes=[["theme",text('Тема','Theme')],["mode",text('Режим','Mode')]].filter(([name])=>before[name]!==values[name]).map(([name,label])=>[label,option(name,before[name]),option(name,values[name])]);
    if(!changes.length){controlResult.textContent=text("Без изменений","No changes");return;}
    confirmAction(action,{revision:Number(form.dataset.revision),theme:values.theme,mode:values.mode},text('Оформление','Appearance'),changes);
  }
  if(action==="dev-resources-apply"){
    const fields=[["cores",text('Ядра','Cores')],["testJobs",text('Потоки тестов','Test jobs')],["memoryGiB",text('Память','Memory')]];
    const option=(name,value)=>[...form.elements[name].options].find(item=>item.value===value)?.textContent??value;
    const before=Object.fromEntries(fields.map(([name])=>[name,[...form.elements[name].options].find(item=>item.defaultSelected)?.value]));
    if(Number(values.testJobs)>Number(values.cores)){controlResult.textContent=text("Потоков тестов не может быть больше ядер","Test jobs cannot exceed cores");return;}
    const changes=fields.filter(([name])=>before[name]!==values[name]).map(([name,label])=>[label,option(name,before[name]),option(name,values[name])]);
    if(!changes.length){controlResult.textContent=text("Без изменений","No changes");return;}
    confirmAction(action,{revision:Number(form.dataset.revision),cores:Number(values.cores),testJobs:Number(values.testJobs),memoryGiB:Number(values.memoryGiB)},text('Ресурсы разработки','Development resources'),changes);
  }
  if(action==="settings-apply"){
    const settings={project_wip:{}};const current=JSON.parse(form.dataset.current);const changes=[];
    for(const [name,value] of Object.entries(values)){
      if(name.startsWith("project_wip.")){const project=name.slice(12);settings.project_wip[project]=Number(value);if(Number(value)!==current.project_wip[project])changes.push([`${project} WIP`,current.project_wip[project],value]);}
      else{settings[name]=Number(value);if(Number(value)!==current[name])changes.push([form.elements.namedItem(name).closest("label").querySelector("span").textContent,current[name],value]);}
    }
    if(!changes.length){controlResult.textContent=text("Без изменений","No changes");return;}
    confirmAction(action,{revision:Number(form.dataset.revision),settings},text('Применить изменения настроек?','Apply settings changes?'),changes);
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
    }else if(operation.action==="appearance-apply"&&result.appearance){
      const names={paper:"Paper",neon:"Neon"},modes={light:text("светлая","light"),dark:text("тёмная","dark")};
      reportSuccess(text("Оформление по умолчанию: ","Default appearance: ")+(names[result.appearance.theme]??result.appearance.theme)+" · "+(modes[result.appearance.mode]??result.appearance.mode));
    }else if(operation.action==="dev-resources-apply"&&result.devResources){
      reportSuccess(text("Ресурсы разработки: ","Development resources: ")+result.devResources.cores+text(" ядер · "," cores · ")+result.devResources.testJobs+text(" потока тестов"," test jobs"));
    }else reportSuccess(operation.action==="restart"?text("Перезапуск запрошен","Restart requested"):text("Применено","Applied"));
    if(result.auditWarning)controlResult.textContent=(controlResult.textContent?controlResult.textContent+" · ":"")+text("Запись аудита не сохранена","Audit record could not be saved");
    // The gateway sends the new default with the next page; apply it here at once.
    if(operation.action==="appearance-apply"&&result.appearance){document.cookie=`kurami-theme-default=${result.appearance.theme}.${result.appearance.mode}; path=/; max-age=31536000; samesite=lax${location.protocol==="https:"?"; secure":""}`;window.kuramiThemeRefresh?.();}
    pending=null;confirmation.hidden=true;controlContent.hidden=false;
    if(controlView)await loadControl(controlView);else controlContent.textContent="";
    await refreshHub(true);
  }catch(error){controlResult.textContent=error.message??errorText();}
  finally{controlBusy=false;button.removeAttribute("aria-busy");}
}
dialog?.addEventListener("cancel",event=>{if(controlBusy)event.preventDefault();});
dialog?.addEventListener("close",()=>{if(dialog.open)return;controlReadVersion++;controlContent.removeAttribute('aria-busy');pending=null;if(!popoverOpen())(opener?.getClientRects().length?opener:document.querySelector('[data-mobile-menu="controls"]'))?.focus({preventScroll:true});});
