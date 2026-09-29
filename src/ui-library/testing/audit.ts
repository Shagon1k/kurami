// Product-neutral page audit evaluated in the browser: layout overflow, image alternatives, control
// names, theme-switch state and WCAG AA text contrast against the nearest opaque background.
export const AUDIT_EXPRESSION = `(() => {
  const issues = [];
  const visible = element => { const style = getComputedStyle(element), box = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0; };
  if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) issues.push('Horizontal page overflow');
  for (const image of document.images) if (!image.hasAttribute('alt')) issues.push('Image without alt');
  for (const control of document.querySelectorAll('a[href], button, summary')) if (visible(control) && !(control.getAttribute('aria-label')?.trim() || control.textContent?.trim())) issues.push('Unnamed ' + control.tagName.toLowerCase());
  const theme = document.querySelector('[data-theme-toggle]');
  if (theme && theme.getAttribute('aria-pressed') !== String(document.documentElement.dataset.theme === 'dark')) issues.push('Theme state not exposed');
  const color = raw => { const match = raw.match(/^rgba?\\(([^)]+)\\)$/); if (!match) return null; const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number); return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite) ? parts : null; };
  const luminance = rgb => rgb.slice(0, 3).map(value => { const v = value / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  for (const element of document.querySelectorAll('body *')) {
    if (!visible(element) || element.closest('svg, .sr-only, [aria-hidden="true"]') || !Array.from(element.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())) continue;
    const style = getComputedStyle(element), foreground = color(style.color);
    if (!foreground || (foreground[3] !== undefined && foreground[3] < .99) || Number(style.opacity) < 1) continue;
    let background = null, ancestor = element;
    while (ancestor && !background) { const candidate = color(getComputedStyle(ancestor).backgroundColor); if (candidate && (candidate[3] === undefined || candidate[3] >= .99)) background = candidate; ancestor = ancestor.parentElement; }
    if (!background) continue;
    const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700;
    if (ratio < (large ? 2.95 : 4.45)) issues.push('Low text contrast ' + ratio.toFixed(2) + ': ' + element.tagName.toLowerCase() + '.' + String(element.className).slice(0, 40));
    if (issues.length >= 12) break;
  }
  return issues;
})()`;
