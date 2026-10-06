// Generated from src/ui-library by `npm run ui:export`. Do not edit; change the library instead.
(function kuramiThemeRuntime(choices              ) {
  const root = document.documentElement, modeKey = "kurami-theme", themeKey = "kurami-theme-name", media = matchMedia("(prefers-color-scheme: dark)");
  const known = (theme                           )                  => !!theme && Object.hasOwn(choices.modes, theme);
  const read = (key        ) => { try { return localStorage.getItem(key); } catch { return null; } };
  const write = (key        , value               ) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {} };
  const storedMode = ()                   => { const value = read(modeKey); return value === "dark" || value === "light" ? value : null; };
  const storedTheme = () => { const value = read(themeKey); return known(value) ? value : null; };
  const hubDefault = () => {
    const match = /(?:^|;\s*)kurami-theme-default=([a-z]+)\.(light|dark)(?:;|$)/.exec(document.cookie);
    return match && known(match[1]) ? { theme: match[1], mode: match[2]              } : null;
  };
  const effective = () => {
    const fallback = hubDefault(), theme = storedTheme() ?? fallback?.theme ?? "paper";
    const modes = choices.modes[theme];
    let mode = storedMode() ?? fallback?.mode ?? (media.matches ? "dark" : "light");
    if (!modes.includes(mode)) mode = modes[0];
    return { theme, mode };
  };
  const apply = () => {
    const { theme, mode } = effective(), device = storedTheme(), fallback = hubDefault();
    root.dataset.theme = mode;
    if (theme === "paper") delete root.dataset.kuramiTheme; else root.dataset.kuramiTheme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      // A menu trigger exposes expanded state; a legacy toggle (saved Digest editions) exposes the mode.
      if (!button.hasAttribute("aria-haspopup")) button.setAttribute("aria-pressed", String(mode === "dark"));
      else (button               ).dataset.themeMode = mode;
      const icon = button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = mode === "dark" ? "☀" : "◐";
    }
    for (const option of document.querySelectorAll                   ("[data-theme-choice]")) {
      const value = option.dataset.themeChoice;
      option.setAttribute("aria-pressed", String(value === "default" ? !device : value === device));
    }
    for (const option of document.querySelectorAll                   ("[data-mode-choice]")) {
      const value = option.dataset.modeChoice             ;
      option.setAttribute("aria-pressed", String(value === mode));
      option.disabled = !choices.modes[theme].includes(value);
    }
    for (const label of document.querySelectorAll("[data-theme-default-label]")) label.textContent = choices.labels[fallback?.theme ?? "paper"];
    const surface = getComputedStyle(root).getPropertyValue("--surface-page").trim();
    if (surface) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", surface);
  };
  const place = (panel             ) => {
    const trigger = document.querySelector             (`[popovertarget="${panel.id}"]`);
    if (!trigger || panel.closest("[data-mobile-slot]")) return;
    const rect = trigger.getBoundingClientRect(), width = panel.offsetWidth || 248;
    panel.style.setProperty("--popover-top", `${Math.round(rect.bottom + 8)}px`);
    panel.style.setProperty("--popover-left", `${Math.round(Math.max(8, Math.min(rect.right - width, innerWidth - width - 8)))}px`);
  };
  apply();
  media.addEventListener("change", () => apply());
  addEventListener("storage", event => { if (event.key === modeKey || event.key === themeKey) apply(); });
  document.addEventListener("DOMContentLoaded", apply);
  document.addEventListener("toggle", event => {
    const panel = event.target;
    if (!(panel instanceof HTMLElement) || !panel.matches("[data-theme-panel]")) return;
    const open = (event               ).newState === "open";
    document.querySelector(`[popovertarget="${panel.id}"]`)?.setAttribute("aria-expanded", String(open));
    if (open) place(panel);
  }, true);
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const themeOption = target?.closest             ("[data-theme-choice]"), modeOption = target?.closest                   ("[data-mode-choice]");
    if (themeOption) {
      const value = themeOption.dataset.themeChoice ;
      if (value === "default") { write(themeKey, null); write(modeKey, null); }
      else if (known(value)) { const mode = effective().mode; write(themeKey, value); if (!storedMode()) write(modeKey, mode); }
      apply();
      return;
    }
    if (modeOption && !modeOption.disabled) {
      if (!storedTheme()) write(themeKey, effective().theme);
      write(modeKey, modeOption.dataset.modeChoice );
      apply();
      return;
    }
    const toggle = target?.closest("[data-theme-toggle]");
    if (!toggle || toggle.hasAttribute("aria-haspopup")) return;
    // Legacy toggle: switch the mode; a dark-only theme switches to Paper light.
    const next            = root.dataset.theme === "dark" ? "light" : "dark";
    if (!choices.modes[effective().theme].includes(next)) write(themeKey, "paper");
    write(modeKey, next);
    apply();
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
})({"labels":{"paper":"Paper","neon":"Neon"},"modes":{"paper":["light","dark"],"neon":["dark"]}});
(function mobileNavigationRuntime(phoneWidth       ) {
  document.addEventListener('DOMContentLoaded',()=>{
    const found=document.querySelector             ('[data-mobile-navigation]');if(!found)return;const shell            =found;
    const header=shell.closest('header') ,media=matchMedia(`(max-width: ${phoneWidth}px)`);
    const app=shell.dataset.mobileNavigation,ru=document.documentElement.lang==='ru';
    const moves                                             =[];
    const panels=[...shell.querySelectorAll             ('.ui-popover')];
    const historyKey='__kuramiMobilePanel';
    let active                 =null,opener                       =null;
    let entry               =null,pending=false,afterClose                =null,replaying=false,readingFrame=0;
    let scrollMode                       =null;
    const menuEntry=()               =>{
      const value=history.state?.[historyKey];
      return value&&typeof value.key==='string'&&typeof value.token==='string'&&typeof value.baseUrl==='string'&&(value.currentUrl??value.baseUrl)===location.href?value:null;
    };
    const opened=(panel            )=>panel.matches(':popover-open')||panel.classList.contains('is-open');
    const readingPanel=()=>app==='projects'?null:document.getElementById(app==='hub'?'mobile-menu-sections':'mobile-menu-contents');
    const headingFor=(link                  )                 =>{
      try{const url=new URL(link.href);return url.origin===location.origin&&url.pathname===location.pathname&&url.search===location.search&&url.hash?document.getElementById(decodeURIComponent(url.hash.slice(1))):null;}catch{return null;}
    };
    function viewport(){
      const visible=window.visualViewport;
      shell.style.setProperty('--mobile-search-top',`${(visible?.offsetTop??0)+12}px`);
      shell.style.setProperty('--mobile-search-height',`${visible?.height??innerHeight}px`);
      const bar=shell.querySelector             ('.mobile-navigation__bar') ;
      if(media.matches){const height=bar.getBoundingClientRect().height+parseFloat(getComputedStyle(shell).getPropertyValue('--mobile-navigation-gap')||'0');for(const node of [document.body,document.documentElement])node.style.setProperty('--mobile-navigation-height',`${height}px`);}
      else for(const node of [document.body,document.documentElement])node.style.removeProperty('--mobile-navigation-height');
    }
    function links(){
      for(const link of shell.querySelectorAll                   ('.ui-popover a[href]:not(.button)'))link.classList.add('mobile-navigation__link');
    }
    function fillContents(){
      if(!media.matches)return;
      const panel=readingPanel();if(!panel)return;
      const slot=app==='hub'?panel.querySelector('nav'):panel.querySelector('[data-mobile-slot="contents"]');
      if(!slot||slot.querySelector('.toc-mobile__list'))return;
      slot.replaceChildren();
      const headings=[...document.querySelectorAll             ('main h2')].filter(heading=>heading.textContent?.trim()&&heading.getClientRects().length&&!heading.closest('dialog,.ui-popover,[hidden]'));
      for(const [index,heading] of headings.entries()){
        if(!heading.id)heading.id=`mobile-section-${index+1}`;
        const link=document.createElement('a');link.className='mobile-navigation__anchor';link.href=`#${heading.id}`;link.textContent=heading.textContent;slot.append(link);
      }
      if(!headings.length){const note=document.createElement('p');note.textContent=ru?'На этой странице нет разделов.':'No sections on this page.';slot.append(note);}
      links();
    }
    function reading(){
      readingFrame=0;if(!media.matches)return;
      const anchors=[...readingPanel()?.querySelectorAll                   ('a[href]')??[]];
      const targets=anchors.map(link=>({link,heading:headingFor(link)})).filter(item=>item.heading?.getClientRects().length&&!item.heading.closest('[hidden],dialog'));
      if(!targets.length)return;
      const line=Math.min(120,innerHeight*.2);
      let current=targets[0] ;
      for(const item of targets)if(item.heading .getBoundingClientRect().top<=line)current=item;
      if(scrollY>0&&scrollY+innerHeight>=document.documentElement.scrollHeight-2)current=targets.at(-1) ;
      for(const link of anchors)if(link===current.link)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
    }
    function scheduleReading(){if(!readingFrame)readingFrame=requestAnimationFrame(reading);}
    function closeUi(focus=false){
      const old=active;active=null;
      if(old){old.querySelector                  ('input:focus')?.blur();if(old.matches(':popover-open'))old.hidePopover();old.classList.remove('is-open');}
      shell.querySelectorAll('[data-mobile-menu]').forEach(button=>button.setAttribute('aria-expanded','false'));
      if(focus)opener?.focus({preventScroll:true});
    }
    function close(focus=false,action          ){
      closeUi(focus);
      if(pending){if(action)afterClose=action;return;}
      if(entry&&menuEntry()?.token===entry.token){pending=true;afterClose=action??null;history.back();}
      else{entry=null;action?.();}
    }
    function open(trigger                  ,record=true,focus=true){
      if(!media.matches||trigger.disabled)return;
      if(pending){afterClose=()=>open(trigger,record,focus);return;}
      closeUi();fillContents();links();reading();viewport();
      const panel=document.getElementById(trigger.getAttribute('aria-controls') ) ;
      if(record){
        if(scrollMode===null)scrollMode=history.scrollRestoration;
        history.scrollRestoration='manual';
        const owned=entry&&menuEntry()?.token===entry.token;
        const next={key:trigger.dataset.mobileMenu ,token:owned?entry .token:crypto.randomUUID(),baseUrl:owned?entry .baseUrl:location.href,currentUrl:location.href};
        const state={...(history.state&&typeof history.state==='object'?history.state:{}),[historyKey]:next};
        if(owned)history.replaceState(state,'');else history.pushState(state,'');
        entry=next;
      }
      active=panel;opener=trigger;trigger.setAttribute('aria-expanded','true');
      if(typeof panel.showPopover==='function')panel.showPopover();else panel.classList.add('is-open');
      const current=panel.querySelector             ('a[aria-current]:not([aria-current="false"])');
      if(current){const row=current.getBoundingClientRect(),bounds=panel.getBoundingClientRect();panel.scrollTop+=row.top-bounds.top-(panel.clientHeight-row.height)/2;}
      if(focus)(panel.querySelector             ('input:not([type="hidden"])')??current??panel.querySelector             ('a[href],[data-hub-control]:not(:disabled),select:not(:disabled),button:not([data-mobile-close]):not(:disabled)')??panel.querySelector             ('[data-mobile-close]'))?.focus({preventScroll:true});
    }
    function restore(){
      const stored=menuEntry();entry=stored;
      const trigger=stored?[...shell.querySelectorAll                   ('[data-mobile-menu]')].find(button=>button.dataset.mobileMenu===stored.key):null;
      if(stored&&scrollMode===null){scrollMode='auto';history.scrollRestoration='manual';}
      if(trigger&&media.matches)open(trigger,false,false);else closeUi();
    }
    // Projects installs its handler before DOMContentLoaded, so it delegates panel events here.
    const handled=new WeakSet       ();
    const handleHistory=(event              )        =>{
      if(handled.has(event))return true;
      const stored=menuEntry();
      if(entry&&(location.href===entry.baseUrl||location.href===entry.currentUrl)){
        handled.add(event);event.stopImmediatePropagation();
        const action=afterClose;afterClose=null;pending=false;
        if(stored){entry=stored;restore();}else{
          if(entry.currentUrl&&entry.currentUrl!==location.href)history.replaceState(history.state,'',entry.currentUrl);
          entry=null;closeUi(!action);
          requestAnimationFrame(()=>{if(!entry&&scrollMode!==null){history.scrollRestoration=scrollMode;scrollMode=null;}action?.();});
        }
        return true;
      }
      pending=false;afterClose=null;entry=stored;
      if(stored){handled.add(event);event.stopImmediatePropagation();restore();}else closeUi();
      if(!stored)requestAnimationFrame(()=>{if(!entry&&scrollMode!==null){history.scrollRestoration=scrollMode;scrollMode=null;}});
      return Boolean(stored);
    };
    (window                                                                      ).kuramiMobilePanelPopState=handleHistory;
    addEventListener('popstate',handleHistory,true);
    shell.addEventListener('input',()=>queueMicrotask(()=>{
      if(active&&entry&&history.state?.[historyKey]?.token===entry.token){
        entry={...entry,currentUrl:location.href};history.replaceState({...history.state,[historyKey]:entry},'');
      }
    }));
    function move(selector       ,key       ){
      const node=document.querySelector(selector),slot=shell.querySelector(`[data-mobile-slot="${key}"]`);if(!node||!slot)return;
      const anchor=document.createComment('mobile navigation source');node.before(anchor);moves.push({node,anchor,slot});
    }
    header.querySelectorAll('.site-actions > .button,.site-actions > button,.site-actions > [data-theme-menu]').forEach(node=>{
      if(node.matches('[data-hub-control]'))return;
      const key=node.matches('[data-theme-toggle],[data-theme-menu]')?'theme':node.matches('a[hreflang]')?'language':null;if(!key)return;
      const slot=shell.querySelector(`[data-mobile-slot="${key}"]`) ,anchor=document.createComment('mobile setting');node.before(anchor);moves.push({node,anchor,slot});
    });
    if(app==='hub'){move('#hub-controls-popover .controls-menu','controls');if(!moves.some(item=>item.slot.getAttribute('data-mobile-slot')==='controls'))shell.querySelector                   ('[data-mobile-menu="controls"]') .disabled=true;}
    if(app==='projects')move('.projects-search','search');
    if(app==='docs'){move('.side-mobile__list','sections');move('.toc-mobile__list','contents');}
    function adapt(){
      if(!media.matches)close();
      for(const item of moves)if(media.matches)item.slot.append(item.node);else item.anchor.after(item.node);
      header.querySelectorAll('[data-theme-toggle]:not([aria-haspopup])').forEach(button=>button.classList.toggle('button--switch',media.matches));
      // In the settings sheet the theme menu shows its options inline instead of as a popover.
      shell.querySelectorAll             ('[data-mobile-slot="theme"] [data-theme-panel]').forEach(panel=>{panel.hidePopover?.();panel.removeAttribute('popover');});
      header.querySelectorAll             ('.site-actions [data-theme-panel]:not([popover])').forEach(panel=>panel.setAttribute('popover','auto'));
      header.querySelectorAll('[data-hub-control]').forEach(button=>button.classList.toggle('mobile-navigation__action',media.matches));
      const periodRow=shell.querySelector             ('[data-mobile-period-row]');if(periodRow)periodRow.hidden=!periodRow.querySelector('[data-floating-period]');
      fillContents();links();reading();viewport();
      if(!media.matches)for(const panel of panels)panel.classList.remove('is-open');
    }
    for(const panel of panels)panel.addEventListener('toggle',()=>{if(!opened(panel)&&active===panel)close();});
    shell.addEventListener('click',event=>{
      if(replaying)return;
      const target=event.target instanceof Element?event.target:null;if(!target)return;
      const trigger=target.closest                   ('[data-mobile-menu]');
      if(trigger){if(active?.id===trigger.getAttribute('aria-controls'))close();else open(trigger);return;}
      if(target.closest('[data-mobile-close]')){close(true);return;}
      const link=target.closest                   ('a[href]'),control=target.closest             ('[data-hub-control]');
      if(!active||(!link&&!control))return;
      if(link&&(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button||link.target==='_blank')){close();return;}
      event.preventDefault();event.stopImmediatePropagation();
      const destination=link&&readingPanel()?.contains(link)?headingFor(link):null;
      close(false,()=>{
        if(destination){
          const temporary=!destination.hasAttribute('tabindex');if(temporary){destination.tabIndex=-1;destination.addEventListener('blur',()=>destination.removeAttribute('tabindex'),{once:true});}
          history.pushState(history.state,'',link .href);destination.focus({preventScroll:true});
          destination.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});scheduleReading();
          document.dispatchEvent(new CustomEvent('kurami:anchor-arrival',{detail:destination.id}));
        }else{replaying=true;try{(link??control) .click();}finally{replaying=false;}}
      });
    },true);
    document.addEventListener('pointerdown',event=>{if(active&&event.target instanceof Node&&!shell.contains(event.target)&&!active.contains(event.target))close();});
    document.addEventListener('click',event=>{
      if(replaying||!pending||!(event.target instanceof Element)||shell.contains(event.target)||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const target=event.target.closest             ('a[href],button,tr,[role="button"]');
      if(!target||target instanceof HTMLAnchorElement&&target.target==='_blank')return;
      event.preventDefault();event.stopImmediatePropagation();
      afterClose=()=>{replaying=true;try{target.click();}finally{replaying=false;}};
    },true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&active){event.preventDefault();event.stopImmediatePropagation();close(true);}},true);
    document.addEventListener('submit',event=>{
      if(!active?.contains(event.target        ))return;
      event.preventDefault();event.stopImmediatePropagation();const form=event.target                   ,submitter=(event               ).submitter;
      close(false,()=>form.requestSubmit(submitter instanceof HTMLButtonElement||submitter instanceof HTMLInputElement?submitter:undefined));
    },true);
    addEventListener('scroll',scheduleReading,{passive:true});addEventListener('hashchange',scheduleReading);
    addEventListener('resize',()=>{viewport();scheduleReading();if(!media.matches)close();});
    addEventListener('pagehide',()=>closeUi());
    addEventListener('pageshow',event=>{if(event.persisted){pending=false;afterClose=null;adapt();restore();}});
    window.visualViewport?.addEventListener('resize',viewport);window.visualViewport?.addEventListener('scroll',viewport);
    new ResizeObserver(viewport).observe(shell.querySelector('.mobile-navigation__bar') );
    const main=document.querySelector('main');if(main)new MutationObserver(()=>{if(media.matches){fillContents();scheduleReading();}}).observe(main,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});
    media.addEventListener('change',adapt);adapt();restore();
  });
})(620);

(function kuramiReadingRuntime(){
  const mount=()=>{
    let frame=0,arrival                 =null,clearTimer                                        ;
    function destination(href       ){
      try{const url=new URL(href,location.href);return url.origin===location.origin&&url.pathname===location.pathname&&url.search===location.search&&url.hash?document.getElementById(decodeURIComponent(url.hash.slice(1))):null;}catch{return null;}
    }
    function highlight(target                 ){
      const heading=target?.matches('h1,h2,h3,h4')?target:target?.querySelector             ('h1,h2,h3,h4');
      if(!heading||!heading.closest('main')||!heading.getClientRects().length)return;
      if(arrival===heading)return;
      if(arrival)delete arrival.dataset.anchorArrival;clearTimeout(clearTimer);arrival=heading;heading.dataset.anchorArrival='true';
      clearTimer=setTimeout(()=>{if(arrival)delete arrival.dataset.anchorArrival;arrival=null;},1800);
    }
    function reading(){
      frame=0;
      const nav=document.querySelector('.toc');if(!nav||!nav.getClientRects().length)return;
      const links=[...nav.querySelectorAll                   ('a[href]')];
      const targets=links.map(link=>({link,heading:destination(link.href)})).filter(item=>item.heading?.getClientRects().length);
      if(!targets.length)return;
      let current=targets[0] ;for(const item of targets)if(item.heading .getBoundingClientRect().top<=Math.min(160,innerHeight*.25))current=item;
      if(scrollY>0&&scrollY+innerHeight>=document.documentElement.scrollHeight-2)current=targets.at(-1) ;
      for(const link of links)if(link===current.link)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(reading);};
    addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);
    document.addEventListener('click',event=>{
      if(!(event.target instanceof Element)||event.button||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const link=event.target.closest                   ('a[href]');if(!link||link.target==='_blank'||link.hasAttribute('download')||link.closest('.mobile-navigation'))return;
      const target=destination(link.href);if(target)setTimeout(()=>{if(!event.defaultPrevented)highlight(target);},350);
    });
    document.addEventListener('kurami:anchor-arrival',event=>highlight(document.getElementById((event                       ).detail)));
    addEventListener('hashchange',()=>{highlight(destination(location.href));schedule();});
    addEventListener('pageshow',schedule);
    const main=document.querySelector('main');if(main)new MutationObserver(schedule).observe(main,{childList:true,subtree:true});
    reading();if(location.hash)highlight(destination(location.href));
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();