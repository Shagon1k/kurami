// Product-neutral page audit evaluated in the browser: layout overflow, image alternatives, control
// names, theme-switch state and text contrast on solid backgrounds. Image-backed text needs a
// separate pixel or manual check; comparing it with an ancestor's flat colour is not evidence.
export const AUDIT_EXPRESSION = `(() => {
  const issues = [];
  const contrastReview = [];
  window.__kuramiContrastReview = contrastReview;
  document.querySelectorAll('[data-contrast-review]').forEach(element => element.removeAttribute('data-contrast-review'));
  // An open modal makes the rest of the page inert and dims it: only the dialog is audited then.
  const modal = document.querySelector('dialog:modal');
  const visible = element => { if (modal && !modal.contains(element)) return false; for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(element)) return false; const style = getComputedStyle(element), box = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; };
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) issues.push('Horizontal page overflow');
  for (const image of document.images) if (!image.hasAttribute('alt')) issues.push('Image without alt');
  for (const control of document.querySelectorAll('a[href], button, summary')) if (visible(control) && !(control.getAttribute('aria-label')?.trim() || control.textContent?.trim())) issues.push('Unnamed ' + control.tagName.toLowerCase());
  const theme = document.querySelector('[data-theme-toggle]');
  // A theme menu exposes the mode on its pressed option; a legacy toggle exposes it with aria-pressed.
  const mode = document.querySelector('[data-mode-choice][aria-pressed="true"]')?.getAttribute('data-mode-choice');
  if (theme && (theme.hasAttribute('aria-haspopup') ? mode !== document.documentElement.dataset.theme : theme.getAttribute('aria-pressed') !== String(document.documentElement.dataset.theme === 'dark'))) issues.push('Theme state not exposed');
  const color = raw => { const match = raw.match(/^rgba?\\(([^)]+)\\)$/); if (!match) return null; const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number); return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite) ? parts : null; };
  const luminance = rgb => rgb.slice(0, 3).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const element of document.querySelectorAll('body *')) {
    if (!visible(element) || element.closest('svg, .sr-only, [aria-hidden="true"]') || !Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) continue;
    const style = getComputedStyle(element), foreground = color(style.color);
    if (!foreground || (foreground[3] !== undefined && foreground[3] < .99) || Number(style.opacity) < 1) continue;
    let background = null, ancestor = element, imageBackground = false;
    while (ancestor && !background) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (ancestorStyle.backgroundImage !== 'none') { imageBackground = true; break; }
      const candidate = color(ancestorStyle.backgroundColor);
      if (candidate && (candidate[3] === undefined || candidate[3] >= .99)) background = candidate;
      ancestor = ancestor.parentElement;
    }
    if (imageBackground) {
      const id=String(contrastReview.length);
      element.setAttribute('data-contrast-review',id);
      const rectangles=[];
      for (const text of element.childNodes) if(text.nodeType===Node.TEXT_NODE&&text.textContent.trim()) {
        const range=document.createRange();range.selectNodeContents(text);
        for(const box of range.getClientRects())if(box.width&&box.height)rectangles.push({x:box.x+scrollX,y:box.y+scrollY,width:box.width,height:box.height});
      }
      const large=parseFloat(style.fontSize)>=24||parseFloat(style.fontSize)>=18.66&&Number(style.fontWeight)>=700;
      contrastReview.push({id,element:element.tagName.toLowerCase()+'.'+String(element.className),text:element.textContent.trim().slice(0,160),foreground:foreground.slice(0,3),required:large?3:4.5,rectangles,reason:'Image or gradient background: pixel/manual contrast check required'});
      continue;
    }
    if (!background) continue;
    const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700;
    if (ratio < (large ? 2.95 : 4.45)) issues.push('Low text contrast ' + ratio.toFixed(2) + ': ' + element.tagName.toLowerCase() + '.' + String(element.className).slice(0, 40));
    if (issues.length >= 12) break;
  }
  return issues;
})()`;

export const CONTRAST_REVIEW_EXPRESSION = 'window.__kuramiContrastReview ?? []';

/** Selectors of product components that are allowed to render their own controls. Adding one is a
 *  deliberate decision: prefer a library component, and explain the exception in the PR. */
export const productControls = {
  button: [] as string[],
  // Cinema's ranked box-office list is a composed ranking, not a data table.
  table: [".cinema-rank"],
  // Docs article navigation on phones; Stocks watchlist rows; Investment Review panel, periods,
  // position cards and learning cards; Cinema's top-10 expander.
  details: [".side-mobile", ".stock-row", ".investment-review", ".investment-review__period", ".review-position", ".review-learning-note", ".cinema-rank__more"],
};

/** Every visible control, table and disclosure must come from the library or a listed product component. */
export function inventoryExpression(allowed = productControls): string {
  return `(() => {
    const allowed = ${JSON.stringify(allowed)};
    const visible = element => { for (let parent = element.parentElement; parent; parent = parent.parentElement) if (parent.matches('details:not([open])') && !parent.querySelector(':scope > summary')?.contains(element)) return false; const style = getComputedStyle(element), box = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; };
    const listed = (element, kind) => allowed[kind].some(selector => element.matches(selector) || element.closest(selector));
    const describe = element => element.tagName.toLowerCase() + (element.className ? '.' + String(element.className).trim().split(/\\s+/).join('.') : '');
    const issues = [];
    for (const element of document.querySelectorAll('button, [role="button"]')) if (visible(element) && !element.matches('.button, .ui-info[data-ui-info]') && !listed(element, 'button')) issues.push('Unlisted button ' + describe(element));
    for (const element of document.querySelectorAll('table')) if (visible(element) && !element.closest('.table') && !listed(element, 'table')) issues.push('Unlisted table ' + describe(element));
    for (const element of document.querySelectorAll('details')) if (visible(element) && !element.matches('.disclosure, .site-menu, .site-switcher') && !listed(element, 'details')) issues.push('Unlisted disclosure ' + describe(element));
    for (const element of document.querySelectorAll('[data-theme-toggle]')) if (!element.matches('.theme-switch')) issues.push('Theme control outside the library ' + describe(element));
    const banner = document.querySelector('body > header');
    if (banner && !banner.matches('.site-header')) issues.push('Page header outside the library ' + describe(banner));
    return [...new Set(issues)];
  })()`;
}
