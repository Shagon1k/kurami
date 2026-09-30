(() => {
  const dashboard = document.querySelector('#projects-dashboard');
  const search = document.querySelector('input[name=q]');
  const refreshButton = document.querySelector('[data-projects-refresh]');
  const status = document.querySelector('[data-refresh-status]');
  if (!dashboard) return;
  let refreshing = false;
  let requestingReview = false;
  let requestingStatus = false;
  let requestingAction = false;
  let confirmingAction = null;
  function filter() {
    const query = (search?.value ?? '').trim().toLocaleLowerCase('ru');
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
    const actionsOpen = dashboard.querySelector('.projects-run-actions')?.open;
    const focusedDetails = previousFocus?.id === 'project-details';
    const focusedClose = previousFocus?.hasAttribute('data-item-close');
    const previousForm = dashboard.querySelector('[data-status-form]');
    const previousSelect = previousForm?.querySelector('select');
    const statusDraft = previousSelect && previousForm.dataset.check === 'false' && previousSelect.value !== JSON.parse(previousForm.dataset.from) ? { value: previousSelect.value, from: previousForm.dataset.from, item: previousForm.dataset.item } : null;
    const focusedStatus = previousForm?.contains(previousFocus) ? previousFocus.tagName === 'SELECT' ? 'select' : '[data-status-submit]' : null;
    refreshButton?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/fragment?' + url.searchParams, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('refresh failed');
      dashboard.innerHTML = await response.text();
      if (actionsOpen && dashboard.querySelector('.projects-run-actions')) dashboard.querySelector('.projects-run-actions').open = true;
      filter();
      status.textContent = '';
      const form = dashboard.querySelector('[data-status-form]');
      const select = form?.querySelector('select');
      if (statusDraft && form?.dataset.item === statusDraft.item && select && !select.disabled) {
        if (form.dataset.from === statusDraft.from && [...select.options].some(option => option.value === statusDraft.value)) select.value = statusDraft.value;
        else status.textContent = 'Статус изменился. Проверьте новое состояние перед сохранением.';
      }
      if (form) updateStatusChoice(form);
      if (focusDetails) (dashboard.querySelector('#project-details') ?? dashboard.querySelector('[data-item-link]'))?.focus({ preventScroll: true });
      else if (focusedItem) [...dashboard.querySelectorAll('[data-item-link]')].find(el => el.dataset.itemLink === focusedItem)?.focus({ preventScroll: true });
      else if (focusedDetails) dashboard.querySelector('#project-details')?.focus({ preventScroll: true });
      else if (focusedClose) dashboard.querySelector('[data-item-close]')?.focus({ preventScroll: true });
      else if (focusedReview) [...dashboard.querySelectorAll('[data-review-run]')].find(el => el.dataset.reviewRun === focusedReview && !el.disabled)?.focus({ preventScroll: true });
      else if (focusedAction) {
        const button = [...dashboard.querySelectorAll('[data-run-action]')].find(el => el.dataset.runAction === focusedAction && !el.disabled);
        (button ?? dashboard.querySelector('#project-details'))?.focus({preventScroll:true});
      }
      else if (focusedStatus) {
        const target = form?.querySelector(focusedStatus);
        (target && !target.disabled ? target : dashboard.querySelector('#project-details'))?.focus({ preventScroll: true });
      }
    } catch {
      status.textContent = 'Не удалось обновить данные. На экране остался предыдущий снимок.';
    } finally {
      refreshing = false;
      refreshButton?.removeAttribute('aria-busy');
    }
  }
  search?.addEventListener('input', filter);
  refreshButton?.addEventListener('click', () => refresh());
  dashboard.addEventListener('click', event => {
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
    const link = event.target.closest('[data-item-link], [data-item-close]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    event.preventDefault();
    if (refreshing) return;
    const url = new URL(link.href);
    dismissConfirmation(false);
    history.pushState({}, '', url);
    refresh(url, true);
  });
  async function submitReview(button) {
    if (button.disabled || requestingReview || requestingStatus || requestingAction || confirmingAction || refreshing) return;
    requestingReview = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/ai-review', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: button.dataset.reviewRun, project: button.dataset.reviewProject, itemId: button.dataset.reviewItem, head: button.dataset.reviewHead, key: button.dataset.reviewKey }),
        signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось запросить AI Review.');
      button.disabled = true;
      await refresh();
      status.textContent = ['failed', 'rejected'].includes(result.requestState) ? 'Предыдущий запрос не запустился. Повторите AI Review для текущего коммита.' : result.state === 'existing' ? 'Этот запрос AI Review уже принят.' : 'AI Review поставлено в очередь.';
    } catch (error) { status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Не удалось подтвердить запрос. Повторите попытку: повторное нажатие не создаст дубликат.' : error.message; }
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
      const response=await fetch('/api/run-action',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({runId:button.dataset.runId,project:button.dataset.runProject,itemId:button.dataset.runItem,action:button.dataset.runAction,fingerprint:button.dataset.runFingerprint,key:button.dataset.runKey,confirmed}),signal:AbortSignal.timeout(10000)});
      const result=await response.json();
      if(!response.ok) { await refresh(); throw new Error(result.error || 'Не удалось запросить действие.'); }
      button.disabled=true;
      await refresh();
      status.textContent=['failed','rejected'].includes(result.requestState) ? 'Предыдущий запрос не выполнен. Проверьте состояние и повторите действие.' :
        result.requestState==='applied' ? 'Действие подтверждено.' : result.state==='existing' ? 'Этот запрос уже принят.' : 'Действие поставлено в очередь Kurami.';
    } catch(error) {
      status.textContent=error.name==='TimeoutError' || error.name==='TypeError' ? 'Не удалось подтвердить запрос. Повторное нажатие проверит тот же запрос без дубликата.' : error.message;
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
  const statusMessages = { checking: 'Проверяем статус в GitHub.', writing: 'Сохраняем статус в GitHub.', awaiting_sync: 'GitHub обновлён. Ждём синхронизации Kurami.',
    synced: 'Статус синхронизирован.', conflict: 'Статус изменился в GitHub. Проверьте текущее состояние.', failed: 'Изменение статуса не подтверждено. Можно повторить запрос.',
    uncertain: 'Результат записи не подтверждён. Проверьте его перед повторным изменением.' };
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
      const response = await fetch('/api/status', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: form.dataset.project, itemId: form.dataset.item, from: JSON.parse(form.dataset.from), target, observedAt: form.dataset.observedAt, key: form.dataset.key }), signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      await refresh();
      if (!response.ok) throw new Error(result.error || statusMessages[result.state] || 'Не удалось сохранить статус.');
      status.textContent = statusMessages[result.state] || 'Запрос принят.';
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' || error.name === 'TypeError' ? 'Не удалось подтвердить запись. Повторное нажатие проверит результат этого запроса.' : error.message;
      // Retain the nonce until a refreshed snapshot has resolved the operation.
      if (form.isConnected) { select.disabled = form.dataset.check === 'true'; button.disabled = false; }
    } finally { requestingStatus = false; button.removeAttribute('aria-busy'); }
  });
  addEventListener('popstate', () => {dismissConfirmation(false);refresh();});
  dashboard.addEventListener('keydown',event=>{if(event.key==='Escape' && confirmingAction){event.preventDefault();dismissConfirmation();}});
  setInterval(() => { if (!requestingReview && !requestingStatus && !requestingAction && !confirmingAction && !document.hidden && !getSelection()?.toString()) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!requestingReview && !requestingStatus && !requestingAction && !confirmingAction && !document.hidden) refresh(); });
  filter();
})();
