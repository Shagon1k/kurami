// Generated from src/ui-library by `npm run ui:export`. Do not edit; change the library instead.
(function kuramiThemeRuntime() {
  const root = document.documentElement, key = "kurami-theme", media = matchMedia("(prefers-color-scheme: dark)");
  const stored = () => { try { const value = localStorage.getItem(key); return value === "dark" || value === "light" ? value : null; } catch { return null; } };
  const apply = (theme                  ) => {
    root.dataset.theme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.setAttribute("aria-pressed", String(theme === "dark"));
      const icon = button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = theme === "dark" ? "☀" : "◐";
    }
    const surface = getComputedStyle(root).getPropertyValue("--surface-page").trim();
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface);
  };
  apply(stored() ?? (media.matches ? "dark" : "light"));
  media.addEventListener("change", event => { if (!stored()) apply(event.matches ? "dark" : "light"); });
  document.addEventListener("DOMContentLoaded", () => apply(root.dataset.theme === "dark" ? "dark" : "light"));
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-theme-toggle]")) return;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(key, next); } catch {}
    apply(next);
  });
  const menus = () => document.querySelectorAll                    (".site-switcher[open],.site-menu[open],.side-mobile[open]");
  document.addEventListener("pointerdown", event => {
    if (!(event.target instanceof Node)) return;
    for (const menu of menus()) if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    for (const menu of menus()) { menu.open = false; menu.querySelector("summary")?.focus({preventScroll:true}); }
  });
  document.addEventListener("click", event => {
    if (!(event.target instanceof Element)) return;
    for (const menu of menus()) if (!menu.contains(event.target) || event.target.closest("a[href]")) menu.open = false;
  });
})();
(function mobileNavigationRuntime(phoneWidth       ) {
  document.addEventListener('DOMContentLoaded',()=>{
    const found=document.querySelector             ('[data-mobile-navigation]');if(!found)return;const shell            =found;
    const header=shell.closest('header') ,media=matchMedia(`(max-width: ${phoneWidth}px)`);
    const app=shell.dataset.mobileNavigation,ru=document.documentElement.lang==='ru';
    const moves                                             =[];
    let active                 =null,opener                       =null;
    const panels=[...shell.querySelectorAll             ('.ui-popover')];
    const opened=(panel            )=>panel.matches(':popover-open')||panel.classList.contains('is-open');
    function close(focus=false){
      if(active){if(active.matches(':popover-open'))active.hidePopover();active.classList.remove('is-open');}
      shell.querySelectorAll('[data-mobile-menu]').forEach(button=>button.setAttribute('aria-expanded','false'));active=null;
      if(focus)opener?.focus({preventScroll:true});
    }
    function move(selector       ,key       ){
      const node=document.querySelector(selector),slot=shell.querySelector(`[data-mobile-slot="${key}"]`);if(!node||!slot)return;
      const anchor=document.createComment('mobile navigation source');node.before(anchor);moves.push({node,anchor,slot});
    }
    header.querySelectorAll('.site-actions > .button,.site-actions > button').forEach(node=>{
      if(node.matches('[data-hub-control]'))return;
      const slot=shell.querySelector('[data-mobile-slot="more"]') ,anchor=document.createComment('mobile setting');node.before(anchor);moves.push({node,anchor,slot});
    });
    if(app==='hub'){move('#hub-controls-popover .controls-menu','controls');if(!moves.some(item=>item.slot.getAttribute('data-mobile-slot')==='controls'))shell.querySelector                   ('[data-mobile-menu="controls"]') .disabled=true;}
    if(app==='projects')move('.projects-search','search');
    if(app==='docs'){move('.side-mobile__list','sections');move('.toc-mobile__list','contents');}
    function fillContents(){
      const slot=shell.querySelector('[data-mobile-slot="contents"]');if(!slot||slot.querySelector('.toc-mobile__list'))return;
      slot.replaceChildren();
      const headings=[...document.querySelectorAll             ('main h2')].filter(heading=>heading.textContent?.trim()&&heading.getClientRects().length&&!heading.closest('dialog,.ui-popover,[hidden]'));
      for(const [index,heading] of headings.entries()){
        if(!heading.id)heading.id=`mobile-section-${index+1}`;
        const link=document.createElement('a');link.className='mobile-navigation__anchor';link.href=`#${heading.id}`;link.textContent=heading.textContent;slot.append(link);
      }
      if(!headings.length){const note=document.createElement('p');note.textContent=ru?'На этой странице нет разделов.':'No sections on this page.';slot.append(note);}
    }
    function adapt(){
      close();for(const item of moves)if(media.matches)item.slot.append(item.node);else item.anchor.after(item.node);
      if(!media.matches)for(const panel of panels)panel.classList.remove('is-open');
    }
    for(const panel of panels)panel.addEventListener('toggle',()=>{if(!opened(panel)&&active===panel)close();});
    shell.addEventListener('click',event=>{
      const target=event.target instanceof Element?event.target:null;if(!target)return;
      const trigger=target.closest                   ('[data-mobile-menu]');
      if(trigger){
        const panel=document.getElementById(trigger.getAttribute('aria-controls') ) ;
        if(opened(panel)){close();return;}close();
        if(trigger.dataset.mobileMenu==='contents'||app==='hub'&&trigger.dataset.mobileMenu==='sections'){
          if(app==='hub'){const nav=panel.querySelector('nav') ;nav.replaceChildren();for(const heading of document.querySelectorAll             ('#hub-dashboard h2[id]')){const link=document.createElement('a');link.className='site-nav__link';link.href=`#${heading.id}`;link.textContent=heading.textContent;nav.append(link);}}
          else fillContents();
        }
        active=panel;opener=trigger;trigger.setAttribute('aria-expanded','true');
        if(typeof panel.showPopover==='function')panel.showPopover();else panel.classList.add('is-open');
        (panel.querySelector             ('input:not([type="hidden"])')??panel.querySelector             ('a[href],button')??panel).focus({preventScroll:true});return;
      }
      if(target.closest('[data-mobile-close]'))close(true);
      else if(target.closest('a[href],[data-hub-control]'))close();
    });
    document.addEventListener('pointerdown',event=>{if(active&&event.target instanceof Node&&!active.contains(event.target)&&!opener?.contains(event.target))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active){event.preventDefault();close(true);}});
    document.addEventListener('submit',event=>{if(active?.contains(event.target        ))close();});
    addEventListener('resize',()=>{if(!media.matches)close();});media.addEventListener('change',adapt);adapt();
  });
})(620);
