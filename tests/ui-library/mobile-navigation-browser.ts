import assert from "node:assert/strict";
import {createServer} from "node:http";
import {setTimeout as delay} from "node:timers/promises";
import {THEME_CSS} from "../../src/ui-library/themes/index.ts";
import {FOUNDATION_CSS} from "../../src/ui-library/foundations/index.ts";
import {BUTTON_CSS,renderButton} from "../../src/ui-library/components/button.ts";
import {ICON_CSS} from "../../src/ui-library/components/icon.ts";
import {FORM_CSS,renderSearchField} from "../../src/ui-library/components/form.ts";
import {renderDocument} from "../../src/ui-library/patterns/page-shell.ts";
import {SITE_HEADER_CSS,renderSiteHeader} from "../../src/ui-library/patterns/site-header.ts";
import {MOBILE_NAVIGATION_CSS} from "../../src/ui-library/patterns/mobile-navigation.ts";
import {kuramiSites} from "../../src/ui-library/patterns/kurami-sites.ts";
import {THEME_RUNTIME_JS} from "../../src/ui-library/runtime/theme.ts";
import {findBrowser,launchBrowser} from "../../src/ui-library/testing/devtools.ts";

const server=createServer((request,response)=>{
  if(request.url==='/assets/theme.js'){response.setHeader('content-type','text/javascript');response.end(THEME_RUNTIME_JS);return;}
  const [,lang,app]=new URL(request.url!,'http://fixture.test').pathname.split('/');
  if(!['en','ru'].includes(lang!)||!['hub','digest','projects','docs'].includes(app!)){response.writeHead(404).end();return;}
  const language=lang as 'en'|'ru',product=app as 'hub'|'digest'|'projects'|'docs';
  const title=product==='hub'?'Hub':product==='digest'?'Digest':product==='projects'?'Projects':'Docs';
  const anchors=Array.from({length:14},(_,index)=>`<a href="#section-${index}">Section ${index}</a>`).join('');
  const content=Array.from({length:14},(_,index)=>`<section style="min-height:450px"><h2 id="section-${index}">Section ${index}</h2><p>Invented navigation fixture.</p></section>`).join('');
  const header=renderSiteHeader({brand:{href:`/${lang}/${app}/`,ariaLabel:'Kurami '+title,foxSrc:'/assets/fox.png',suffix:title},nav:{label:'Sections',links:[{href:'#section-0',label:'Overview',current:'location'}]},sites:kuramiSites(product,language),actions:'',mobile:{app:product,lang:language}});
  const sources=product==='docs'?`<nav class="toc-mobile__list">${anchors}</nav><nav class="side-mobile__list"><a href="/${lang}/${app}/" aria-current="page">Overview</a></nav>`:product==='projects'?`<div class="projects-search">${renderSearchField({name:'q',label:'Search',value:'',placeholder:'Search'})}</div>`:'';
  response.setHeader('content-type','text/html');response.end(renderDocument({lang:language,title:'Synthetic mobile navigation',favicon:'/assets/fox.png',themeScript:true,skipLabel:'Skip',styles:{inline:THEME_CSS+FOUNDATION_CSS+BUTTON_CSS+ICON_CSS+FORM_CSS+SITE_HEADER_CSS+MOBILE_NAVIGATION_CSS},header,main:sources+renderButton({label:'Outside action',variant:'secondary',attributes:{id:'outside-action'}})+content,footer:''}));
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
    await devtools.evaluate(`history.replaceState({preserved:'fixture',before:0},'');history.pushState({preserved:'fixture',before:1},'');window.routePops=0;addEventListener('popstate',()=>routePops++);window.panelLength=history.length;`);
    await click('apps');
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
    assert.equal(await devtools.evaluate(`(()=>{const bar=document.querySelector('.mobile-navigation__bar');return bar.getBoundingClientRect().height>82&&document.documentElement.scrollWidth<=innerWidth&&Math.abs(parseFloat(document.body.style.getPropertyValue('--mobile-navigation-height'))-bar.getBoundingClientRect().height)<1})()`),true,'enlarged labels resize the bar without overflow');
    await click('apps');
    await delay(240);
    assert.equal(await devtools.evaluate(`document.querySelector('#mobile-menu-apps').getBoundingClientRect().bottom<document.querySelector('.mobile-navigation__bar').getBoundingClientRect().top`),true);
    await devtools.evaluate(`history.back()`);await closed();
    await devtools.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await delay(50);
    const length=await devtools.evaluate<number>('history.length');await devtools.evaluate(`document.querySelector('[data-mobile-menu="apps"]').click()`);
    assert.equal(await devtools.evaluate('history.length'),length,'desktop never creates panel history');
    states++;
  }
  console.log(`Mobile navigation: ${states} EN/RU fixtures verify reading/focus, Back/Forward/reload, preserved route state, persisted lifecycle, outside actions, large text and unchanged desktop history`);
}finally{await browser.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
