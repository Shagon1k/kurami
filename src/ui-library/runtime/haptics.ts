/** Haptics: a short tick when a primary action is pressed or confirmed, a pulse for success and a double
 * buzz for a warning or failure toast. Only phones vibrate (coarse pointer and `navigator.vibrate`, so
 * Android; iOS ignores it), and never when the person asked for reduced motion. `data-haptic="off"` on an
 * element or an ancestor keeps it silent; `data-haptic="tap"` opts any control in. */
export const HAPTIC_PATTERNS = { tap: 8, confirm: [10, 30, 10], success: 18, warning: [30, 50, 30], failure: [40, 60, 40] } as const;

export const HAPTICS_RUNTIME_JS = String.raw`
var KURAMI_HAPTICS=${JSON.stringify(HAPTIC_PATTERNS)};
function kuramiHaptic(kind) {
  try {
    if(typeof navigator.vibrate!=='function'||!KURAMI_HAPTICS[kind])return false;
    if(!matchMedia('(pointer: coarse)').matches||matchMedia('(prefers-reduced-motion: reduce)').matches)return false;
    return navigator.vibrate(KURAMI_HAPTICS[kind]);
  } catch { return false; }
}
if(!window.kuramiHapticsInstalled){
  window.kuramiHapticsInstalled=true;
  document.addEventListener('click',event=>{
    const control=event.target instanceof Element?event.target.closest('.button--primary,[data-haptic]'):null;
    if(!control||control.closest('[data-haptic="off"]')||control.matches(':disabled,[aria-disabled="true"]'))return;
    kuramiHaptic(control.dataset.haptic||'tap');
  },{capture:true,passive:true});
}
`;
