// Generated from src/ui-library by `npm run ui:export`. Do not edit; change the library instead.
(function kuramiThemeRuntime(choices              ) {
  const root = document.documentElement, modeKey = "kurami-theme", themeKey = "kurami-theme-name", media = matchMedia("(prefers-color-scheme: dark)");
  const known = (theme                           )                  => !!theme && Object.hasOwn(choices.modes, theme);
  // Choices used to persist per device; they now last one session, so drop any that are left.
  try { localStorage.removeItem(modeKey); localStorage.removeItem(themeKey); } catch {}
  const read = (key        ) => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const write = (key        , value        ) => { try { sessionStorage.setItem(key, value); } catch {} };
  const sessionTheme = () => { const value = read(themeKey); return known(value) ? value : null; };
  const sessionMode = ()                   => { const value = read(modeKey); return value === "dark" || value === "light" ? value : null; };
  const hubDefault = () => {
    const match = /(?:^|;\s*)kurami-theme-default=([a-z]+)\.(light|dark)(?:;|$)/.exec(document.cookie);
    return match && known(match[1]) ? { theme: match[1], mode: match[2]              } : null;
  };
  const defaults = () => hubDefault() ?? { theme: "paper", mode: (media.matches ? "dark" : "light")              };
  /** The mode a theme opens in: Paper keeps the current mode; a variant takes the default's mode when it is the default, otherwise its first mode (Neon: dark). */
  const openingMode = (theme        )            => {
    const base = defaults();
    if (theme === "paper") return root.dataset.theme === "dark" ? "dark" : "light";
    return theme === base.theme ? base.mode : choices.modes[theme][0];
  };
  const effective = () => {
    const theme = sessionTheme() ?? defaults().theme, modes = choices.modes[theme];
    let mode = sessionMode() ?? (sessionTheme() ? openingMode(theme) : defaults().mode);
    if (!modes.includes(mode)) mode = modes[0];
    return { theme, mode };
  };
  const apply = () => {
    const { theme, mode } = effective();
    root.dataset.theme = mode;
    if (theme === "paper") delete root.dataset.kuramiTheme; else root.dataset.kuramiTheme = theme;
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      // A menu trigger exposes expanded state; a legacy toggle (saved Digest editions) exposes the mode.
      if (!button.hasAttribute("aria-haspopup")) button.setAttribute("aria-pressed", String(mode === "dark"));
      else (button               ).dataset.themeMode = mode;
      // Only the legacy toggle of saved editions swaps a glyph; the menu trigger keeps its palette icon.
      const icon = button.hasAttribute("aria-haspopup") ? null : button.querySelector("[data-theme-icon]");
      if (icon) icon.textContent = mode === "dark" ? "☀" : "◐";
    }
    for (const option of document.querySelectorAll                   ("[data-theme-choice]")) option.setAttribute("aria-pressed", String(option.dataset.themeChoice === theme));
    for (const option of document.querySelectorAll                   ("[data-mode-choice]")) {
      const value = option.dataset.modeChoice             ;
      option.setAttribute("aria-pressed", String(value === mode));
      option.disabled = !choices.modes[theme].includes(value);
    }
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
  // Hub calls this after changing the default (cookie): the session override ends and the page shows the new default.
  (window                                                ).kuramiThemeRefresh = () => {
    try { sessionStorage.removeItem(modeKey); sessionStorage.removeItem(themeKey); } catch {}
    apply();
  };
  media.addEventListener("change", () => apply());
  document.addEventListener("DOMContentLoaded", apply);
  document.addEventListener("toggle", event => {
    const panel = event.target;
    if (!(panel instanceof HTMLElement) || !panel.matches("[data-theme-panel]")) return;
    const open = (event               ).newState === "open";
    document.querySelector(`[popovertarget="${panel.id}"]`)?.setAttribute("aria-expanded", String(open));
    if (open) place(panel);
  }, true);
  // Info tips: the "i" button is the note's popover invoker, so a click opens and closes it and a click
  // elsewhere or Escape closes it (light dismiss). A fine pointer also previews it on hover; a click on a
  // hovered note keeps it open. The note is placed below its button, or above it near the bottom edge.
  const noteOf = (info                ) => info ? document.getElementById(info.getAttribute("aria-controls") ?? "") : null;
  const infoOf = (note         ) => document.querySelector             (`[data-ui-info][aria-controls="${note.id}"]`);
  const placeNote = (info             , note             ) => {
    const rect = info.getBoundingClientRect(), width = note.offsetWidth, height = note.offsetHeight, gap = 8;
    const below = rect.bottom + gap, top = below + height > innerHeight - gap && rect.top - gap - height > gap ? rect.top - gap - height : below;
    note.style.setProperty("--info-top", `${Math.round(top)}px`);
    note.style.setProperty("--info-left", `${Math.round(Math.min(Math.max(gap, rect.left + rect.width / 2 - width / 2), innerWidth - width - gap))}px`);
  };
  document.addEventListener("toggle", event => {
    const note = event.target               ;
    if (!note.classList?.contains("ui-info-note")) return;
    const info = infoOf(note), open = note.matches(":popover-open");
    if (!info) return;
    info.setAttribute("aria-expanded", String(open));
    if (open) placeNote(info, note); else delete info.dataset.hovered;
  }, true);
  document.addEventListener("click", event => {
    const info = event.target instanceof Element ? event.target.closest             ("[data-ui-info]") : null;
    // A click on a note opened by hover keeps it open instead of toggling it shut.
    if (info?.dataset.hovered !== undefined && noteOf(info)?.matches(":popover-open")) { event.preventDefault(); delete info.dataset.hovered; }
  });
  const hover = matchMedia("(hover: hover) and (pointer: fine)");
  document.addEventListener("pointerover", event => {
    const info = hover.matches && event.target instanceof Element ? event.target.closest             ("[data-ui-info]") : null;
    const note = noteOf(info);
    if (!info || !note || note.matches(":popover-open") || typeof note.showPopover !== "function") return;
    info.dataset.hovered = ""; note.showPopover();
  });
  document.addEventListener("pointerout", event => {
    const info = event.target instanceof Element ? event.target.closest             ("[data-ui-info]") : null;
    if (info?.dataset.hovered === undefined || info.contains(event.relatedTarget               )) return;
    noteOf(info)?.hidePopover();
  });
  document.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const themeOption = target?.closest             ("[data-theme-choice]"), modeOption = target?.closest                   ("[data-mode-choice]");
    if (themeOption && known(themeOption.dataset.themeChoice)) {
      const theme = themeOption.dataset.themeChoice;
      write(themeKey, theme); write(modeKey, openingMode(theme));
      apply();
      return;
    }
    if (modeOption && !modeOption.disabled) {
      write(themeKey, effective().theme); write(modeKey, modeOption.dataset.modeChoice );
      apply();
      return;
    }
    const toggle = target?.closest("[data-theme-toggle]");
    if (!toggle || toggle.hasAttribute("aria-haspopup")) return;
    // Legacy toggle: switch the mode for this session; a theme without that mode switches to Paper.
    const next            = root.dataset.theme === "dark" ? "light" : "dark", theme = effective().theme;
    write(themeKey, choices.modes[theme].includes(next) ? theme : "paper"); write(modeKey, next);
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
})({"modes":{"paper":["light","dark"],"neon":["dark","light"]}});
(function kuramiNeonMotion() {
  const root = document.documentElement, reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const active = () => root.dataset.kuramiTheme === "neon" && !reduce.matches;
  const countUp = (element         ) => {
    const text = element.textContent ?? "", match = /^(\D*?)(\d+(?:[.,]\d+)?)(.*)$/s.exec(text);
    if (!match || element.children.length) return;
    const [, prefix, number, suffix] = match, separator = number.includes(",") ? "," : ".", decimals = (number.split(/[.,]/)[1] ?? "").length;
    const end = Number(number.replace(",", ".")), start = performance.now(), duration = 900;
    if (!Number.isFinite(end) || end === 0) return;
    const step = (now        ) => {
      const t = Math.min((now - start) / duration, 1), value = end * (1 - Math.pow(1 - t, 3));
      element.textContent = prefix + value.toFixed(decimals).replace(".", separator) + suffix;
      if (t < 1) requestAnimationFrame(step); else element.textContent = text;
    };
    requestAnimationFrame(step);
  };
  const app = (path        ) => /^\/(?:ru|en)\/(digest|projects|docs)(?:\/|$)/.exec(path)?.[1] ?? "hub";
  document.addEventListener("pointerdown", event => {
    if (!active() || !(event.target instanceof Element)) return;
    const button = event.target.closest             (".button:not(:disabled):not([aria-busy=\"true\"])");
    if (!button) return;
    const rect = button.getBoundingClientRect(), layer = document.createElement("span"), ring = document.createElement("span");
    layer.className = "ui-ripple"; layer.setAttribute("aria-hidden", "true");
    ring.style.left = `${event.clientX - rect.left}px`; ring.style.top = `${event.clientY - rect.top}px`;
    // Large enough to reach the far corner of the button.
    ring.style.setProperty("--ripple-scale", String(Math.ceil(Math.hypot(rect.width, rect.height) / 6)));
    layer.append(ring); button.append(layer);
    ring.addEventListener("animationend", () => layer.remove(), { once: true });
    setTimeout(() => layer.remove(), 800);
  }, { passive: true });
  // A figure is known by its card: the metric key or the stat label. Clocks tick on their own and never flash.
  const figures = (live         ) => {
    const found = new Map                 ();
    for (const figure of live.querySelectorAll(".stat-card__value, [data-ui-figure]")) {
      if (figure.closest("[data-live-clock]") || figure.matches("[data-live-clock]")) continue;
      const card = figure.closest("[data-metric], .stat-card, .metric-card");
      const key = card?.getAttribute("data-metric") ?? card?.querySelector(".stat-card__label, .metric-card__label")?.textContent?.trim();
      if (key && !found.has(key)) found.set(key, figure);
    }
    return found;
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (!active()) return;
    document.querySelectorAll(".stat-card__value, [data-ui-count]").forEach(countUp);
    try {
      const from = document.referrer ? new URL(document.referrer) : null;
      if (from && from.origin === location.origin && app(from.pathname) !== app(location.pathname)) document.querySelector(".site-brand__name")?.classList.add("ui-glitch");
    } catch {}
    const regions = [...document.querySelectorAll("[data-ui-live]")], known = new Map                              ();
    const remember = (live         ) => known.set(live, new Map([...figures(live)].map(([key, figure]) => [key, figure.textContent ?? ""])));
    let frame = 0;
    const compare = () => {
      frame = 0;
      for (const live of regions) {
        const before = known.get(live), now = figures(live);
        if (before && active()) for (const [key, figure] of now) {
          const previous = before.get(key);
          if (previous === undefined || previous === figure.textContent) continue;
          figure.classList.remove("ui-figure-blip"); void (figure               ).offsetWidth; figure.classList.add("ui-figure-blip");
          setTimeout(() => figure.classList.remove("ui-figure-blip"), 1000);
        }
        remember(live);
      }
    };
    const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(compare); });
    // Start after the count-up, so the page's own first animation is not mistaken for a refresh.
    setTimeout(() => { for (const live of regions) { remember(live); observer.observe(live, { childList: true, subtree: true, characterData: true }); } }, 1000);
  });
})();
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
      const headings=[...document.querySelectorAll             ('main h2')].filter(heading=>heading.textContent?.trim()&&heading.getClientRects().length&&!heading.closest('dialog,.ui-popover,[hidden]'));
      for(const [index,heading] of headings.entries())if(!heading.id)heading.id=`mobile-section-${index+1}`;
      // Rebuild only when the sections changed: a rebuild under a finger detaches the link being tapped.
      const current=[...slot.querySelectorAll                   ('a.mobile-navigation__anchor')].map(link=>`${link.getAttribute('href')}\n${link.textContent}`);
      if(headings.length&&current.join('\n')===headings.map(heading=>`#${heading.id}\n${heading.textContent}`).join('\n'))return;
      slot.replaceChildren();
      for(const heading of headings){
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
    document.addEventListener('pointerdown',event=>{if(active&&event.target instanceof Node&&event.target.isConnected&&!shell.contains(event.target)&&!active.contains(event.target))close();});
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
(()=>{
  const moment=(function brandMoment(date      )                                          {
  const month = date.getMonth() + 1, day = `${String(month).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return day === "08-16" ? "birthday" : month === 12 || month === 1 ? "winter" : month === 10 ? "autumn" : null;
})(new Date());
  if(moment)document.documentElement.dataset.brandMoment=moment;
  let taps=[];
  document.addEventListener('click',event=>{
    const fox=event.target instanceof Element?event.target.closest('.site-brand__fox'):null;
    const brand=fox?.closest('a.site-brand');
    if(!brand||new URL(brand.href,location.href).pathname!==location.pathname)return;
    event.preventDefault();
    const now=Date.now();taps=[...taps.filter(at=>now-at<2000),now];
    if(taps.length<5)return;
    taps=[];brand.classList.remove('ui-sneeze');void brand.offsetWidth;brand.classList.add('ui-sneeze');
    brand.querySelector('.site-brand__name')?.classList.add('ui-glitch');
    setTimeout(()=>{brand.classList.remove('ui-sneeze');brand.querySelector('.site-brand__name')?.classList.remove('ui-glitch');},900);
  });
})();
document.documentElement.dataset.kuramiMascot=/(?:^|;\s*)kurami-mascot=off(?:;|$)/.test(document.cookie)?"off":"on";
(()=>{
  if(!matchMedia('(display-mode: standalone)').matches||!matchMedia('(pointer: coarse)').matches)return;
  const ru=document.documentElement.lang==='ru',trigger=80,limit=120;
  const src=typeof kuramiAppUrl==='function'?kuramiAppUrl('/assets/kurami-peek.webp'):'/assets/kurami-peek.webp';
  let startY=null,pull=0,panel=null,busy=false;
  const show=()=>{panel=document.createElement('div');panel.className='kurami-pull';panel.setAttribute('aria-hidden','true');
    panel.innerHTML='<img src="'+src+'" width="96" height="96" alt=""><span></span>';document.body.append(panel);};
  const text=()=>panel.querySelector('span').textContent=pull>=trigger?(ru?'Отпусти, чтобы обновить':'Release to refresh'):(ru?'Потяни ещё':'Keep pulling');
  const reset=()=>{panel?.remove();panel=null;pull=0;startY=null;};
  addEventListener('touchstart',event=>{
    if(busy||scrollY>0||event.touches.length!==1||event.target.closest('dialog[open],[popover],input,textarea,select,[data-no-pull]'))return;
    startY=event.touches[0].clientY;
  },{passive:true});
  addEventListener('touchmove',event=>{
    if(startY===null)return;
    const distance=event.touches[0].clientY-startY;
    if(distance<=0||scrollY>0){if(panel)reset();return;}
    pull=Math.min(limit,distance*.5);if(!panel)show();
    panel.style.setProperty('--pull',pull+'px');panel.classList.toggle('is-ready',pull>=trigger);text();
  },{passive:true});
  addEventListener('touchend',async()=>{
    if(!panel||pull<trigger){reset();return;}
    busy=true;panel.classList.add('is-refreshing');panel.querySelector('span').textContent=ru?'Обновляю…':'Refreshing…';
    try{if(typeof window.kuramiRefresh==='function')await window.kuramiRefresh();else{location.reload();return;}}finally{busy=false;reset();}
  });
})();(()=>{
  const active=new Map(),requested=new Set(),slots=new Map(),bound=new WeakSet(),prefix='kurami-voice:',ttl=43200000;
  function apply(){
    for(const scene of document.querySelectorAll('[data-kurami-presence]')){
      if(bound.has(scene))continue;
      bound.add(scene);
      const key=scene.dataset.kuramiPresence,lang=document.documentElement.lang==='ru'?'ru':'en',target=scene.querySelector('[data-kurami-speech]');if(!target)continue;
      let bank;try{bank=JSON.parse(scene.dataset.kuramiVoiceLines);}catch{bank=[target.textContent];}
      if(!active.has(key)){
        try{const saved=JSON.parse(localStorage.getItem(prefix+key)||'null'),age=Date.now()-saved?.at;if(saved?.lang===lang&&age>=0&&age<ttl&&Array.isArray(saved.lines)&&saved.lines.length>=2&&saved.lines.length<=4&&saved.lines.every(line=>typeof line==='string'&&line.length>=12&&line.length<=220&&!/[<>]/.test(line)))bank=saved.lines;}catch{}
        const index=Math.floor(Math.random()*bank.length);active.set(key,bank[index]||target.textContent);
      }
      target.textContent=active.get(key);
      const mood=scene.querySelector('[data-kurami-mood]')?.dataset.kuramiMood,slot=scene.parentElement?.id||scene.className;
      if(slots.has(slot)&&slots.get(slot)!==mood)scene.dataset.kuramiReact='true';slots.set(slot,mood);
      if(!/^[a-f0-9]{64}$/.test(key)||requested.has(key))continue;requested.add(key);
      fetch('/_apps/hub/api/portal-voice?key='+key+'&lang='+lang,{cache:'no-store',signal:AbortSignal.timeout(5000)}).then(response=>response.ok?response.json():null).then(value=>{
        if(value?.key!==key||value.lang!==lang||!Array.isArray(value.lines)||value.lines.length<2||value.lines.length>4||!value.lines.every(line=>typeof line==='string'&&line.length>=12&&line.length<=220&&!/[<>]/.test(line)))return;
        try{localStorage.setItem(prefix+key,JSON.stringify({lang,at:Date.now(),lines:value.lines}));const keys=Object.keys(localStorage).filter(item=>item.startsWith(prefix));if(keys.length>40)keys.slice(0,keys.length-40).forEach(item=>localStorage.removeItem(item));}catch{}
      }).catch(()=>{});
    }
  }
  const start=()=>{apply();if(typeof MutationObserver!=='undefined'&&document.body)new MutationObserver(apply).observe(document.body,{childList:true,subtree:true});};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();