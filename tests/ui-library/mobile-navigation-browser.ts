import assert from "node:assert/strict";
import {createServer} from "node:http";
import {setTimeout as delay} from "node:timers/promises";
import {mkdirSync,writeFileSync} from "node:fs";
import {THEME_CSS} from "../../src/ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../../src/ui-library/foundations/index.ts";
import {BUTTON_CSS,renderButton} from "../../src/ui-library/components/button.ts";
import {ICON_CSS} from "../../src/ui-library/components/icon.ts";
import {FORM_CSS,renderSearchField} from "../../src/ui-library/components/form.ts";
import {DIALOG_CSS,renderDialog} from "../../src/ui-library/components/dialog.ts";
import {TOAST_CSS} from "../../src/ui-library/components/toast.ts";
import {PROJECTS_STYLES} from "../../src/projects-site/styles.ts";
import {renderDocument} from "../../src/ui-library/patterns/page-shell.ts";
import {SITE_HEADER_CSS,renderSiteHeader} from "../../src/ui-library/patterns/site-header.ts";
import {MOBILE_NAVIGATION_CSS} from "../../src/ui-library/patterns/mobile-navigation.ts";
import {kuramiSites} from "../../src/ui-library/patterns/kurami-sites.ts";
import {THEME_RUNTIME_JS} from "../../src/ui-library/runtime/theme.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";

const server=createServer((request,response)=>{
  if(request.url==='/assets/theme.js'){response.setHeader('content-type','text/javascript');response.end(THEME_RUNTIME_JS);return;}
  const url=new URL(request.url!,'http://fixture.test'),[,lang,app]=url.pathname.split('/');
  if(!['en','ru'].includes(lang!)||!['hub','digest','projects','docs'].includes(app!)){response.writeHead(404).end();return;}
  const language=lang as 'en'|'ru',product=app as 'hub'|'digest'|'projects'|'docs';
  const title=product==='hub'?'Hub':product==='digest'?'Digest':product==='projects'?'Projects':'Docs';
  const anchors=Array.from({length:14},(_,index)=>`<a href="#section-${index}">Section ${index}</a>`).join('');
  const content=Array.from({length:14},(_,index)=>`<section style="min-height:450px"><h2 id="section-${index}">Section ${index}</h2><p>Invented navigation fixture.</p></section>`).join('');
  const header=renderSiteHeader({brand:{href:`/${lang}/${app}/`,ariaLabel:'Kurami '+title,foxSrc:'/assets/fox.png',suffix:title},nav:{label:'Sections',links:[{href:'#section-0',label:'Overview',current:'location'}]},sites:kuramiSites(product,language),actions:'',mobile:{app:product,lang:language}});
  const sources=product==='docs'?`<nav class="toc-mobile__list">${anchors}</nav><nav class="side-mobile__list"><a href="/${lang}/${app}/" aria-current="page">Overview</a></nav>`:product==='projects'?`<div class="projects-search">${renderSearchField({name:'q',label:'Search',value:'',placeholder:'Search'})}</div>`:'';
  const safe=url.searchParams.has('safe');
  const overlays=safe?renderDialog({id:'safe-dialog',title:'Safe dialog',body:content,closeLabel:'Close'})+'<aside class="projects-detail" id="safe-drawer" hidden><h2>Issue details</h2>'+content+'</aside><aside class="toast" id="safe-toast" hidden>Safe notification</aside>':'';
  response.setHeader('content-type','text/html');response.end(renderDocument({lang:language,title:'Synthetic mobile navigation',favicon:'/assets/fox.png',themeScript:true,skipLabel:'Skip',styles:{inline:THEME_CSS+FOUNDATION_CSS+BUTTON_CSS+ICON_CSS+FORM_CSS+SITE_HEADER_CSS+MOBILE_NAVIGATION_CSS+(safe?DIALOG_CSS+TOAST_CSS+(product==='projects'?PROJECTS_STYLES:''):'')},header,main:sources+renderButton({label:'Outside action',variant:'secondary',attributes:{id:'outside-action'}})+content,footer:'',after:overlays}));
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await launchBrowser(findBrowser()),{devtools}=browser;
async function wait(expression:string){for(let n=0;n<80;n++){if(await devtools.evaluate<boolean>(expression))return;await delay(25);}throw new Error('Navigation timeout: '+expression);}
async function click(key:string){await devtools.evaluate(`document.querySelector('[data-mobile-menu="${key}"]').click()`);await wait(`document.querySelector('#mobile-menu-${key}').matches(':popover-open')`);}
async function closed(){await wait(`!history.state?.__kuramiMobilePanel&&!document.querySelector('.mobile-navigation .ui-popover:popover-open')`);await delay(40);}
let states=0;
try{
  await devtools.call('Page.enable');
  await devtools.call('Network.enable');await devtools.call('Network.setBlockedURLs',{urls:['https://*']});
  for(const width of [320,390])for(const lang of ['en','ru'])for(const app of ['hub','digest','projects','docs']){
    await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});
    await devtools.call('Page.navigate',{url:`${base}/${lang}/${app}/`});
    await wait(`document.readyState==='complete'&&!!document.querySelector('[data-mobile-menu="apps"]')`);
    assert.equal(await devtools.evaluate(`(()=>{const bar=document.querySelector('.mobile-navigation__bar'),r=bar.getBoundingClientRect(),s=getComputedStyle(bar);return r.left>=11&&innerWidth-r.right>=11&&r.width<=360&&Math.abs(innerHeight-r.bottom-3)<1&&parseFloat(s.borderRadius)>=r.height/2&&[...bar.querySelectorAll('button')].every(button=>button.getBoundingClientRect().height>=44)&&Math.abs(parseFloat(document.body.style.getPropertyValue('--mobile-navigation-height'))-r.height-3)<1;})()`),true,'capsule keeps its side margins and smaller 3px bottom gap; reserved height follows the gap');
    assert.equal(await devtools.evaluate(`(()=>{const bar=document.querySelector('.mobile-navigation__bar'),s=getComputedStyle(bar);return getComputedStyle(bar.parentElement).opacity==='1'&&s.opacity==='1'&&s.backdropFilter==='blur(12px)'&&/(?:,\\s*|\\/\\s*)0\\.72\\)/.test(s.backgroundColor);})()`),true,'only the warm surface is slightly transparent; icons and text stay opaque');
    assert.equal(await devtools.evaluate(`(()=>{const bar=document.querySelector('.mobile-navigation__bar'),r=bar.getBoundingClientRect();return r.height===66&&r.width<=344&&[...bar.querySelectorAll('button')].every(button=>{const s=getComputedStyle(button),icon=button.querySelector('svg');return button.getBoundingClientRect().height===56&&s.fontSize===${JSON.stringify(width<=360?'12px':'13px')}&&s.fontWeight==='500'&&s.gap==='4px'&&icon.getBoundingClientRect().width===26&&getComputedStyle(icon).strokeWidth==='1.5px';});})()`),true,'compact dock keeps thinner 26px icons, responsive medium labels and comfortable 56px tap targets');
    await devtools.evaluate(`history.replaceState({preserved:'fixture',before:0},'');history.pushState({preserved:'fixture',before:1},'');window.routePops=0;addEventListener('popstate',()=>routePops++);window.panelLength=history.length;`);
    await click('apps');
    assert.equal(await devtools.evaluate(`(()=>{const button=document.querySelector('[data-mobile-menu="apps"]');return getComputedStyle(button,'::after').display==='none'&&getComputedStyle(button).color===getComputedStyle(button.querySelector('svg')).color&&parseFloat(getComputedStyle(button).borderRadius)>0;})()`),true,'open menu uses the rounded accent tile');
    assert.equal(await devtools.evaluate(`document.activeElement===document.querySelector('#mobile-menu-apps [aria-current]')`),true);
    assert.equal(await devtools.evaluate(`history.state.preserved`),'fixture');
    await click('more');
    assert.equal(await devtools.evaluate(`history.length`),await devtools.evaluate(`panelLength+1`),'switching replaces the one panel entry');
    await devtools.evaluate(`history.back()`);await closed();
    assert.equal(await devtools.evaluate(`routePops`),0,'panel Back is not a product route event');
    assert.equal(await devtools.evaluate(`history.state.before`),1);
    await devtools.evaluate(`history.forward()`);await wait(`document.querySelector('#mobile-menu-more').matches(':popover-open')`);
    await devtools.call('Page.reload');await wait(`document.readyState==='complete'&&document.querySelector('#mobile-menu-more')?.matches(':popover-open')`);
    await devtools.evaluate(`window.routePops=0;addEventListener('popstate',()=>routePops++);document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await closed();
    assert.equal(await devtools.evaluate(`document.activeElement.dataset.mobileMenu`),'more');
    await devtools.evaluate(`history.back()`);await wait(`history.state?.before===0`);
    assert.equal(await devtools.evaluate(`routePops`),1,'closed-panel Back stays normal');
    await click('apps');
    await devtools.evaluate(`dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))`);
    assert.equal(await devtools.evaluate(`document.querySelector('#mobile-menu-apps').matches(':popover-open')`),true,'persisted lifecycle restores panel');
    await devtools.evaluate(`document.querySelector('[data-mobile-close]').click()`);await closed();
    if(app!=='projects'){
      const key=app==='hub'?'sections':'contents';
      await devtools.evaluate(`document.getElementById('section-7').scrollIntoView({behavior:'instant',block:'start'})`);await delay(60);await click(key);
      assert.equal(await devtools.evaluate(`document.activeElement.getAttribute('href')`),'#section-7','current reading position receives focus');
      assert.equal(await devtools.evaluate(`document.activeElement.getBoundingClientRect().top>=document.querySelector('#mobile-menu-${key}').getBoundingClientRect().top`),true,'current row is revealed');
      await devtools.evaluate(`document.querySelector('#mobile-menu-${key} a[href="#section-10"]').click()`);await closed();
      await wait(`location.hash==='#section-10'&&document.activeElement.id==='section-10'`);await delay(1000);
      const destinationTop=await devtools.evaluate<number>(`document.getElementById('section-10').getBoundingClientRect().top`);
      assert.ok(destinationTop>=-1&&destinationTop<=32,`${app} ${lang} ${width}: destination top ${destinationTop}`);
      await devtools.evaluate(`document.getElementById('section-4').scrollIntoView({behavior:'instant',block:'start'})`);await delay(60);await click(key);
      assert.equal(await devtools.evaluate(`document.querySelector('#mobile-menu-${key} [aria-current]').getAttribute('href')`),'#section-4','reading follows scroll rather than the old hash');
      await devtools.evaluate(`history.back()`);await closed();
      // A real tap while the page reacts to pointerdown (chart tooltips hide themselves) still reaches the section.
      await devtools.evaluate(`(()=>{const tip=document.createElement('div');tip.hidden=true;document.querySelector('main').append(tip);addEventListener('pointerdown',()=>{tip.hidden=true;},true);scrollTo({top:0,behavior:'instant'});})()`);
      await click(key);await delay(60);
      const row=await devtools.evaluate<{x:number;y:number}>(`(()=>{const r=document.querySelector('#mobile-menu-${key} a[href="#section-3"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await devtools.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[row]});await delay(40);await devtools.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await closed();await wait(`location.hash==='#section-3'`);await delay(1000);
    }else{
      await click('search');assert.equal(await devtools.evaluate(`document.activeElement.name`),'q');
      await devtools.evaluate(`history.back()`);await closed();
    }
    await devtools.evaluate(`scrollTo({top:0,behavior:'instant'});document.querySelector('#outside-action').addEventListener('click',()=>document.body.dataset.outside='yes')`);
    await click('apps');
    const point=await devtools.evaluate<{x:number;y:number}>(`(()=>{const r=document.querySelector('#outside-action').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await devtools.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await devtools.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    await closed();await wait(`document.body.dataset.outside==='yes'`);
    await devtools.evaluate(`document.documentElement.style.fontSize='200%'`);await delay(100);
    assert.equal(await devtools.evaluate(`(()=>{const bar=document.querySelector('.mobile-navigation__bar');return bar.getBoundingClientRect().height>82&&document.documentElement.scrollWidth<=innerWidth&&Math.abs(parseFloat(document.body.style.getPropertyValue('--mobile-navigation-height'))-bar.getBoundingClientRect().height-3)<1})()`),true,'enlarged labels resize the dock and its reserved gap without overflow');
    await click('apps');
    await delay(240);
    assert.equal(await devtools.evaluate(`document.querySelector('#mobile-menu-apps').getBoundingClientRect().bottom<document.querySelector('.mobile-navigation__bar').getBoundingClientRect().top`),true);
    await devtools.evaluate(`history.back()`);await closed();
    await devtools.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await delay(50);
    const length=await devtools.evaluate<number>('history.length');await devtools.evaluate(`document.querySelector('[data-mobile-menu="apps"]').click()`);
    assert.equal(await devtools.evaluate('history.length'),length,'desktop never creates panel history');
    assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('[data-mobile-navigation]')).display==='none'&&!document.body.style.getPropertyValue('--mobile-navigation-height')`),true,'desktop hides the dock and removes mobile height reservations');
    states++;
  }
  await devtools.call('Page.navigate',{url:base+'/en/docs/'});await wait('document.readyState===\'complete\'');
  await devtools.evaluate(`(()=>{const toc=document.querySelector('.toc-mobile__list').cloneNode(true);toc.className='toc';toc.style.cssText='position:fixed;top:80px;right:10px';document.querySelector('main').append(toc);document.documentElement.style.scrollBehavior='auto';document.getElementById('section-4').scrollIntoView({behavior:'instant'});})()`);
  await wait(`document.querySelector('.toc [aria-current]').getAttribute('href')==='#section-4'`);
  await devtools.evaluate(`document.querySelector('.toc a[href="#section-7"]').click()`);
  await wait(`document.getElementById('section-7').dataset.anchorArrival==='true'`);
  await delay(1900);assert.equal(await devtools.evaluate(`document.querySelector('[data-anchor-arrival]')===null`),true,'arrival cue clears without persistent decoration');
  await devtools.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await devtools.evaluate(`document.querySelector('.toc a[href="#section-2"]').click()`);
  await wait(`document.querySelector('.toc [aria-current]').getAttribute('href')==='#section-2'`);
  await wait(`document.getElementById('section-2').dataset.anchorArrival==='true'`);
  assert.equal(await devtools.evaluate(`getComputedStyle(document.getElementById('section-2')).animationName`),'none','reduced-motion anchor cue has no CSS animation');
  // These are CSS inset emulations, not Android WebAPK or iOS system-bar tests.
  let safeStates=0;
  mkdirSync('/tmp/kurami-edge-to-edge',{recursive:true});
  for(const app of ['hub','digest','projects','docs'])for(const theme of ['light','dark']){
    await devtools.call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
    await devtools.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await devtools.call('Emulation.setSafeAreaInsetsOverride',{insets:{top:24,topMax:24,bottom:34,bottomMax:34,left:0,leftMax:0,right:0,rightMax:0}});
    await devtools.call('Page.navigate',{url:`${base}/ru/${app}/?safe`});
    await wait(`document.readyState==='complete'&&!!document.querySelector('[data-mobile-menu="apps"]')`);
    await devtools.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)};scrollTo({top:600,behavior:'instant'})`);await delay(100);
    assert.equal(await devtools.evaluate(`document.querySelector('meta[name="viewport"]').content`),'width=device-width, initial-scale=1, viewport-fit=cover');
    assert.equal(await devtools.evaluate(`getComputedStyle(document.documentElement).backgroundColor===getComputedStyle(document.body).backgroundColor`),true,'the root paints the active page theme through screen insets');
    const reservation=await devtools.evaluate<number>(`parseFloat(getComputedStyle(document.body).paddingBottom)`);
    const documentHeight=await devtools.evaluate<number>('document.documentElement.scrollHeight');
    const beforeScroll=await devtools.evaluate<number>('scrollY');
    for(const bottom of [34,16,0,34]){
      await devtools.call('Emulation.setSafeAreaInsetsOverride',{insets:{top:24,topMax:24,bottom,bottomMax:34,left:0,leftMax:0,right:0,rightMax:0}});await delay(30);
      assert.equal(await devtools.evaluate('parseFloat(getComputedStyle(document.body).paddingBottom)'),reservation,'maximum bottom inset keeps the page reservation stable');
      assert.equal(await devtools.evaluate('document.documentElement.scrollHeight'),documentHeight,'retracting browser bars do not relayout the page');
      assert.equal(await devtools.evaluate('scrollY'),beforeScroll,'bottom-inset changes do not move the reading position');
      assert.ok(Math.abs(await devtools.evaluate<number>(`innerHeight-document.querySelector('.mobile-navigation__bar').getBoundingClientRect().bottom`)-bottom-3)<1,'dock tracks the current safe bottom plus its smaller 3px floating gap');
    }
    await click('apps');await delay(240);
    assert.equal(await devtools.evaluate(`(()=>{const p=document.querySelector('#mobile-menu-apps').getBoundingClientRect(),b=document.querySelector('.mobile-navigation__bar').getBoundingClientRect();return p.top>=24&&p.bottom<b.top&&p.left>=12&&p.right<=innerWidth-12})()`),true,'menus stay within the safe screen above the dock');
    if(app==='hub'&&theme==='light'){
      const shot=await devtools.call<{data:string}>('Page.captureScreenshot',{format:'png'});
      writeFileSync('/tmp/kurami-edge-to-edge/hub-light-safe.png',Buffer.from(shot.data,'base64'));
    }
    await devtools.evaluate('history.back()');await closed();
    await devtools.evaluate(`document.querySelector('#safe-toast').hidden=false`);
    assert.equal(await devtools.evaluate(`document.querySelector('#safe-toast').getBoundingClientRect().bottom<document.querySelector('.mobile-navigation__bar').getBoundingClientRect().top`),true,'notification stays above the dock');
    await devtools.evaluate(`document.querySelector('#safe-toast').hidden=true;document.querySelector('#safe-dialog').showModal()`);
    assert.equal(await devtools.evaluate(`(()=>{const r=document.querySelector('#safe-dialog').getBoundingClientRect();return r.top>=24&&r.bottom<=innerHeight-34&&r.left>=12&&r.right<=innerWidth-12})()`),true,'tall modal respects both top and bottom protected areas');
    await devtools.evaluate(`document.querySelector('#safe-dialog').close()`);
    if(app==='projects'){
      await click('search');await delay(240);
      assert.ok(await devtools.evaluate<number>(`document.querySelector('#mobile-menu-search').getBoundingClientRect().top`)>=36,'search stays at the safe top, not beneath the keyboard');
      await devtools.call('Emulation.setDeviceMetricsOverride',{width:390,height:420,deviceScaleFactor:1,mobile:true});await delay(150);
      assert.equal(await devtools.evaluate(`(()=>{const r=document.querySelector('#mobile-menu-search').getBoundingClientRect();return r.top>=24&&r.bottom<=visualViewport.offsetTop+visualViewport.height-34})()`),true,'search fits the reduced visible viewport');
      await devtools.evaluate('history.back()');await closed();
      await devtools.call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
      await devtools.evaluate(`document.querySelector('#safe-drawer').hidden=false`);
      assert.equal(await devtools.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('#safe-drawer'));return parseFloat(s.paddingTop)===40&&parseFloat(s.paddingBottom)===50})()`),true,'full-screen issue drawer keeps safe top and stable bottom padding');
      await devtools.evaluate(`document.querySelector('#safe-drawer').hidden=true`);
    }
    await devtools.call('Emulation.setSafeAreaInsetsOverride',{insets:{top:59,topMax:59,bottom:21,bottomMax:34,left:20,leftMax:20,right:8,rightMax:8}});await delay(50);
    await click('apps');await delay(240);
    assert.equal(await devtools.evaluate(`(()=>{const b=document.querySelector('.mobile-navigation__bar').getBoundingClientRect(),p=document.querySelector('#mobile-menu-apps').getBoundingClientRect();return b.left>=32&&b.right<=innerWidth-20&&p.left>=32&&p.right<=innerWidth-20&&p.top>=59&&document.documentElement.scrollWidth<=innerWidth})()`),true,'asymmetric notch insets preserve safe margins without horizontal overflow');
    await devtools.evaluate('history.back()');await closed();
    safeStates++;
  }
  await devtools.call('Emulation.setSafeAreaInsetsOverride',{insets:{top:24,bottom:34,left:0,right:0}});
  assert.ok(await devtools.evaluate<number>('parseFloat(getComputedStyle(document.body).paddingBottom)')>=112,'older browsers without maximum inset fall back to the current inset');
  await devtools.call('Emulation.setSafeAreaInsetsOverride',{insets:{}});
  console.log(`Edge-to-edge: ${safeStates} shared-shell, light/dark fixtures verify live safe insets, stable scroll, notches, menus, modal, toast, drawer and keyboard-sized search; native browser/PWA system bars still require a physical phone; screenshot in /tmp/kurami-edge-to-edge`);
  console.log(`Mobile navigation: ${states} EN/RU fixtures verify reading/focus, Back/Forward/reload, preserved route state, persisted lifecycle, outside actions, large text and unchanged desktop history; desktop reading and transient/reduced-motion anchor cues verified`);
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
