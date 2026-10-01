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
  const status = document.querySelector('[data-refresh-status]');
  const statusHome=status?.parentElement;
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
    if (refreshing || confirmingAction) return;
    refreshing = true;
    const previousFocus = document.activeElement;
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
      const response = await fetch('/api/fragment?' + url.searchParams, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('refresh failed');
      const html=await response.text();
      statusHome?.append(status);
      dashboard.innerHTML = html;
      const table=dashboard.querySelector('.projects-table');
      if(table){table.scrollTop=scrollTop;table.scrollLeft=scrollLeft;}
      const detail=dashboard.querySelector('#project-details');
      if(detail && detail.dataset.detailItem===previousItem) detail.scrollTop=detailScroll;
      updateLayout(focusDetails && detail?.dataset.detailItem!==previousItem);
      updateProjectTabs(url);
      filter();
      status.textContent = '';
      const form = dashboard.querySelector('[data-status-form]');
      const select = form?.querySelector('select');
      if (statusDraft && form?.dataset.item === statusDraft.item && select && !select.disabled) {
        if (form.dataset.from === statusDraft.from && [...select.options].some(option => option.value === statusDraft.value)) select.value = statusDraft.value;
        else status.textContent = t("Status changed. Check the new state before saving.");
      }
      if (form) updateStatusChoice(form);
      if (focusDetails) (dashboard.querySelector('#project-details') ?? dashboard.querySelector('[data-item-link]'))?.focus({ preventScroll: true });
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
      returnFocus=null;
      status.textContent = t("Refresh failed. The previous snapshot is still displayed.");
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
        const panel=runAction.closest('.projects-run-action').querySelector('[data-run-confirm-panel]');
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
    if (refreshing || requestingReview || requestingStatus || requestingAction) return;
    if(link.hasAttribute('data-item-link'))returnFocus=link.dataset.itemLink;
    if(link.closest('[data-project-tabs]'))lastDetailUrl=null;
    if(link.hasAttribute('data-item-close') && history.state?.projectsDetail){dismissConfirmation(false);history.back();return;}
    navigate(new URL(link.href),true);
  });
  async function navigate(url,focusDetails=true) {
    if(refreshing||requestingReview||requestingStatus||requestingAction)return;
    dismissConfirmation(false);
    if(search?.value)url.searchParams.set('q',search.value);else url.searchParams.delete('q');
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
    const languageLink=document.querySelector('[data-language-link]');if(languageLink){const next=new URL(url);next.searchParams.set('lang',document.documentElement.lang==='en'?'ru':'en');languageLink.href=next.pathname+next.search;}
  }
  function updateLayout(animate=false){
    const frame=dashboard.querySelector('.projects-table-frame');
    const detail=dashboard.querySelector('#project-details'),modal=mobile.matches&&!!detail;
    if(modal)detail.insertBefore(status,detail.querySelector('h2'));else statusHome?.append(status);
    if(frame)app.style.setProperty('--projects-table-height',`${Math.max(220,innerHeight-frame.getBoundingClientRect().top-24)}px`);
    const toolbar=dashboard.querySelector('.projects-mobile-sort');
    for(const button of dashboard.querySelectorAll('.projects-table thead [data-sort]'))button.tabIndex=toolbar&&getComputedStyle(toolbar).display!=='none'?-1:0;
    document.body.classList.toggle('projects-mobile-detail-open',modal);
    for(const element of [document.querySelector('[data-site-header]'),document.querySelector('.projects-toolbar'),dashboard.querySelector('.projects-overview'),dashboard.querySelector('.projects-mobile-sort'),frame])if(element)element.inert=modal;
    if(detail){
      if(modal){detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');if(animate){detail.setAttribute('data-enter','');detail.addEventListener('animationend',()=>detail.removeAttribute('data-enter'),{once:true});}}
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
  addEventListener('resize',()=>updateLayout());mobile.addEventListener('change',()=>updateLayout());
  document.addEventListener('pointerdown',event=>{
    if(!mobile.matches||event.pointerType!=='touch'||confirmingAction||event.target.closest('a,button,input,select,textarea,[popover]'))return;
    gesture={x:event.clientX,y:event.clientY,detail:!!dashboard.querySelector('#project-details')};
  },{passive:true});
  document.addEventListener('pointerup',event=>{
    const start=gesture;gesture=null;if(!start||Math.abs(event.clientY-start.y)>60)return;
    const delta=event.clientX-start.x;
    if(start.detail&&delta>80){const close=dashboard.querySelector('[data-item-close]');close?.click();}
    else if(!start.detail&&delta< -80&&lastDetailUrl){const id=lastDetailUrl.searchParams.get('item');if([...dashboard.querySelectorAll('[data-item-link]')].some(link=>link.dataset.itemLink===id))navigate(new URL(lastDetailUrl));}
  },{passive:true});
  document.addEventListener('pointercancel',()=>gesture=null,{passive:true});
  async function submitReview(button) {
    if (button.disabled || requestingReview || requestingStatus || requestingAction || confirmingAction || refreshing) return;
    requestingReview = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/ai-review', { method: 'POST', headers: requestHeaders,
        body: JSON.stringify({ runId: button.dataset.reviewRun, project: button.dataset.reviewProject, itemId: button.dataset.reviewItem, head: button.dataset.reviewHead, key: button.dataset.reviewKey }),
        signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t("Could not request AI Review."));
      button.disabled = true;
      await refresh();
      status.textContent = ['failed', 'rejected'].includes(result.requestState) ? t("The previous request did not start. Retry AI Review for the current commit.") : result.state === 'existing' ? t("This AI Review request has already been accepted.") : t("AI Review queued.");
    } catch (error) { status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? t("Could not confirm the request. Retry safely: another click will not create a duplicate.") : error.message; }
    finally { requestingReview = false; button.removeAttribute('aria-busy'); }
  }
  function dismissConfirmation(focus = true) {
    if (!confirmingAction) return;
    const button=confirmingAction;
    const panel=button.closest('.projects-run-action')?.querySelector('[data-run-confirm-panel]');
    if(panel) panel.hidden=true;
    confirmingAction=null;
    if(focus) button.focus();
  }
  async function submitRunAction(button,confirmed) {
    if (button.disabled || requestingAction || requestingReview || requestingStatus || refreshing) return;
    requestingAction=true; button.setAttribute('aria-busy','true');
    try {
      const response=await fetch('/api/run-action',{method:'POST',headers:requestHeaders,
        body:JSON.stringify({runId:button.dataset.runId,project:button.dataset.runProject,itemId:button.dataset.runItem,action:button.dataset.runAction,fingerprint:button.dataset.runFingerprint,key:button.dataset.runKey,confirmed}),signal:AbortSignal.timeout(10000)});
      const result=await response.json();
      if(!response.ok) { await refresh(); throw new Error(result.error || t("Could not request this action.")); }
      button.disabled=true;
      await refresh();
      status.textContent=['failed','rejected'].includes(result.requestState) ? t("The previous request failed. Check the state and retry.") :
        result.requestState==='applied' ? t("Action confirmed.") : result.state==='existing' ? t("This request has already been accepted.") : t("Action queued in Kurami.");
    } catch(error) {
      status.textContent=error.name==='TimeoutError' || error.name==='TypeError' ? t("Could not confirm the request. Another click checks the same request without a duplicate.") : error.message;
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
      const response = await fetch('/api/status', { method: 'POST', headers: requestHeaders,
        body: JSON.stringify({ project: form.dataset.project, itemId: form.dataset.item, from: JSON.parse(form.dataset.from), target, observedAt: form.dataset.observedAt, key: form.dataset.key }), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      await refresh();
      if (!response.ok) throw new Error(result.error || statusMessages[result.state] || t("Could not save status."));
      status.textContent = statusMessages[result.state] || t("Request accepted.");
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? t("Could not confirm the write. Another click checks this request's result.") : error.message;
      // Retain the nonce until a refreshed snapshot has resolved the operation.
      if (form.isConnected) { select.disabled = form.dataset.check === 'true'; button.disabled = false; }
    } finally { requestingStatus = false; button.removeAttribute('aria-busy'); }
  });
  addEventListener('popstate',async()=>{navigationVersion++;dismissConfirmation(false);const url=new URL(location.href);if(url.searchParams.has('item'))lastDetailUrl=url;if(refreshing){pendingHistory=url;return;}await refresh(url,true);if(!url.searchParams.has('item'))restoreTaskFocus();});
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
