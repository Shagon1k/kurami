// Generated from src/ui-library by `npm run ui:export`. Do not edit; change the library instead.

function createKuramiToast(region, returnFocus) {
  const message=region.querySelector('[data-toast-message]');
  const dismiss=region.querySelector('[data-toast-dismiss]');
  let timer=null, remaining=0, started=0, hovered=false;
  function pause() {
    if(timer!==null){clearTimeout(timer);timer=null;remaining=Math.max(0,remaining-(performance.now()-started));}
  }
  function resume() {
    pause();
    if(region.hidden || hovered || document.hidden || region.contains(document.activeElement) || remaining<=0)return;
    started=performance.now();timer=setTimeout(hide,remaining);
  }
  function hide() {
    const restore=region.contains(document.activeElement);
    pause();region.hidden=true;remaining=0;message.textContent='';
    if(restore){const target=returnFocus?.();if(target?.isConnected&&!target.inert)target.focus({preventScroll:true});}
  }
  function show(text,options={}) {
    const tone=['info','success','warning','failure'].includes(options.tone)?options.tone:'info';
    if(!region.hidden && message.textContent===String(text) && region.dataset.tone===tone)return;
    pause();
    region.dataset.tone=tone;
    for(const icon of region.querySelectorAll('[data-toast-icon]'))icon.hidden=icon.dataset.toastIcon!==tone;
    region.hidden=false;message.textContent=String(text);
    remaining=options.duration??(['warning','failure'].includes(tone)?0:8000);
    if(tone!=='info')globalThis.kuramiHaptic?.(tone);
    resume();
  }
  dismiss.addEventListener('click',hide);
  region.addEventListener('pointerenter',()=>{hovered=true;pause();});
  region.addEventListener('pointerleave',()=>{hovered=false;resume();});
  region.addEventListener('focusin',pause);
  region.addEventListener('focusout',()=>queueMicrotask(resume));
  document.addEventListener('visibilitychange',()=>document.hidden?pause():resume());
  return {show,hide};
}
