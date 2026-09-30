(() => {
  const dashboard = document.querySelector('#projects-dashboard');
  const search = document.querySelector('input[name=q]');
  const refreshButton = document.querySelector('[data-projects-refresh]');
  const status = document.querySelector('[data-refresh-status]');
  if (!dashboard) return;
  let refreshing = false;
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
    refreshButton?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch('/api/fragment?' + url.searchParams, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('refresh failed');
      dashboard.innerHTML = await response.text();
      filter();
      status.textContent = '';
      if (focusDetails) (dashboard.querySelector('#project-details') ?? dashboard.querySelector('[data-item-link]'))?.focus({ preventScroll: true });
      else if (focusedItem) [...dashboard.querySelectorAll('[data-item-link]')].find(el => el.dataset.itemLink === focusedItem)?.focus();
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
    const link = event.target.closest('[data-item-link], [data-item-close]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button) return;
    event.preventDefault();
    if (refreshing) return;
    const url = new URL(link.href);
    history.pushState({}, '', url);
    refresh(url, true);
  });
  addEventListener('popstate', () => refresh());
  setInterval(() => { if (!document.hidden && !dashboard.contains(document.activeElement)) refresh(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  filter();
})();
