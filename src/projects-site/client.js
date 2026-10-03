(() => {
  const dashboard = document.querySelector('#projects-dashboard');
  const search = document.querySelector('input[name=q]');
  const app=document.querySelector('[data-projects-app]');
  const messages=JSON.parse(app?.dataset.messages ?? '{}');
  const t=key=>messages[key]??key;
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
  const busy=()=>requestingReview||requestingStatus||requestingAction||confirmingAction;
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
      detail.querySelectorAll('[data-run-action],[data-review-run],[data-status-submit],select').forEach(control=>control.disabled=true);
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
  const notify=(message,tone='info',duration)=>toast.show(message,{tone,duration});
  if (!dashboard) return;
  let refreshing = false;
  let requestingReview = false;
  let requestingStatus = false;
  let requestingAction = false;
  let confirmingAction = null;
  function filter() {
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
    if (refreshing || confirmingAction || gesture || settling) return;
    refreshing = true;
    const version=navigationVersion;
    const previousFocus = document.activeElement;
    const focusedToast=toastRegion.contains(previousFocus);
    const focusedItem = previousFocus?.getAttribute('data-item-link');
    const focusedReview = previousFocus?.getAttribute('data-review-run');
    const focusedAction = previousFocus?.getAttribute('data-run-action');
    const previousTable=dashboard.querySelector('.projects-table');
    const scrollTop=previousTable?.scrollTop??0,scrollLeft=previousTable?.scrollLeft??0;
    const previousDetail=dashboard.querySelector('#project-details');
    const detailScroll=previousDetail?.scrollTop??0,previousItem=previousDetail?.dataset.detailItem;
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
      const html=await response.text();
      await waitForMotion();
      if(version!==navigationVersion)return false;
      toastHome.append(toastRegion);
      dashboard.innerHTML = html;
      const table=dashboard.querySelector('.projects-table');
      if(table){table.scrollTop=scrollTop;table.scrollLeft=scrollLeft;}
      const detail=dashboard.querySelector('#project-details');
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
      if(focusedToast && !toastRegion.hidden)toastRegion.querySelector('[data-toast-dismiss]').focus({preventScroll:true});
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
      else if (focusedStatus) {
        const target = form?.querySelector(focusedStatus);
        (target && !target.disabled ? target : dashboard.querySelector('#project-details'))?.focus({ preventScroll: true });
      }
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
      if(refreshing||requestingReview||requestingStatus||requestingAction||confirmingAction)return;
      const url=new URL(location.href);
      const enabled=taskFilter.getAttribute('aria-pressed')==='true';
      url.searchParams.delete('active');url.searchParams.delete('attention');
      if(!enabled)url.searchParams.set(taskFilter.dataset.taskFilter,'1');
      navigate(url,false);return;
    }
    const sorter=event.target.closest('[data-sort]');
    if(sorter){const url=new URL(location.href);const key=sorter.dataset.sort;url.searchParams.set('dir',url.searchParams.get('sort')===key&&url.searchParams.get('dir')!=='desc'?'desc':'asc');url.searchParams.set('sort',key);navigate(url,false);return;}
    if (event.target.closest('[data-run-dismiss]')) { dismissConfirmation(); return; }
    if (event.target.closest('[data-run-confirm]')) { const button=confirmingAction; dismissConfirmation(false); if(button) submitRunAction(button,true); return; }
    const runAction = event.target.closest('[data-run-action]');
    if (runAction) {
      if (runAction.disabled || requestingAction || requestingReview || requestingStatus || refreshing) return;
      dismissConfirmation(false);
      if (runAction.dataset.runConfirmation) {
        confirmingAction=runAction;
        const panel=document.getElementById(runAction.dataset.runConfirmTarget);
        panel.hidden=false; panel.querySelector('[data-run-confirm]').focus();
      } else submitRunAction(runAction,false);
      return;
    }
    const review = event.target.closest('[data-review-run]');
    if (review) { event.preventDefault(); submitReview(review); return; }
    const row=event.target.closest('.projects-table tbody tr');
    const link = event.target.closest('[data-item-link], [data-item-close], [data-project-tabs] a') ?? (row&&!getSelection()?.toString()?row.querySelector('[data-item-link]'):null);
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    event.preventDefault();
    if(link.hasAttribute('data-item-close')&&settling)cancelMotion();
    if (requestingReview || requestingStatus || requestingAction || settling) return;
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
    if (button.disabled || requestingReview || requestingStatus || requestingAction || confirmingAction || refreshing) return;
    requestingReview = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(kuramiAppUrl('/api/ai-review'), { method: 'POST', headers: requestHeaders,
        body: JSON.stringify({ runId: button.dataset.reviewRun, project: button.dataset.reviewProject, itemId: button.dataset.reviewItem, head: button.dataset.reviewHead, key: button.dataset.reviewKey }),
        signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("Could not request AI Review."));
      button.disabled = true;
      await refresh();
      notify(['failed', 'rejected'].includes(result.requestState) ? t("The previous request did not start. Retry AI Review for the current commit.") : result.state === 'existing' ? t("This AI Review request has already been accepted.") : t("AI Review queued."),['failed','rejected'].includes(result.requestState)?'warning':'success');
    } catch (error) { notify(error.name === 'TimeoutError' || error.name === 'TypeError' ? t("Could not confirm the request. Retry safely: another click will not create a duplicate.") : error.message,'failure'); }
    finally { requestingReview = false; button.removeAttribute('aria-busy'); }
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
    if (button.disabled || requestingAction || requestingReview || requestingStatus || refreshing) return;
    requestingAction=true; button.setAttribute('aria-busy','true');
    try {
      const response=await fetch(kuramiAppUrl('/api/run-action'),{method:'POST',headers:requestHeaders,
        body:JSON.stringify({runId:button.dataset.runId,project:button.dataset.runProject,itemId:button.dataset.runItem,action:button.dataset.runAction,fingerprint:button.dataset.runFingerprint,key:button.dataset.runKey,confirmed}),signal:AbortSignal.timeout(10000)});
      const result=await response.json();
      if(!response.ok) { await refresh(); throw new Error(result.error || t("Could not request this action.")); }
      button.disabled=true;
      await refresh();
      notify(['failed','rejected'].includes(result.requestState) ? t("The previous request failed. Check the state and retry.") :
        result.requestState==='applied' ? t("Action confirmed.") : result.state==='existing' ? t("This request has already been accepted.") : t("Action queued in Kurami."),['failed','rejected'].includes(result.requestState)?'warning':'success');
    } catch(error) {
      notify(error.name==='TimeoutError' || error.name==='TypeError' ? t("Could not confirm the request. Another click checks the same request without a duplicate.") : error.message,'failure');
    } finally {requestingAction=false;button.removeAttribute('aria-busy');}
  }
  function updateStatusChoice(form) {
    if (form.dataset.check === 'true') return;
    const select = form.querySelector('select');
    const changed = select.value !== JSON.parse(form.dataset.from);
    form.querySelector('[data-status-submit]').disabled = select.disabled || !changed;
    if (!select.disabled) {
      const note = form.querySelector('[data-status-note]');
      note.textContent = changed ? JSON.parse(form.dataset.hints)[select.value] || '' : note.dataset.defaultNote || '';
      note.hidden = !note.textContent;
    }
  }
  const statusMessages = { checking: t("Checking the current status in GitHub."), writing: t("Saving status in GitHub."), awaiting_sync: t("GitHub updated. Waiting for Kurami sync."),
    synced: t("Status synced."), conflict: t("Status changed in GitHub. Check the current state."), failed: t("Status change is unconfirmed. You can retry."),
    uncertain: t("The write is unconfirmed. Check its result before another change.") };
  dashboard.addEventListener('change', event => { const form = event.target.closest('[data-status-form]'); if (form) updateStatusChoice(form); });
  dashboard.addEventListener('submit', async event => {
    const form = event.target.closest('[data-status-form]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('[data-status-submit]');
    if (button.disabled || requestingStatus || requestingReview || requestingAction || confirmingAction || refreshing) return;
    requestingStatus = true; button.setAttribute('aria-busy', 'true');
    const select = form.querySelector('select');
    const target = form.dataset.check === 'true' ? form.dataset.target : select.value;
    select.disabled = true;
    try {
      const response = await fetch(kuramiAppUrl('/api/status'), { method: 'POST', headers: requestHeaders,
        body: JSON.stringify({ project: form.dataset.project, itemId: form.dataset.item, from: JSON.parse(form.dataset.from), target, observedAt: form.dataset.observedAt, key: form.dataset.key }), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      await refresh();
      if (!response.ok) throw new Error(result.error || statusMessages[result.state] || t("Could not save status."));
      const tone=['conflict','failed','uncertain'].includes(result.state)?'warning':result.state==='synced'?'success':'info';
      notify(statusMessages[result.state] || t("Request accepted."),tone,result.state==='synced'?undefined:0);
    } catch (error) {
      notify(error.name === 'TimeoutError' || error.name === 'TypeError' ? t("Could not confirm the write. Another click checks this request's result.") : error.message,'failure');
      // Retain the nonce until a refreshed snapshot has resolved the operation.
      if (form.isConnected) { select.disabled = form.dataset.check === 'true'; button.disabled = false; }
    } finally { requestingStatus = false; button.removeAttribute('aria-busy'); }
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
    if(event.key==='Escape'&&confirmingAction){event.preventDefault();dismissConfirmation();return;}
    const detail=dashboard.querySelector('#project-details');
    if(!detail||!mobile.matches)return;
    if(event.key==='Escape'){event.preventDefault();detail.querySelector('[data-item-close]')?.click();}
    if(event.key==='Tab'){
      const controls=[...detail.querySelectorAll('a[href],button:not(:disabled),select:not(:disabled)')].filter(element=>element.getClientRects().length&&!element.closest('[hidden]'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===detail)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===detail)){event.preventDefault();first?.focus();}
    }
  });
  setInterval(() => { if (!requestingReview && !requestingStatus && !requestingAction && !confirmingAction && !document.hidden && !getSelection()?.toString() && !dashboard.querySelector(':popover-open')) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!requestingReview && !requestingStatus && !requestingAction && !confirmingAction && !document.hidden && !getSelection()?.toString() && !dashboard.querySelector(':popover-open')) refresh(); });
  filter();updateLayout();updateProjectTabs(new URL(location.href));
  if(mobile.matches&&dashboard.querySelector('#project-details'))dashboard.querySelector('#project-details').focus({preventScroll:true});
})();
