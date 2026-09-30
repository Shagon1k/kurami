(() => {
  const dashboard = document.querySelector('#projects-dashboard');
  const search = document.querySelector('input[name=q]');
  const refreshButton = document.querySelector('[data-projects-refresh]');
  const status = document.querySelector('[data-refresh-status]');
  if (!dashboard) return;
  let refreshing = false;
  let requestingReview = false;
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
    if (refreshing) return;
    refreshing = true;
    const previousFocus = document.activeElement;
    const focusedItem = previousFocus?.getAttribute('data-item-link');
    const focusedReview = previousFocus?.getAttribute('data-review-run');
    const focusedDetails = previousFocus?.id === 'project-details';
    const focusedClose = previousFocus?.hasAttribute('data-item-close');
    refreshButton?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/fragment?' + url.searchParams, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('refresh failed');
      dashboard.innerHTML = await response.text();
      filter();
      status.textContent = '';
      if (focusDetails) (dashboard.querySelector('#project-details') ?? dashboard.querySelector('[data-item-link]'))?.focus({ preventScroll: true });
      else if (focusedItem) [...dashboard.querySelectorAll('[data-item-link]')].find(el => el.dataset.itemLink === focusedItem)?.focus({ preventScroll: true });
      else if (focusedDetails) dashboard.querySelector('#project-details')?.focus({ preventScroll: true });
      else if (focusedClose) dashboard.querySelector('[data-item-close]')?.focus({ preventScroll: true });
      else if (focusedReview) [...dashboard.querySelectorAll('[data-review-run]')].find(el => el.dataset.reviewRun === focusedReview && !el.disabled)?.focus({ preventScroll: true });
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
    const review = event.target.closest('[data-review-run]');
    if (review) { event.preventDefault(); submitReview(review); return; }
    const link = event.target.closest('[data-item-link], [data-item-close]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    event.preventDefault();
    if (refreshing) return;
    const url = new URL(link.href);
    history.pushState({}, '', url);
    refresh(url, true);
  });
  async function submitReview(button) {
    if (button.disabled || requestingReview || refreshing) return;
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
  addEventListener('popstate', () => refresh());
  setInterval(() => { if (!requestingReview && !document.hidden && !getSelection()?.toString()) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!requestingReview && !document.hidden) refresh(); });
  filter();
})();
