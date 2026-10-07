(() => {
  const dashboard = document.querySelector('#projects-dashboard');
  const search = document.querySelector('input[name=q]');
  const app=document.querySelector('[data-projects-app]');
  const messages=JSON.parse(app?.dataset.messages ?? '{}');
  const t=key=>messages[key]??key;
  function updateExpiry(){
    for(const note of document.querySelectorAll('[data-preview-expiry]')){
      const remaining=Date.parse(note.dataset.previewExpiry)-Date.now();
      note.dataset.noteTone=remaining<=3600000?'warning':'neutral';
      const label=note.querySelector('[data-expiry-label]');if(label)label.textContent=remaining<=0?' · '+t('Expiry reached'):remaining<=3600000?' · '+t('Expires soon'):'';
    }
  }
  updateExpiry();setInterval(updateExpiry,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateExpiry();});
  const requestHeaders={'Content-Type':'application/json','Accept-Language':document.documentElement.lang};
  const mobile=matchMedia('(max-width:900px)');
  let lastDetailUrl=null;
  let returnFocus=null;
  let gesture=null;
  let pendingHistory=null;
  let navigationVersion=0;
  const views=new Map();
  const detailScrolls=new Map();
  let settling=false;
  let motionVersion=0;
  let settledExit=false,settledEnter=false;
  let motionWaiters=[];
  const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)');
  const viewKey=url=>{const params=new URLSearchParams(url.search);params.sort();return url.pathname+'?'+params;};
  let updateRequired=false;
  const busy=()=>updateRequired||requestingReview||requestingStatus||requestingAction||confirmingAction||confirmingPr;
  function rememberView(url){
    const copy=dashboard.cloneNode(true);copy.querySelector('[data-toast-region]')?.remove();
    views.set(viewKey(url),copy.innerHTML);
    const overview=new URL(url);overview.searchParams.delete('item');
    copy.querySelector('#project-details')?.remove();
    copy.querySelector('.projects-grid')?.classList.remove('projects-grid--detail');
    copy.querySelectorAll('.projects-row--selected').forEach(row=>row.classList.remove('projects-row--selected'));
    views.set(viewKey(overview),copy.innerHTML);
    while(views.size>8)views.delete(views.keys().next().value);
  }
  function cachedView(url,focusDetails){
    const html=views.get(viewKey(url));if(!html)return false;
    const previous=dashboard.querySelector('#project-details');
    if(previous)detailScrolls.set(previous.dataset.detailItem,previous.scrollTop);
    toastHome.append(toastRegion);dashboard.innerHTML=html;
    const detail=dashboard.querySelector('#project-details');
    if(detail){
      detail.querySelectorAll('[data-run-action],[data-review-run],[data-status-submit],[data-pr-action],select').forEach(control=>control.disabled=true);
      const note=document.createElement('p');note.className='projects-update';note.dataset.cachedView='';note.textContent=t('Saved view · refreshing…');detail.append(note);
    }
    updateLayout();updateProjectTabs(url);filter();
    if(detail)detail.scrollTop=detailScrolls.get(detail.dataset.detailItem)??0;
    if(focusDetails)detail?.focus({preventScroll:true});else restoreTaskFocus();
    return true;
  }
  function motionFinished(){motionWaiters.splice(0).forEach(resolve=>resolve());}
  function waitForMotion(){return gesture||settling?new Promise(resolve=>motionWaiters.push(resolve)):Promise.resolve();}
  async function slide(panel,from,to){
    if(!panel)return;
    const version=++motionVersion;
    settling=true;
    dashboard.dataset.transitioning='true';
    const distance=Math.abs(to-from)/innerWidth;
    if(!reducedMotion.matches){await panel.animate([{transform:`translateX(${from}px)`},{transform:`translateX(${to}px)`}],{duration:Math.max(120,240*distance),easing:'cubic-bezier(.22,.68,0,1)',fill:'forwards'}).finished.catch(()=>{});}
    if(version!==motionVersion)return false;
    panel.style.transform=`translateX(${to}px)`;
    panel.getAnimations().forEach(animation=>animation.cancel());
    settling=false;delete dashboard.dataset.transitioning;motionFinished();
    return true;
  }
  const toastRegion=document.querySelector('[data-toast-region]');
  const toastHome=app;
  const toast=createKuramiToast(toastRegion,()=>dashboard.querySelector('#project-details')??(search?.getClientRects().length?search:document.querySelector('[data-mobile-menu="search"]')));
  const notify=(message,tone='info',duration,celebrate=false)=>toast.show(message,{tone,duration,celebrate});
  if (!dashboard) return;
  let refreshing = false;
  let requestingReview = false;
  let requestingStatus = false;
  let requestingAction = false;
  const requestAction=createProjectActionRequest({
    busy:()=>updateRequired||requestingReview||requestingStatus||requestingAction||refreshing,
    setBusy:(kind,value)=>{if(kind==='review')requestingReview=value;else if(kind==='status')requestingStatus=value;else requestingAction=value;},
    headers:requestHeaders,url:kuramiAppUrl,notify,
  });
  let confirmingAction = null;
  let confirmingPr=null;
  let dismissedPrTrigger=null;
  async function loadPrControl() {
    const slot=dashboard.querySelector('[data-pr-slot]');if(!slot||confirmingPr)return;
    const version=navigationVersion;
    try {
      const params=new URLSearchParams({project:slot.dataset.prProject,item:slot.dataset.prItem,lang:document.documentElement.lang});
      const response=await fetch(kuramiAppUrl('/api/pr-controls?'+params),{cache:'no-store',signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('PR controls unavailable');
      const html=await response.text();
      if(!slot.isConnected||version!==navigationVersion||confirmingPr)return;
      const focused=slot.contains(document.activeElement);
      slot.innerHTML=html;
      if(focused)(slot.querySelector('[data-pr-action]:not(:disabled)')??dashboard.querySelector('#project-details'))?.focus({preventScroll:true});
      rememberView(new URL(location.href));
    } catch {
      if(slot.isConnected&&version===navigationVersion){const button=slot.querySelector('button');button?.setAttribute('disabled','');button?.setAttribute('aria-expanded','false');const note=document.createElement('p');note.className='projects-action-note';note.dataset.noteTone='warning';note.textContent=t('PR actions are temporarily unavailable.');slot.querySelector('.projects-run-action-meta')?.replaceChildren(note);}
    }
  }
  function dismissPr(focus=true) {
    if(!confirmingPr)return;
    const button=confirmingPr,panel=document.getElementById(button.dataset.prConfirmTarget);confirmingPr=null;
    if(panel?.matches(':popover-open'))panel.hidePopover();
    button.setAttribute('aria-expanded','false');
    if(focus)button.focus({preventScroll:true});
  }
  function positionPr() {
    if(!confirmingPr)return;
    const panel=document.getElementById(confirmingPr.dataset.prConfirmTarget),anchor=confirmingPr.getBoundingClientRect(),rect=panel.getBoundingClientRect();
    const viewport=window.visualViewport,top=viewport?.offsetTop??0,height=viewport?.height??innerHeight,left=viewport?.offsetLeft??0,width=viewport?.width??innerWidth;
    panel.style.setProperty('--popover-left',`${Math.max(left+8,Math.min(anchor.right-rect.width,left+width-rect.width-8))}px`);
    const above=anchor.top-rect.height-8,below=anchor.bottom+8;
    panel.style.setProperty('--popover-top',`${Math.max(top+8,Math.min(above>=top+8?above:below,top+height-rect.height-8))}px`);
  }
  document.addEventListener('beforetoggle',event=>{
    if(event.newState==='closed'&&confirmingPr&&event.target.id===confirmingPr.dataset.prConfirmTarget){
      confirmingPr.setAttribute('aria-expanded','false');confirmingPr=null;
    }
  },true);
  document.addEventListener('pointerdown',event=>{
    // Native light-dismiss can close the popup before the trigger's click arrives.
    dismissedPrTrigger=confirmingPr&&event.target.closest?.('[data-pr-action]')===confirmingPr?confirmingPr:null;
  },true);
  document.addEventListener('focusin',event=>{
    if(confirmingPr&&!confirmingPr.contains(event.target)&&!document.getElementById(confirmingPr.dataset.prConfirmTarget).contains(event.target))dismissPr(false);
  });
  window.addEventListener('resize',positionPr);
  document.addEventListener('scroll',positionPr,true);
  async function submitPr(button,method) {
    const slot=button.closest('[data-pr-slot]');
    return requestAction(button,{kind:'action',path:'/api/pr-action',timeout:45000,
      body:{project:slot.dataset.prProject,itemId:slot.dataset.prItem,action:button.dataset.prAction,head:button.dataset.prHead,
        fingerprint:button.dataset.prFingerprint,key:button.dataset.prKey,confirmed:true,method,checkOnly:button.hasAttribute('data-pr-check')},
      unconfirmed:t('PR action unconfirmed. Check its result in GitHub.'),
      response:async(result,response)=>{
        if(!response.ok)throw new Error(result.error||t('GitHub did not complete this PR action.'));
        const merged=result.state==='applied'&&button.dataset.prAction!=='ready';
        notify(t(result.state==='applied'?(button.dataset.prAction==='ready'?'PR ready for review.':'PR merged. One less thing to worry about.'):result.state==='uncertain'?'PR action unconfirmed. Check its result in GitHub.':'GitHub is processing this PR action.'),result.state==='applied'?'success':'warning',undefined,merged);
      },after:()=>refresh(),
    });
  }
  function filter() {
    updateExpiry();
    const query = (search?.value ?? '').trim().toLocaleLowerCase(document.documentElement.lang);
    const rows = [...dashboard.querySelectorAll('.projects-table tbody tr')];
    let count = 0;
    for (const row of rows) {
      row.hidden = !(row.querySelector('[data-search]')?.dataset.search ?? '').includes(query);
      if (!row.hidden) count++;
    }
    const total = dashboard.querySelector('[data-visible-count]');
    if (total && rows.length) total.textContent = String(count);
    const empty = dashboard.querySelector('[data-search-empty]');
    if (empty) empty.hidden = !rows.length || count > 0;
  }
  async function refresh(url = new URL(location.href), focusDetails = false) {
    if (refreshing || confirmingAction || confirmingPr || gesture || settling) return;
    refreshing = true;
    const version=navigationVersion;
    const previousFocus = document.activeElement;
    const focusedToast=toastRegion.contains(previousFocus);
    const focusedItem = previousFocus?.getAttribute('data-item-link');
    const focusedReview = previousFocus?.getAttribute('data-review-run');
    const focusedAction = previousFocus?.getAttribute('data-run-action');
    const focusedPr=previousFocus?.getAttribute('data-pr-action');
    const previousTable=dashboard.querySelector('.projects-table');
    const scrollTop=previousTable?.scrollTop??0,scrollLeft=previousTable?.scrollLeft??0;
    const previousDetail=dashboard.querySelector('#project-details');
    const detailScroll=previousDetail?.scrollTop??0,previousItem=previousDetail?.dataset.detailItem;
    const ciDisclosure=previousDetail?.querySelector('.projects-ci-details');
    const ciDisclosureState=ciDisclosure?{key:ciDisclosure.dataset.disclosureKey,open:ciDisclosure.open,focus:ciDisclosure.querySelector('summary')===previousFocus,link:ciDisclosure.contains(previousFocus)?previousFocus?.getAttribute('href'):null}:null;
    const focusedDetails = previousFocus?.id === 'project-details';
    const focusedClose = previousFocus?.hasAttribute('data-item-close');
    const focusedFilter = previousFocus?.getAttribute('data-task-filter');
    const previousForm = dashboard.querySelector('[data-status-form]');
    const previousSelect = previousForm?.querySelector('select');
    const statusDraft = previousSelect && previousForm.dataset.check === 'false' && previousSelect.value !== JSON.parse(previousForm.dataset.from) ? { value: previousSelect.value, from: previousForm.dataset.from, item: previousForm.dataset.item } : null;
    const focusedStatus = previousForm?.contains(previousFocus) ? previousFocus.tagName === 'SELECT' ? 'select' : '[data-status-submit]' : null;
    dashboard.dataset.refreshing='true';
    try {
      const params=new URLSearchParams(url.searchParams);if(kuramiAppLanguage()==='ru')params.set('lang','ru');
      const response = await fetch(kuramiAppUrl('/api/fragment?' + params), { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('refresh failed');
      if(response.headers.get('X-Kurami-Projects-Version')!==projectsClientVersion){
        updateRequired=true;
        dashboard.querySelectorAll('[data-run-action],[data-review-run],[data-status-submit],[data-pr-action],select').forEach(control=>control.disabled=true);
        notify(t('Projects was updated. Reload the page to continue.'),'warning',0);
        return false;
      }
      const html=await response.text();
      await waitForMotion();
      if(version!==navigationVersion)return false;
      if(ciDisclosureState&&ciDisclosure?.isConnected)ciDisclosureState.open=ciDisclosure.open;
      toastHome.append(toastRegion);
      dashboard.innerHTML = html;
      const table=dashboard.querySelector('.projects-table');
      if(table){table.scrollTop=scrollTop;table.scrollLeft=scrollLeft;}
      const detail=dashboard.querySelector('#project-details');
      const nextCiDisclosure=detail?.querySelector('.projects-ci-details');
      if(ciDisclosureState&&nextCiDisclosure?.dataset.disclosureKey===ciDisclosureState.key)nextCiDisclosure.open=ciDisclosureState.open;
      updateLayout();
      if(detail)detail.scrollTop=detail.dataset.detailItem===previousItem?detailScroll:detailScrolls.get(detail.dataset.detailItem)??0;
      updateProjectTabs(url);
      filter();
      if(mobile.matches&&focusDetails&&detail&&detail.dataset.detailItem!==previousItem&&!settledEnter)await slide(detail,innerWidth,0);
      if(version!==navigationVersion)return false;
      const form = dashboard.querySelector('[data-status-form]');
      const select = form?.querySelector('select');
      if (statusDraft && form?.dataset.item === statusDraft.item && select && !select.disabled) {
        if (form.dataset.from === statusDraft.from && [...select.options].some(option => option.value === statusDraft.value)) select.value = statusDraft.value;
        else notify(t("Status changed. Check the new state before saving."),'warning');
      }
      if (form) updateStatusChoice(form);
      rememberView(url);
      loadPrControl();
      if(focusedToast && !toastRegion.hidden)toastRegion.querySelector('[data-toast-dismiss]').focus({preventScroll:true});
      else if(ciDisclosureState?.focus||ciDisclosureState?.link){
        const sameCommit=nextCiDisclosure?.dataset.disclosureKey===ciDisclosureState.key;
        const link=sameCommit&&ciDisclosureState.link?[...nextCiDisclosure.querySelectorAll('a')].find(link=>link.getAttribute('href')===ciDisclosureState.link):null;
        (link??nextCiDisclosure?.querySelector('summary')??detail)?.focus({preventScroll:true});
      }
      else if (focusDetails) (dashboard.querySelector('#project-details') ?? dashboard.querySelector('[data-item-link]'))?.focus({ preventScroll: true });
      else if (focusedItem) [...dashboard.querySelectorAll('[data-item-link]')].find(el => el.dataset.itemLink === focusedItem)?.focus({ preventScroll: true });
      else if (focusedDetails) dashboard.querySelector('#project-details')?.focus({ preventScroll: true });
      else if (focusedClose) dashboard.querySelector('[data-item-close]')?.focus({ preventScroll: true });
      else if (focusedFilter) dashboard.querySelector(`[data-task-filter="${focusedFilter}"]`)?.focus({ preventScroll: true });
      else if (focusedReview) [...dashboard.querySelectorAll('[data-review-run]')].find(el => el.dataset.reviewRun === focusedReview && !el.disabled)?.focus({ preventScroll: true });
      else if (focusedAction) {
        const button = [...dashboard.querySelectorAll('[data-run-action]')].find(el => el.dataset.runAction === focusedAction && !el.disabled);
        (button ?? dashboard.querySelector('#project-details'))?.focus({preventScroll:true});
      }
      else if(focusedPr)dashboard.querySelector('#project-details')?.focus({preventScroll:true});
      else if (focusedStatus) {
        const target = form?.querySelector(focusedStatus);
        (target && !target.disabled ? target : dashboard.querySelector('#project-details'))?.focus({ preventScroll: true });
      }
      if(toastRegion.querySelector('[data-toast-message]').textContent===t('Refresh failed. The previous snapshot is still displayed.'))toast.hide();
      return true;
    } catch {
      const cached=dashboard.querySelector('[data-cached-view]');if(cached)cached.textContent=t('Saved view · refresh failed');
      returnFocus=null;
      notify(t("Refresh failed. The previous snapshot is still displayed."),'failure');
      return false;
    } finally {
      refreshing = false;
      delete dashboard.dataset.refreshing;
      if(pendingHistory){const next=pendingHistory;pendingHistory=null;refresh(next,true).then(()=>{if(!next.searchParams.has('item'))restoreTaskFocus();});}
    }
  }
  search?.addEventListener('input',()=>{filter();const url=new URL(location.href);if(search.value)url.searchParams.set('q',search.value);else url.searchParams.delete('q');history.replaceState(history.state,'',url);updateProjectTabs(url);});
  document.querySelector('.projects-search')?.addEventListener('submit',event=>{event.preventDefault();filter();});
  document.addEventListener('click', event => {
    const taskFilter=event.target.closest('[data-task-filter]');
    if(taskFilter){
      if(refreshing||busy())return;
      const url=new URL(location.href);
      const enabled=taskFilter.getAttribute('aria-pressed')==='true';
      url.searchParams.delete('active');url.searchParams.delete('attention');
      if(!enabled)url.searchParams.set(taskFilter.dataset.taskFilter,'1');
      navigate(url,false);return;
    }
    const sorter=event.target.closest('[data-sort]');
    if(sorter){const url=new URL(location.href);const key=sorter.dataset.sort;url.searchParams.set('dir',url.searchParams.get('sort')===key&&url.searchParams.get('dir')!=='desc'?'desc':'asc');url.searchParams.set('sort',key);navigate(url,false);return;}
    if(event.target.closest('[data-pr-dismiss]')){dismissPr();return;}
    const prMethod=event.target.closest('[data-pr-method]');
    if(prMethod&&confirmingPr){
      const panel=document.getElementById(confirmingPr.dataset.prConfirmTarget);
      confirmingPr.dataset.prMethodValue=prMethod.dataset.prMethod;
      panel.querySelector('[data-pr-choices]').hidden=true;
      panel.querySelector('[data-pr-confirmation]').hidden=false;
      const confirm=panel.querySelector('[data-pr-confirm]');confirm.textContent=prMethod.dataset.prConfirmLabel;
      confirm.focus({preventScroll:true});positionPr();return;
    }
    if(event.target.closest('[data-pr-confirm]')){
      const button=confirmingPr,method=button?.dataset.prMethodValue??null;
      dismissPr(false);if(button)submitPr(button,method);return;
    }
    const prAction=event.target.closest('[data-pr-action]');
    if(prAction){
      if(dismissedPrTrigger===prAction){dismissedPrTrigger=null;dismissPr();return;}
      if(prAction.disabled||requestingAction||requestingReview||requestingStatus||refreshing)return;
      if(prAction.hasAttribute('data-pr-check')){submitPr(prAction,prAction.dataset.prMethodValue||null);return;}
      if(confirmingPr===prAction){dismissPr();return;}
      dismissConfirmation(false);dismissPr(false);confirmingPr=prAction;prAction.setAttribute('aria-expanded','true');delete prAction.dataset.prMethodValue;
      const panel=document.getElementById(prAction.dataset.prConfirmTarget),choices=panel.querySelector('[data-pr-choices]');
      if(choices){choices.hidden=false;panel.querySelector('[data-pr-confirmation]').hidden=true;}
      panel.showPopover();positionPr();
      (choices?.querySelector('[data-pr-method]')??panel.querySelector('[data-pr-confirm]')).focus({preventScroll:true});return;
    }
    if (event.target.closest('[data-run-dismiss]')) { dismissConfirmation(); return; }
    if (event.target.closest('[data-run-confirm]')) { const button=confirmingAction; dismissConfirmation(false); if(button) submitRunAction(button,true); return; }
    const runAction = event.target.closest('[data-run-action]');
    if (runAction) {
      if (runAction.disabled || requestingAction || requestingReview || requestingStatus || refreshing) return;
      dismissPr(false);dismissConfirmation(false);
      if (runAction.dataset.runConfirmation) {
        confirmingAction=runAction;
        const panel=document.getElementById(runAction.dataset.runConfirmTarget);
        panel.hidden=false; panel.querySelector('[data-run-confirm]').focus();
      } else submitRunAction(runAction,false);
      return;
    }
    const review = event.target.closest('[data-review-run]');
    if (review) { event.preventDefault(); submitReview(review); return; }
    if(event.target.closest('.projects-ci-details summary')){
      queueMicrotask(()=>rememberView(new URL(location.href)));
      return;
    }
    const row=event.target.closest('.projects-table tbody tr');
    const link = event.target.closest('[data-item-link], [data-item-close], [data-project-tabs] a') ?? (row&&!getSelection()?.toString()?row.querySelector('[data-item-link]'):null);
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    event.preventDefault();
    if(link.hasAttribute('data-item-close')&&settling)cancelMotion();
    if (requestingReview || requestingStatus || requestingAction || settling) return;
    dismissPr(false);
    if(link.hasAttribute('data-item-link'))returnFocus=link.dataset.itemLink;
    if(link.closest('[data-project-tabs]'))lastDetailUrl=null;
    if(link.hasAttribute('data-item-close') && history.state?.projectsDetail){dismissConfirmation(false);history.back();return;}
    navigate(new URL(link.href),true);
  });
  async function navigate(url,focusDetails=true) {
    if(busy()||settling||(refreshing&&!views.has(viewKey(url))))return;
    dismissConfirmation(false);
    if(search?.value)url.searchParams.set('q',search.value);else url.searchParams.delete('q');
    const oldDetail=dashboard.querySelector('#project-details');
    if(mobile.matches&&oldDetail&&!url.searchParams.has('item')&&!settledExit)await slide(oldDetail,0,innerWidth);
    settledExit=false;
    const cached=cachedView(url,focusDetails);
    if(cached){
      navigationVersion++;history.pushState({projectsDetail:focusDetails&&url.searchParams.has('item')},'',url);
      const version=navigationVersion;
      if(url.searchParams.has('item'))lastDetailUrl=new URL(url);
      if(mobile.matches&&url.searchParams.has('item')&&!oldDetail&&!settledEnter)await slide(dashboard.querySelector('#project-details'),innerWidth,0);
      if(version!==navigationVersion)return;
      settledEnter=false;
      if(refreshing){pendingHistory=url;return;}
      await refresh(url,false);return;
    }
    const version=navigationVersion;
    const succeeded=await refresh(url,focusDetails);
    if(!succeeded||version!==navigationVersion)return;
    history.pushState({projectsDetail:focusDetails && url.searchParams.has('item')},'',url);
    if(url.searchParams.has('item'))lastDetailUrl=new URL(url);
    else restoreTaskFocus();
  }
  function restoreTaskFocus(){if(returnFocus)[...dashboard.querySelectorAll('[data-item-link]')].find(link=>link.dataset.itemLink===returnFocus)?.focus({preventScroll:true});}
  function updateProjectTabs(url){
    document.querySelectorAll('[data-project-tabs] a').forEach(link=>{
      const key=new URL(link.href).searchParams.get('project')??'';
      const next=new URL(url);next.searchParams.delete('item');next.searchParams.delete('view');next.searchParams.delete('status');
      if(key)next.searchParams.set('project',key);else next.searchParams.delete('project');link.href=next.pathname+next.search;
      if((url.searchParams.get('project')??'')===key)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
    });
    const hidden=document.querySelector('.projects-search input[name=project]');if(hidden)hidden.value=url.searchParams.get('project')??'';
    const active=document.querySelector('.projects-search input[name=active]');if(active)active.value=url.searchParams.get('active')==='1'?'1':'';
    const attention=document.querySelector('.projects-search input[name=attention]');if(attention)attention.value=url.searchParams.get('attention')==='1'?'1':'';
    const languageLink=document.querySelector('[data-language-link]');if(languageLink){const next=new URL(url),other=document.documentElement.lang==='en'?'ru':'en';if(document.getElementById('kurami-web-context')){next.pathname=next.pathname.replace(/^\/(en|ru)(?=\/)/,'/'+other);next.searchParams.delete('lang');}else next.searchParams.set('lang',other);languageLink.href=next.pathname+next.search;}
  }
  function updateLayout(){
    const frame=dashboard.querySelector('.projects-table-frame');
    const detail=dashboard.querySelector('#project-details'),modal=mobile.matches&&!!detail;
    if(modal)detail.append(toastRegion);else toastHome.append(toastRegion);
    if(frame)app.style.setProperty('--projects-table-height',`${Math.max(220,innerHeight-frame.getBoundingClientRect().top-24)}px`);
    const toolbar=dashboard.querySelector('.projects-mobile-sort');
    for(const button of dashboard.querySelectorAll('.projects-table thead [data-sort]'))button.tabIndex=toolbar&&getComputedStyle(toolbar).display!=='none'?-1:0;
    document.body.classList.toggle('projects-mobile-detail-open',modal);
    for(const element of [document.querySelector('[data-site-header]'),document.querySelector('.projects-toolbar'),dashboard.querySelector('.projects-overview'),dashboard.querySelector('.projects-mobile-sort'),frame])if(element)element.inert=modal;
    if(detail){
      if(modal){detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');}
      else{detail.removeAttribute('role');detail.removeAttribute('aria-modal');detail.removeAttribute('data-enter');}
    }
  }
  document.addEventListener('beforetoggle',event=>{
    if(event.target.id!=='projects-sync-popover'||event.newState!=='open')return;
    const rect=dashboard.querySelector('[data-sync-trigger]').getBoundingClientRect(),popover=event.target;
    const width=Math.min(380,innerWidth-16);
    popover.style.setProperty('--popover-left',`${Math.max(8,Math.min(rect.right-width,innerWidth-width-8))}px`);
    popover.style.setProperty('--popover-top',`${Math.max(8,Math.min(rect.bottom+8,innerHeight-300))}px`);
  },true);
  document.addEventListener('toggle',event=>{if(event.target.id==='projects-sync-popover'&&event.newState==='open'){const popover=event.target;const rect=dashboard.querySelector('[data-sync-trigger]').getBoundingClientRect();popover.style.setProperty('--popover-top',`${Math.max(8,Math.min(rect.bottom+8,innerHeight-popover.offsetHeight-8))}px`);}},true);
  addEventListener('resize',()=>{cancelGesture();cancelMotion();updateLayout();});mobile.addEventListener('change',()=>{cancelGesture();cancelMotion();updateLayout();});
  document.addEventListener('pointerdown',event=>{
    if(gesture){cancelGesture();return;}
    if(!mobile.matches||event.pointerType!=='touch'||!event.isPrimary||busy()||settling||getSelection()?.toString()||event.clientX<24||event.clientX>innerWidth-24||event.target.closest('a,button,input,select,textarea,summary,[popover],[data-chart],.chart'))return;
    let target=event.target;
    while(target&&target!==document.body){if(target.scrollWidth>target.clientWidth+2&&['auto','scroll'].includes(getComputedStyle(target).overflowX))return;target=target.parentElement;}
    const detail=dashboard.querySelector('#project-details');
    if(!detail&&(!lastDetailUrl||!views.has(viewKey(lastDetailUrl))||![...dashboard.querySelectorAll('[data-item-link]')].some(link=>link.dataset.itemLink===lastDetailUrl.searchParams.get('item'))))return;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,lastAt:performance.now(),velocity:0,delta:0,locked:false,detail:!!detail,panel:detail};
  },{passive:true});
  document.addEventListener('pointermove',event=>{
    const start=gesture;if(!start||start.id!==event.pointerId)return;
    const dx=event.clientX-start.x,dy=event.clientY-start.y;
    if(!start.locked){
      if(Math.abs(dy)>10&&Math.abs(dy)>Math.abs(dx)){cancelGesture();return;}
      if(Math.abs(dx)<10)return;
      if(Math.abs(dx)<=Math.abs(dy)*1.3||(start.detail?dx<0:dx>0)){cancelGesture();return;}
      start.locked=true;
      if(!start.detail){
        const template=document.createElement('template');template.innerHTML=views.get(viewKey(lastDetailUrl));
        start.panel=template.content.querySelector('#project-details');if(!start.panel){cancelGesture();return;}
        start.panel.removeAttribute('id');start.panel.removeAttribute('aria-labelledby');start.panel.setAttribute('aria-hidden','true');start.panel.inert=true;document.body.append(start.panel);
        start.panel.scrollTop=detailScrolls.get(start.panel.dataset.detailItem)??0;
      }
      start.panel.setAttribute('data-dragging','');
    }
    event.preventDefault();
    const at=performance.now();start.velocity=(event.clientX-start.lastX)/Math.max(1,at-start.lastAt);start.lastX=event.clientX;start.lastAt=at;
    start.delta=start.detail?Math.max(0,Math.min(innerWidth,dx)):Math.min(0,Math.max(-innerWidth,dx));
    start.panel.style.transform=`translateX(${start.detail?start.delta:innerWidth+start.delta}px)`;
  },{passive:false});
  document.addEventListener('pointerup',async event=>{
    const start=gesture;if(!start||event.pointerId!==start.id)return;
    gesture=null;if(!start.locked){motionFinished();return;}
    const velocity=performance.now()-start.lastAt<100?Math.abs(start.velocity):0;
    const complete=Math.abs(start.delta)>innerWidth*.28||(Math.abs(start.delta)>innerWidth*.12&&velocity>.5);
    if(complete)navigationVersion++;
    const from=start.detail?start.delta:innerWidth+start.delta;
    const settled=await slide(start.panel,from,complete?(start.detail?innerWidth:0):(start.detail?0:innerWidth));
    start.panel.removeAttribute('data-dragging');
    if(!complete||!settled){if(!start.detail)start.panel.remove();else start.panel.style.removeProperty('transform');return;}
    if(start.detail){start.panel.dataset.exited='true';settledExit=true;dashboard.querySelector('[data-item-close]')?.click();}
    else{settledEnter=true;await navigate(new URL(lastDetailUrl));start.panel.remove();}
  },{passive:true});
  function cancelGesture(){const start=gesture;gesture=null;if(start?.panel){if(!start.detail)start.panel.remove();else start.panel.style.removeProperty('transform');start.panel.removeAttribute('data-dragging');}motionFinished();}
  function cancelMotion(){motionVersion++;settling=false;delete dashboard.dataset.transitioning;document.querySelectorAll('.projects-detail:not([data-exited])').forEach(panel=>{panel.getAnimations().forEach(animation=>animation.cancel());panel.style.removeProperty('transform');});motionFinished();}
  document.addEventListener('pointercancel',cancelGesture,{passive:true});
  async function submitReview(button) {
    if(busy())return;
    return requestAction(button,{kind:'review',path:'/api/ai-review',timeout:10000,
      body:{runId:button.dataset.reviewRun,project:button.dataset.reviewProject,itemId:button.dataset.reviewItem,head:button.dataset.reviewHead,key:button.dataset.reviewKey},
      unconfirmed:t("Could not confirm the request. Retry safely: another click will not create a duplicate."),
      response:async(result,response)=>{
        if(!response.ok)throw new Error(result.error||t("Could not request AI Review."));
        button.disabled=true;await refresh();
        notify(['failed','rejected'].includes(result.requestState)?t("The previous request did not start. Retry AI Review for the current commit."):result.state==='existing'?t("This AI Review request has already been accepted."):t("AI Review queued."),['failed','rejected'].includes(result.requestState)?'warning':'success');
      },
    });
  }
  function dismissConfirmation(focus = true) {
    if (!confirmingAction) return;
    const button=confirmingAction;
    const panel=document.getElementById(button.dataset.runConfirmTarget);
    if(panel) panel.hidden=true;
    confirmingAction=null;
    if(focus) button.focus();
  }
  async function submitRunAction(button,confirmed) {
    return requestAction(button,{kind:'action',path:'/api/run-action',timeout:10000,
      body:{runId:button.dataset.runId,project:button.dataset.runProject,itemId:button.dataset.runItem,action:button.dataset.runAction,fingerprint:button.dataset.runFingerprint,key:button.dataset.runKey,confirmed},
      unconfirmed:t("Could not confirm the request. Another click checks the same request without a duplicate."),
      response:async(result,response)=>{
        if(!response.ok){await refresh();throw new Error(result.error||t("Could not request this action."));}
        button.disabled=true;await refresh();
        notify(['failed','rejected'].includes(result.requestState)?t("The previous request failed. Check the state and retry."):result.requestState==='applied'?t("Action confirmed."):result.state==='existing'?t("This request has already been accepted."):t("Action queued in Kurami."),['failed','rejected'].includes(result.requestState)?'warning':'success');
      },
    });
  }
  function updateStatusChoice(form) {
    if(form.hasAttribute('data-start-task'))return;
    if (form.dataset.check === 'true') return;
    const select = form.querySelector('select');
    const changed = select.value !== JSON.parse(form.dataset.from);
    form.querySelector('[data-status-submit]').disabled = select.disabled || !changed;
    if (!select.disabled) {
      const note = form.querySelector('[data-status-note]');
      note.dataset.defaultTone??=note.dataset.noteTone||'info';
      note.dataset.noteTone=changed?'info':note.dataset.defaultTone;
      note.textContent = changed ? JSON.parse(form.dataset.hints)[select.value] || '' : note.dataset.defaultNote || '';
      note.hidden = !note.textContent;
    }
  }
  const statusMessages=JSON.parse(app?.dataset.statusMessages??'{}');
  dashboard.addEventListener('change', event => { const form = event.target.closest('[data-status-form]'); if (form) updateStatusChoice(form); });
  dashboard.addEventListener('submit', async event => {
    const form=event.target.closest('[data-status-form]');if(!form)return;
    event.preventDefault();const button=form.querySelector('[data-status-submit]');
    if(button.disabled||busy()||refreshing)return;
    const select=form.querySelector('select'),start=form.hasAttribute('data-start-task'),target=form.dataset.check==='true'||start?form.dataset.target:select.value;
    if(select)select.disabled=true;
    if(start)form.querySelector('[data-status-note]').textContent=t('Requesting task start in GitHub.');
    await requestAction(button,{kind:'status',path:'/api/status',timeout:30000,
      body:{project:form.dataset.project,itemId:form.dataset.item,from:JSON.parse(form.dataset.from),target,observedAt:form.dataset.observedAt,key:form.dataset.key},
      unconfirmed:t("Could not confirm the write. Another click checks this request's result."),
      response:async(result,response)=>{
        if(start&&response.ok)button.disabled=true;
        await refresh();const presentation=statusMessages[result.state];
        if(!response.ok)throw new Error(result.error||presentation?.message||t("Could not save status."));
        notify(presentation?.message||t("Request accepted."),presentation?.tone||'info',result.state==='synced'?undefined:0);
      },error:()=>{if(form.isConnected){if(select)select.disabled=form.dataset.check==='true';button.disabled=false;if(start){const note=form.querySelector('[data-status-note]');note.textContent=t('Task start is unconfirmed. Check the same request before trying again.');note.dataset.noteTone='warning';}}},
    });
  });
  addEventListener('popstate',async event=>{
    if(window.kuramiMobilePanelPopState?.(event))return;
    navigationVersion++;const version=navigationVersion;cancelGesture();cancelMotion();dismissConfirmation(false);const url=new URL(location.href);
    const detail=dashboard.querySelector('#project-details');
    if(mobile.matches&&detail&&!url.searchParams.has('item')&&!settledExit)await slide(detail,0,innerWidth);
    if(version!==navigationVersion)return;
    settledExit=false;
    if(url.searchParams.has('item'))lastDetailUrl=url;
    const cached=cachedView(url,!!url.searchParams.has('item'));
    if(cached&&mobile.matches&&!detail&&url.searchParams.has('item'))await slide(dashboard.querySelector('#project-details'),innerWidth,0);
    if(version!==navigationVersion)return;
    if(refreshing){pendingHistory=url;return;}await refresh(url,true);if(!url.searchParams.has('item'))restoreTaskFocus();
  });
  rememberView(new URL(location.href));
  if(new URL(location.href).searchParams.has('item'))lastDetailUrl=new URL(location.href);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&confirmingPr){event.preventDefault();dismissPr();return;}
    if(confirmingPr&&event.target.closest?.('[data-pr-choices]')&&['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
      const choices=[...document.getElementById(confirmingPr.dataset.prConfirmTarget).querySelectorAll('[data-pr-method]')],current=choices.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?choices.length-1:(current+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;
      event.preventDefault();choices[next]?.focus({preventScroll:true});return;
    }
    if(event.key==='Escape'&&confirmingAction){event.preventDefault();dismissConfirmation();return;}
    const detail=dashboard.querySelector('#project-details');
    if(!detail||!mobile.matches)return;
    if(event.key==='Escape'){event.preventDefault();detail.querySelector('[data-item-close]')?.click();}
    if(event.key==='Tab'){
      const controls=[...detail.querySelectorAll('a[href],button:not(:disabled),select:not(:disabled),summary')].filter(element=>element.getClientRects().length&&!element.closest('[hidden]')&&(!element.closest('details:not([open])')||element.tagName==='SUMMARY'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===detail)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===detail)){event.preventDefault();first?.focus();}
    }
  });
  setInterval(() => { if (!busy() && !document.hidden && !getSelection()?.toString() && !dashboard.querySelector(':popover-open')) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!busy() && !document.hidden && !getSelection()?.toString() && !dashboard.querySelector(':popover-open')) refresh(); });
  // Backlog capture: open from the toolbar or prefilled from a share/shortcut; create the issue on submit.
  const capture=document.getElementById('projects-capture'),captureForm=capture?.querySelector('[data-capture-form]');
  function closeCapture(){capture.close();if(new URL(location.href).searchParams.get('capture')){const url=new URL(location.href);for(const key of ['capture','title','text','url','source'])url.searchParams.delete(key);history.replaceState(history.state,'',url);}}
  if(capture&&captureForm){
    document.addEventListener('click',event=>{
      if(event.target.closest?.('[data-capture-open]')){capture.showModal();captureForm.elements.title.focus();}
      else if(capture.contains(event.target)&&event.target.closest?.('[data-dialog-close]'))closeCapture();
    });
    captureForm.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=captureForm.querySelector('[type=submit]');if(button.getAttribute('aria-busy')==='true')return;
      button.setAttribute('aria-busy','true');button.disabled=true;
      try{
        const response=await fetch(kuramiAppUrl('/api/capture'),{method:'POST',headers:{'content-type':'application/json'},cache:'no-store',signal:AbortSignal.timeout(30000),
          body:JSON.stringify({key:captureForm.dataset.key,project:captureForm.elements.project.value,title:captureForm.elements.title.value,note:captureForm.elements.note.value,shared:captureForm.dataset.shared,source:captureForm.dataset.source})});
        const result=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(result.error||t('GitHub is unavailable right now. The text stays in the form; try again.'));
        toast.show(`${t('Created')}: #${result.number} · ${t(result.onBoard?'on the board in Backlog':'as an issue')}`,{tone:'success'});
        captureForm.reset();captureForm.dataset.key=crypto.randomUUID();captureForm.dataset.shared='';captureForm.dataset.source='';
        for(const context of captureForm.querySelectorAll('.projects-capture__context'))context.remove();
        closeCapture();
      }catch(error){toast.show(error.message,{tone:'failure'});}
      finally{button.removeAttribute('aria-busy');button.disabled=false;}
    });
    if(capture.hasAttribute('data-open-on-load'))capture.showModal();
  }
  filter();updateLayout();updateProjectTabs(new URL(location.href));loadPrControl();
  if(mobile.matches&&dashboard.querySelector('#project-details'))dashboard.querySelector('#project-details').focus({preventScroll:true});
})();
