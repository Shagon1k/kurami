// Joint Digest + Docs browser regression. Checks the theme runtime, then audits every Docs route and
// every Digest page fixture in light/dark at phone and desktop widths (accessibility and component
// inventory), and screenshots a representative set, optionally compared with a baseline run.
// Audit options: --screens-only --viewports --widths=320,390,768,1280
// Usage: node src/ui-library/testing/visual-regression.ts --out=<dir> [--compare=<baseline dir>] [--themes=light,neon|all] [/absolute/path/to/chromium]
// Manual review: --out=<dir> --serve=<port> serves the fixture site on loopback without running checks.
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {createServer} from "node:http";
import {tmpdir} from "node:os";
import {isAbsolute,join,resolve,sep} from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {findBrowser,launchBrowser} from "./devtools.ts";
import {librarySubsite,libraryToast,syntheticDaily,syntheticHub,syntheticInvestmentReview,syntheticLegacyCinema,syntheticStocksEmpty,syntheticWeeklyEmpty,syntheticProjects} from "./fixtures.ts";
import {syntheticCharts} from "./charts.ts";
import {auditPoster,syntheticDailyFilled,syntheticCinemaFilled,syntheticWeeklyFilled,syntheticStocksFilled} from "./digest-filled.ts";
import {syntheticStocksDiscovery,syntheticRetainedCinema,syntheticHubUnavailable,syntheticHubLong} from "./audit-states.ts";
import {withDigestLanguage} from "../../briefing/i18n.ts";
import {injectSiteNavigation,type SiteSection} from "../../briefing/ui/components/site-header.ts";
import {PROJECTS_STYLES} from "../../projects-site/styles.ts";
import {HUB_CLIENT_JS} from "../../hub/assets.ts";
import {HUB_STYLES} from "../../hub/styles.ts";
import {changedShare,decodePng} from "./png.ts";
import {AUDIT_EXPRESSION,CONTRAST_REVIEW_EXPRESSION,inventoryExpression} from "./audit.ts";
import {checkImageBackedContrast} from "./contrast-pixels.ts";
import {pages as docsPages} from "../../human-docs/content.ts";
import {injectRuntime,createBriefingServer} from "../../briefing/server.ts";
import {briefingPaths} from "../../briefing/store.ts";
import {WEB_CLIENT_JS} from "../../web/presentation.ts";
import {TOAST_RUNTIME_JS} from "../runtime/toast.ts";
import type {Devtools} from "./devtools.ts";

const root=resolve(import.meta.dirname,"../../..");
const brandAssets=resolve(root,"src/ui-library/assets/brand");
const requestedWidths=process.argv.find(arg=>arg.startsWith("--widths="))?.slice(9);
const widths=requestedWidths?requestedWidths.split(",").map(Number):[390,1280];
if(widths.some(width=>!Number.isInteger(width)||width<320||width>2560)||!widths.length)throw new Error("Invalid audit widths");
// Every theme in one variant by default — Paper light and Neon dark; --themes=all adds Paper dark and Neon light.
const allThemes=["light","dark","neon","neon-light"] as const;
const requestedThemes=process.argv.find(arg=>arg.startsWith("--themes="))?.slice(9);
const themes=(requestedThemes==="all"?[...allThemes]:requestedThemes?requestedThemes.split(","):["light","neon"]) as (typeof allThemes)[number][];
if(!themes.length||themes.some(theme=>!(allThemes as readonly string[]).includes(theme)))throw new Error(`Unknown theme; use ${allThemes.join(",")} or all`);
// Screenshots: a representative set. The audit covers these plus every Docs route in both languages.
const availablePages:Record<string,string>={
  "digest-daily":"/digest/daily.html",
  "digest-daily-en":"/digest/daily-en.html",
  "digest-daily-filled":"/digest/daily-filled.html",
  "digest-daily-filled-en":"/digest/daily-filled-en.html",
  "digest-cinema-filled":"/digest/cinema.html",
  "digest-cinema-filled-en":"/digest/cinema-en.html",
  "digest-weekly-filled":"/digest/weekly-filled.html",
  "digest-weekly-filled-en":"/digest/weekly-filled-en.html",
  "digest-weekly-partial":"/digest/weekly-partial.html",
  "digest-stocks-filled":"/digest/stocks-filled.html",
  "digest-stocks-filled-en":"/digest/stocks-filled-en.html",
  "digest-stocks-expanded":"/digest/stocks-expanded.html",
  "digest-stocks-empty":"/digest/stocks.html",
  "digest-weekly-empty":"/digest/weekly.html",
  "digest-investment-review":"/digest/review.html",
  "digest-stocks-discovery":"/digest/stocks-discovery.html",
  "digest-stocks-discovery-en":"/digest/stocks-discovery-en.html",
  "digest-stocks-discovery-failed":"/digest/stocks-discovery-failed.html",
  "digest-stocks-discovery-partial-en":"/digest/stocks-discovery-partial-en.html",
  "digest-cinema-retained":"/digest/cinema-retained.html",
  "digest-cinema-retained-en":"/digest/cinema-retained-en.html",
  "library-charts":"/lab/charts.html",
  "library-charts-en":"/lab/charts-en.html",
  "library-subsite":"/lab/index.html",
  "library-toast":"/lab/toast.html",
  "hub-home":"/hub/index.html",
  "hub-home-en":"/hub/en.html",
  "hub-unavailable":"/hub/unavailable.html",
  "hub-unavailable-en":"/hub/unavailable-en.html",
  "hub-long":"/hub/long.html",
  "hub-long-en":"/hub/long-en.html",
  "projects-home":"/projects/index.html",
  "projects-home-ru":"/projects/ru.html",
  "docs-home-en":"/en/",
  "docs-overview-ru":"/ru/what-is-kurami/",
  "docs-reference-table-en":"/en/data-stores/",
  "docs-run-diagram-ru":"/ru/run-lifecycle/",
  "docs-changelog-en":"/en/changelog/",
};
// --pages=a,b (or KURAMI_UI_PAGES, set by `npm run test:changed`) limits the screenshot pages.
const requestedPages=(process.argv.find(arg=>arg.startsWith("--pages="))?.slice(8)??process.env.KURAMI_UI_PAGES)?.split(",").filter(Boolean);
if(requestedPages?.some(name=>!Object.hasOwn(availablePages,name)))throw new Error("Unknown screenshot page");
const pages=requestedPages?Object.fromEntries(requestedPages.map(name=>[name,availablePages[name]!])):availablePages;
const types:Record<string,string>={html:"text/html; charset=utf-8",css:"text/css",js:"text/javascript",svg:"image/svg+xml",png:"image/png",webp:"image/webp",woff2:"font/woff2"};

async function site():Promise<string> {
  execFileSync(process.execPath,[resolve(root,"src/human-docs/build.ts"),"--preview"],{cwd:root,stdio:"ignore"});
  const served=mkdtempSync(join(tmpdir(),"kurami-ui-site-"));
  cpSync(resolve(root,"dist/human-docs"),served,{recursive:true});
  // Docs cite the source commit; pin it so screenshots compare across commits.
  const head=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  for(const entry of readdirSync(served,{recursive:true,encoding:"utf8"}))if(entry.endsWith(".html")){
    const path=join(served,entry);
    writeFileSync(path,readFileSync(path,"utf8").replaceAll(head,"0".repeat(40)).replaceAll(head.slice(0,12),"0".repeat(12)).replaceAll(head.slice(0,7),"0".repeat(7)));
  }
  mkdirSync(join(served,"digest"),{recursive:true});
  const digestPage=(html:string,section:SiteSection,lang:"en"|"ru"="ru")=>withDigestLanguage(lang,()=>injectRuntime(injectSiteNavigation(html,[{section:"daily"},{section:"cinema"},{section:"weekly"},{section:"stocks"}],section)));
  // Digest pages pass through the same serve-time injection as production.
  writeFileSync(join(served,"digest/daily.html"),digestPage(syntheticDaily(),"daily"));
  writeFileSync(join(served,"digest/daily-en.html"),withDigestLanguage("en",()=>digestPage(syntheticDaily(),"daily","en")));
  const localLogos=(html:string)=>html.replaceAll("https://cdn.tickerlogos.com/audit-loaded.org","/media/audit-logo.svg").replaceAll("https://cdn.tickerlogos.com/audit-failed.org","/media/audit-logo-missing.svg");
  for(const lang of ["ru","en"] as const){
    const suffix=lang==="en"?"-en":"";
    writeFileSync(join(served,`digest/daily-filled${suffix}.html`),digestPage(syntheticDailyFilled(lang),"daily",lang));
    writeFileSync(join(served,`digest/cinema${suffix}.html`),digestPage(syntheticCinemaFilled(lang),"cinema",lang));
    writeFileSync(join(served,`digest/weekly-filled${suffix}.html`),digestPage(syntheticWeeklyFilled(lang),"weekly",lang));
    writeFileSync(join(served,`digest/stocks-filled${suffix}.html`),digestPage(syntheticStocksFilled(lang),"stocks",lang));
    writeFileSync(join(served,`digest/stocks-discovery${suffix}.html`),digestPage(localLogos(syntheticStocksDiscovery(lang)),"stocks",lang));
    writeFileSync(join(served,`digest/cinema-retained${suffix}.html`),digestPage(syntheticRetainedCinema(lang),"cinema",lang));
  }
  writeFileSync(join(served,"digest/stocks-discovery-failed.html"),digestPage(localLogos(syntheticStocksDiscovery("ru","failed")),"stocks"));
  writeFileSync(join(served,"digest/stocks-discovery-partial-en.html"),digestPage(localLogos(syntheticStocksDiscovery("en","partial")),"stocks","en"));
  writeFileSync(join(served,"digest/weekly-partial.html"),digestPage(syntheticWeeklyFilled("ru",true),"weekly"));
  writeFileSync(join(served,"digest/stocks-expanded.html"),digestPage(syntheticStocksFilled("ru",true),"stocks"));
  const runtimeHome=mkdtempSync(join(tmpdir(),"kurami-ui-digest-runtime-"));
  const digest=await createBriefingServer(briefingPaths({KURAMI_HOME:runtimeHome,BRIEFING_MIGRATIONS_DIR:join(root,"migrations/briefing")}),{mailActionExecutor:null});
  try{
    await new Promise<void>(done=>digest.listen(0,"127.0.0.1",done));
    const response=await fetch(`http://127.0.0.1:${(digest.address() as {port:number}).port}/assets/briefing.js`);
    if(!response.ok)throw new Error("Fixture Digest runtime failed to load");
    writeFileSync(join(served,"assets/briefing.js"),await response.text());
    const profile=await fetch(`http://127.0.0.1:${(digest.address() as {port:number}).port}/api/profile/interests`);
    if(!profile.ok)throw new Error("Fixture interest profile failed to load");
    writeFileSync(join(served,"fixture-profile.json"),await profile.text());
  }finally{await new Promise<void>(done=>digest.close(()=>done()));rmSync(runtimeHome,{recursive:true,force:true});}
  mkdirSync(join(served,"media/cinema/2026-09-19"),{recursive:true});
  writeFileSync(join(served,"media/cinema/2026-09-19/audit-poster.svg"),auditPoster);
  writeFileSync(join(served,"media/audit-logo.svg"),auditPoster);
  cpSync(join(brandAssets,"kurami-fox-header.webp"),join(served,"media/audit-illustration.webp"));
  writeFileSync(join(served,"digest/cinema-legacy.html"),injectRuntime(syntheticLegacyCinema()));
  writeFileSync(join(served,"digest/stocks.html"),injectRuntime(syntheticStocksEmpty()));
  writeFileSync(join(served,"digest/weekly.html"),injectRuntime(syntheticWeeklyEmpty()));
  // The standalone trial already embeds its theme/learning runtime; server injection would
  // register a second theme click listener and falsely report broken keyboard activation.
  writeFileSync(join(served,"digest/review.html"),syntheticInvestmentReview());
  mkdirSync(join(served,"lab"),{recursive:true});
  writeFileSync(join(served,"lab/index.html"),librarySubsite());
  writeFileSync(join(served,"lab/toast.html"),libraryToast());
  writeFileSync(join(served,"lab/charts.html"),syntheticCharts());
  writeFileSync(join(served,"lab/charts-en.html"),syntheticCharts("en"));
  mkdirSync(join(served,"hub"),{recursive:true});
  writeFileSync(join(served,"hub/index.html"),syntheticHub());
  writeFileSync(join(served,"hub/en.html"),syntheticHub("en"));
  for(const lang of ["en","ru"] as const){
    const suffix=lang==="en"?"-en":"";
    writeFileSync(join(served,`hub/unavailable${suffix}.html`),syntheticHubUnavailable(lang));
    writeFileSync(join(served,`hub/long${suffix}.html`),syntheticHubLong(lang));
  }
  writeFileSync(join(served,"assets/hub.css"),HUB_STYLES);
  mkdirSync(join(served,"projects"),{recursive:true});
  writeFileSync(join(served,"projects/index.html"),syntheticProjects());
  writeFileSync(join(served,"projects/ru.html"),syntheticProjects("ru"));
  writeFileSync(join(served,"assets/projects.css"),PROJECTS_STYLES);
  writeFileSync(join(served,"assets/projects.js"),WEB_CLIENT_JS+TOAST_RUNTIME_JS+readFileSync(join(root,"src/projects-site/client.js"),"utf8"));
  writeFileSync(join(served,"assets/hub.js"),HUB_CLIENT_JS);
  cpSync(join(brandAssets,"kurami-fox-header.webp"),join(served,"assets/kurami-fox.webp"));
  cpSync(join(brandAssets,"kurami-fox-header.webp"),join(served,"assets/kurami-fox-header.webp"));
  cpSync(join(brandAssets,"kurami-favicon.svg"),join(served,"favicon.svg"));
  return served;
}

async function open(devtools:Devtools,url:string):Promise<void> {
  await devtools.call("Page.navigate",{url});
  await devtools.evaluate(`new Promise(done=>document.readyState==='complete'?done():addEventListener('load',done,{once:true}))`);
}

/** Keyboard activation of existing read-only controls, without form submission or writes. */
async function checkKeyboard(devtools:Devtools):Promise<{theme:boolean;disclosure:boolean;apps:boolean}> {
  await devtools.call("Page.bringToFront");
  await devtools.call("Emulation.setFocusEmulationEnabled",{enabled:true});
  const enter=async()=>{
    const key={key:"Enter",code:"Enter",windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:"\r",unmodifiedText:"\r"};
    await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",...key});
    await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",...key});
    await delay(60);
  };
  const theme=await devtools.evaluate<string>(`document.documentElement.dataset.theme`);
  const escape=async()=>{const key={key:"Escape",code:"Escape",windowsVirtualKeyCode:27,nativeVirtualKeyCode:27};await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",...key});await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",...key});await delay(60);};
  await devtools.evaluate(`(()=>{const button=document.querySelector('[data-mobile-menu="more"]');if(button&&button.getBoundingClientRect().height)button.click();})()`);
  // Desktop: the header button opens the theme menu; phone: the settings sheet shows the options inline.
  const inline=await devtools.evaluate<boolean>(`!document.querySelector('[data-theme-panel]')?.hasAttribute('popover')`);
  if(!inline){
    await devtools.evaluate(`document.querySelector('[data-theme-toggle]').focus()`);
    await enter();
    if(!await devtools.evaluate<boolean>(`document.querySelector('[data-theme-panel]').matches(':popover-open')`))throw new Error("Keyboard theme menu did not open on "+await devtools.evaluate("location.pathname"));
  }
  const pick=async()=>{await devtools.evaluate(`document.querySelector('[data-mode-choice]:not([aria-pressed="true"]):not(:disabled)').focus()`);await enter();};
  await pick();
  if(await devtools.evaluate(`document.documentElement.dataset.theme`)===theme)throw new Error("Keyboard theme activation failed on "+await devtools.evaluate("location.pathname"));
  await pick();
  if(!inline){
    await escape();
    if(await devtools.evaluate<boolean>(`document.querySelector('[data-theme-panel]').matches(':popover-open')`))throw new Error("Escape did not close the theme menu");
  }
  await devtools.evaluate(`document.querySelector('[data-mobile-navigation] .ui-popover:popover-open [data-mobile-close]')?.click()`);
  const summary=await devtools.evaluate<boolean>(`(()=>{const element=[...document.querySelectorAll('main details > summary, #hub-dashboard details > summary')].find(el=>el.getBoundingClientRect().height>0);if(!element)return false;element.dataset.auditKeyboard='true';element.focus();return true;})()`);
  if(summary){
    const before=await devtools.evaluate(`document.querySelector('[data-audit-keyboard]').parentElement.open`);
    await enter();
    if(await devtools.evaluate(`document.querySelector('[data-audit-keyboard]').parentElement.open`)===before)throw new Error("Keyboard disclosure activation failed");
    await enter();
    await devtools.evaluate(`document.querySelector('[data-audit-keyboard]').removeAttribute('data-audit-keyboard')`);
  }
  const apps=await devtools.evaluate<boolean>(`(()=>{const element=document.querySelector('.site-switcher > summary');if(!element||!element.getBoundingClientRect().height)return false;element.focus();return true;})()`);
  if(apps){
    const before=await devtools.evaluate(`document.querySelector('.site-switcher').open`);
    await enter();
    if(await devtools.evaluate(`document.querySelector('.site-switcher').open`)===before)throw new Error("Keyboard Apps activation failed");
    if(!before){
      const fits=await devtools.evaluate(`(()=>{const nav=document.querySelector('.site-switcher__nav'),r=nav.getBoundingClientRect();return r.left>=0&&r.right<=document.documentElement.clientWidth+1;})()`);
      if(!fits)throw new Error("Open Apps menu exceeds the viewport");
    }
    await enter();
  }
  await devtools.evaluate(`document.activeElement.blur();scrollTo(0,0)`);
  return {theme:true,disclosure:summary,apps};
}

type ThemeState={theme:string;variant:string;mode:string|null;choice:string|null;icon:string|null;stored:string|null;storedTheme:string|null;legacy:string|null;color:string|null;inHead:boolean};
const themeState=`({theme:document.documentElement.dataset.theme,variant:document.documentElement.dataset.kuramiTheme??"paper",mode:document.querySelector('[data-mode-choice][aria-pressed="true"]')?.dataset.modeChoice??null,choice:document.querySelector('[data-theme-choice][aria-pressed="true"]')?.dataset.themeChoice??null,icon:document.querySelector('[data-theme-icon]')?.textContent??null,stored:sessionStorage.getItem('kurami-theme'),storedTheme:sessionStorage.getItem('kurami-theme-name'),legacy:localStorage.getItem('kurami-theme')??localStorage.getItem('kurami-theme-name'),color:document.querySelector('meta[name="theme-color"]')?.getAttribute('content')??null,inHead:Boolean(document.head.querySelector('script[src="/assets/theme.js"]'))})`;
const surface={paper:{light:"#fbfbf8",dark:"#0a0a0a"},neon:{light:"#f6f4fa",dark:"#07060b"}} as const;

/**
 * The Hub default (cookie) applies on every visit, the system mode without it; a menu choice lasts for the
 * session only (sessionStorage) and a new session starts from the default again; choices stored by the old
 * per-device switch are dropped; a Hub change ends the session override.
 */
async function checkThemeRuntime(devtools:Devtools,base:string,path:string):Promise<void> {
  const expect=(state:ThemeState,want:{variant:"paper"|"neon";theme:"light"|"dark";stored:string|null;storedTheme:string|null},step:string)=>{
    const expected={theme:want.theme,variant:want.variant,mode:want.theme,choice:want.variant,icon:want.theme==="dark"?"☀":"◐",stored:want.stored,storedTheme:want.storedTheme,legacy:null,color:(surface[want.variant] as Record<string,string>)[want.theme],inHead:true};
    if(JSON.stringify(state)!==JSON.stringify(expected))throw new Error(`Theme runtime ${path} ${step}: ${JSON.stringify(state)} expected ${JSON.stringify(expected)}`);
  };
  const state=()=>devtools.evaluate<ThemeState>(themeState);
  const click=(selector:string)=>devtools.evaluate(`document.querySelector('${selector}').click()`);
  const cookie=(value:string|null)=>devtools.evaluate(value?`document.cookie='kurami-theme-default=${value}; path=/'`:`document.cookie='kurami-theme-default=; path=/; max-age=0'`);
  const system=(value:"light"|"dark")=>devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-color-scheme",value}]});
  // A new session: what reopening the app or site gives.
  const reenter=async()=>{await devtools.evaluate(`sessionStorage.clear()`);await open(devtools,`${base}${path}`);};
  await open(devtools,`${base}${path}`);
  await devtools.evaluate(`localStorage.clear()`);await cookie(null);await system("dark");
  await reenter();
  expect(await state(),{variant:"paper",theme:"dark",stored:null,storedTheme:null},"system dark");
  await click('[data-mode-choice="light"]');
  expect(await state(),{variant:"paper",theme:"light",stored:"light",storedTheme:"paper"},"choose light");
  await open(devtools,`${base}${path}`);
  expect(await state(),{variant:"paper",theme:"light",stored:"light",storedTheme:"paper"},"the choice lasts the session");
  await click('[data-theme-choice="neon"]');
  expect(await state(),{variant:"neon",theme:"dark",stored:"dark",storedTheme:"neon"},"Neon opens dark");
  await click('[data-mode-choice="light"]');
  expect(await state(),{variant:"neon",theme:"light",stored:"light",storedTheme:"neon"},"Neon light");
  await click('[data-theme-choice="paper"]');
  expect(await state(),{variant:"paper",theme:"light",stored:"light",storedTheme:"paper"},"back to Paper keeps its mode");
  await reenter();
  expect(await state(),{variant:"paper",theme:"dark",stored:null,storedTheme:null},"a new session starts from the default");
  await devtools.evaluate(`localStorage.setItem('kurami-theme','light');localStorage.setItem('kurami-theme-name','neon')`);
  await reenter();
  expect(await state(),{variant:"paper",theme:"dark",stored:null,storedTheme:null},"old per-device choices are dropped");
  await cookie("neon.dark");
  await reenter();
  expect(await state(),{variant:"neon",theme:"dark",stored:null,storedTheme:null},"Hub default Neon");
  await click('[data-theme-choice="paper"]');
  expect(await state(),{variant:"paper",theme:"dark",stored:"dark",storedTheme:"paper"},"session override of the Hub default");
  await click('[data-mode-choice="light"]');
  await click('[data-theme-choice="neon"]');
  expect(await state(),{variant:"neon",theme:"dark",stored:"dark",storedTheme:"neon"},"the default theme opens in the default mode");
  await cookie("paper.light");
  await devtools.evaluate(`window.kuramiThemeRefresh()`);
  expect(await state(),{variant:"paper",theme:"light",stored:null,storedTheme:null},"a Hub change ends the override");
  await reenter();
  expect(await state(),{variant:"paper",theme:"light",stored:null,storedTheme:null},"Hub default beats system");
  await cookie(null);await system("light");
  await reenter();
  expect(await state(),{variant:"paper",theme:"light",stored:null,storedTheme:null},"system light");
  await system("dark");
  await delay(100);
  expect(await state(),{variant:"paper",theme:"dark",stored:null,storedTheme:null},"live system change");
  await devtools.evaluate(`sessionStorage.clear()`);
  await devtools.call("Emulation.setEmulatedMedia",{features:[]});
}

/**
 * Neon sets headline figures in its display face. A large number (22 px and up) outside headings, tables and
 * charts must carry the figure mark (FIGURE_ATTRIBUTE) or be a stat value, or Neon leaves it in the text face.
 */
async function checkNeonFigures(devtools:Devtools,base:string):Promise<void> {
  const missing:string[]=[];
  for(const path of ["/hub/en.html","/digest/daily-filled-en.html","/digest/weekly-filled-en.html","/digest/stocks-filled-en.html","/digest/stocks-discovery-en.html","/digest/cinema-en.html","/digest/review.html","/projects/index.html"]){
    await open(devtools,`${base}${path}`);
    await devtools.evaluate(`sessionStorage.setItem('kurami-theme-name','neon');sessionStorage.setItem('kurami-theme','dark')`);
    await open(devtools,`${base}${path}`);
    const found=await devtools.evaluate<string[]>(`[...document.querySelectorAll('main *')].filter(el=>{if(el.closest('svg,table,pre,code,h1,h2,h3,dialog,.ui-popover'))return false;const own=[...el.childNodes].filter(node=>node.nodeType===3).map(node=>node.textContent).join('').trim();return /\\d/.test(own)&&own.length<=14&&el.getClientRects().length&&parseFloat(getComputedStyle(el).fontSize)>=22&&!getComputedStyle(el).fontFamily.includes('Tektur');}).map(el=>el.tagName.toLowerCase()+'.'+[...el.classList].join('.')+' "'+el.textContent.trim().slice(0,14)+'"')`);
    for(const item of found)missing.push(`${path}: ${item}`);
  }
  await devtools.evaluate(`sessionStorage.clear()`);
  if(missing.length)throw new Error(`Large figures without the figure mark: ${missing.join("; ")}`);
}

/** Neon motion on the Hub: figures count up to their exact text, a refresh flashes only the changed figure, a press rings inside its button, reduced motion shows final values. */
async function checkNeonMotion(devtools:Devtools,base:string):Promise<void> {
  const page=`${base}/hub/index.html`;
  await open(devtools,page);
  await devtools.evaluate(`sessionStorage.setItem('kurami-theme-name','neon')`);
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"no-preference"}]});
  await open(devtools,page);
  const read=()=>devtools.evaluate<string[]>(`[...document.querySelectorAll('.stat-card__value')].map(node=>node.textContent)`);
  const during=await read();
  await delay(1300);
  const after=await read();
  if(JSON.stringify(during)===JSON.stringify(after))throw new Error(`Neon figures did not count up: ${JSON.stringify(after)}`);
  // A refresh that changes one figure flashes that figure only.
  await devtools.evaluate(`(()=>{const values=[...document.querySelectorAll('#hub-dashboard .stat-card__value')];values[0].textContent=values[0].textContent+'0';return 1})()`);
  await delay(80);
  const flashed=await devtools.evaluate<number[]>(`[...document.querySelectorAll('#hub-dashboard .stat-card__value')].map((node,index)=>node.classList.contains('ui-figure-blip')?index:-1).filter(index=>index>=0)`);
  if(JSON.stringify(flashed)!=="[0]")throw new Error(`Neon refresh must flash only the changed figure: ${JSON.stringify(flashed)}`);
  // A press spreads a ring inside the pressed button only.
  await devtools.evaluate(`(()=>{const button=document.querySelector('#hub-dashboard .button');const r=button.getBoundingClientRect();button.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+4,clientY:r.y+4}));return 1})()`);
  if(await devtools.evaluate<number>(`document.querySelectorAll('#hub-dashboard .button > .ui-ripple').length`)!==1)throw new Error("Neon press did not draw a ring in the button");
  await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
  await open(devtools,page);
  const reduced=await read();
  if(JSON.stringify(reduced)!==JSON.stringify(after))throw new Error(`Reduced motion must show final figures: ${JSON.stringify(reduced)}`);
  await devtools.evaluate(`sessionStorage.clear()`);
  await devtools.call("Emulation.setEmulatedMedia",{features:[]});
}

async function checkMobileNavigation(devtools:Devtools,width:number,current:string):Promise<void>{
  const geometry=await devtools.evaluate<{icons:number[];labels:boolean;fixed:boolean;header:string;overflow:number}>(`(()=>{const nav=document.querySelector('.mobile-navigation__bar');return {icons:[...nav.querySelectorAll('svg')].map(icon=>icon.getBoundingClientRect().width),labels:[...nav.querySelectorAll('button')].every(button=>button.getBoundingClientRect().height>=44&&button.querySelector('span').getBoundingClientRect().width<=button.getBoundingClientRect().width),fixed:getComputedStyle(nav).position==='fixed',header:getComputedStyle(document.querySelector('[data-site-header]')).position,overflow:document.documentElement.scrollWidth-innerWidth};})()`);
  if(!geometry.fixed||!['static','relative'].includes(geometry.header)||geometry.overflow>1||!geometry.labels||geometry.icons.some(size=>size!==26))throw new Error(`Mobile geometry ${current} ${width}: ${JSON.stringify(geometry)}`);
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="apps"]').click()`);
  await delay(240);
  const apps=await devtools.evaluate<{current:string;links:string[];fits:boolean}>(`(()=>{const panel=document.querySelector('#mobile-menu-apps'),r=panel.getBoundingClientRect(),bar=document.querySelector('.mobile-navigation__bar').getBoundingClientRect();return {current:panel.querySelector('[aria-current]')?.textContent.trim(),links:[...panel.querySelectorAll('a')].map(link=>link.textContent.trim()),bounds:{left:r.left,right:r.right,bottom:r.bottom,barTop:bar.top,width:innerWidth},fits:r.left>=0&&r.right<=innerWidth&&r.bottom<=bar.top-6.5};})()`);
  if(apps.current!==current||apps.links.join('|')!=='Hub|Digest|Projects|Docs|Hermes↗|Dokploy↗'||!apps.fits)throw new Error(`Mobile Apps ${JSON.stringify(apps)}`);
  if(!await devtools.evaluate(`document.activeElement===document.querySelector('#mobile-menu-apps a[aria-current]')`))throw new Error('Apps must focus the current app, not Close');
  if(!await devtools.evaluate(`(()=>{const link=document.querySelector('#mobile-menu-apps [aria-current]'),line=getComputedStyle(link,'::after');return line.width==='2px'&&parseFloat(line.height)>20&&line.left==='0px'&&line.transform==='none'&&!!link.querySelector('svg');})()`))throw new Error('Mobile selection must use the common left rail and outline icons');
  if(!await devtools.evaluate(`(()=>{const button=document.querySelector('[data-mobile-menu="apps"]'),style=getComputedStyle(button);return getComputedStyle(button,'::after').display==='none'&&parseFloat(style.borderRadius)>0&&style.color===getComputedStyle(button.querySelector('svg')).color&&style.backgroundColor!=='rgba(0, 0, 0, 0)';})()`))throw new Error('Dock selection must use an inset accent tile with matching icon and label, not an underline');
  const point=await devtools.evaluate<{x:number;y:number}>(`(()=>{const r=document.querySelector('[data-mobile-menu="apps"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await devtools.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await devtools.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  if(await devtools.evaluate(`document.querySelector('#mobile-menu-apps').matches(':popover-open')`))throw new Error('Mobile repeat dismissal');
  await delay(100);
  for(const key of await devtools.evaluate<string[]>(`[...document.querySelectorAll('[data-mobile-menu]')].map(button=>button.dataset.mobileMenu)`)){
    await devtools.evaluate(`document.querySelector('[data-mobile-menu="${key}"]').click()`);
    if(!await devtools.evaluate(`document.querySelector('#mobile-menu-${key}').matches(':popover-open')`))throw new Error('Mobile menu closed '+key);
    await delay(240);
    const icons=await devtools.evaluate<{width:number;height:number;fill:string;stroke:string;strokeWidth:string}[]>(`[...document.querySelectorAll('#mobile-menu-${key} .ui-icon')].map(icon=>{const r=icon.getBoundingClientRect(),s=getComputedStyle(icon);return {width:r.width,height:r.height,fill:s.fill,stroke:s.stroke,strokeWidth:s.strokeWidth};})`);
    if(icons.some(icon=>Math.abs(icon.width-20)>.5||Math.abs(icon.height-20)>.5||icon.fill!=='none'||icon.stroke==='none'||icon.strokeWidth!=='1.6px'))throw new Error(`Menu outline icon geometry ${current} ${key} ${width}: ${JSON.stringify(icons)}`);
    if((key==='contents'||current==='Hub'&&key==='sections')&&!await devtools.evaluate(`[...document.querySelectorAll('#mobile-menu-${key} a')].every(link=>!link.querySelector('svg'))`))throw new Error('On page must stay text-only in every app');
    if(key==='search'&&!await devtools.evaluate(`document.querySelector('#mobile-menu-search input[name="q"]')===document.activeElement`))throw new Error('Search focus lost');
    if(key==='search'){
      await devtools.evaluate(`Object.defineProperties(visualViewport,{height:{configurable:true,value:300},offsetTop:{configurable:true,value:40}});visualViewport.dispatchEvent(new Event('resize'))`);
      await delay(240);
      if(!await devtools.evaluate(`(()=>{const panel=document.querySelector('#mobile-menu-search').getBoundingClientRect(),input=document.querySelector('#mobile-menu-search input').getBoundingClientRect();return panel.top>=52&&panel.bottom<=340&&input.top>=52&&input.bottom<=340;})()`))throw new Error('Search must fit at the top of the keyboard-reduced visual viewport');
      await devtools.evaluate(`delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'))`);
    }
    await devtools.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await devtools.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    if(!await devtools.evaluate(`!document.querySelector('#mobile-menu-${key}').matches(':popover-open')&&document.activeElement===document.querySelector('[data-mobile-menu="${key}"]')`))throw new Error('Mobile Escape focus '+key);
    await delay(100);
  }
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="apps"]').click()`);
  await devtools.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:4,y:450});
  await devtools.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:4,y:450});
  if(await devtools.evaluate(`document.querySelector('#mobile-menu-apps').matches(':popover-open')`))throw new Error('Mobile outside dismissal');
  await delay(100);
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="more"]').click()`);await delay(240);
  if(!await devtools.evaluate(`getComputedStyle(document.querySelector('[data-mobile-menu="more"] svg')).transform!=='none'`))throw new Error('Settings icon should animate with menu state');
  // Settings: horizontal label/value rows, plus the theme row that lists its options inline with touch-size targets.
  const settings=await devtools.evaluate<{rows:{delta:number;gap:number}[];options:number[];hidden:boolean}>(`(()=>{const rows=[...document.querySelectorAll('#mobile-menu-more .mobile-navigation__setting:not([hidden]):not(:has([data-theme-menu]))')];const theme=document.querySelector('[data-mobile-slot="theme"]');return {rows:rows.map(row=>{const l=row.querySelector('.mobile-navigation__setting-label').getBoundingClientRect(),v=row.querySelector('.mobile-navigation__setting-value').getBoundingClientRect();return {delta:Math.abs((l.top+l.bottom-v.top-v.bottom)/2),gap:v.left-l.right};}),options:[...theme.querySelectorAll('[data-theme-choice],[data-mode-choice]')].map(option=>option.offsetHeight),hidden:theme.querySelector('[data-theme-panel]').hasAttribute('popover')||getComputedStyle(theme.querySelector('[data-theme-panel]')).opacity!=='1'||getComputedStyle(theme.querySelector('[data-theme-panel]')).visibility!=='visible'};})()`);
  if(settings.rows.length<1||settings.rows.some(row=>row.delta>=1||row.gap<0)||settings.options.length<4||settings.options.some(height=>height<43.5)||settings.hidden)throw new Error('Settings must have aligned rows and inline theme options with touch targets: '+JSON.stringify(settings));
  const beforeTheme=await devtools.evaluate<string>(`document.documentElement.dataset.theme`);
  await devtools.evaluate(`document.querySelector('[data-mobile-slot="theme"] [data-mode-choice]:not([aria-pressed="true"]):not(:disabled)').click()`);
  if(await devtools.evaluate(`document.documentElement.dataset.theme`)==beforeTheme||!await devtools.evaluate(`document.querySelector('#mobile-menu-more').matches(':popover-open')`))throw new Error('Theme choice must apply without closing Settings');
  await devtools.evaluate(`document.querySelector('[data-mobile-slot="theme"] [data-mode-choice]:not([aria-pressed="true"]):not(:disabled)').click()`);
  if(!await devtools.evaluate(`(()=>{const targets=[...document.querySelectorAll('.mobile-navigation .mobile-navigation__link,.mobile-navigation__action')];return targets.every(node=>{const s=getComputedStyle(node),hierarchy=node.matches('.side-group a[aria-current]');return s.fontSize==='14px'&&(s.fontWeight==='500'||hierarchy&&s.fontWeight==='600')&&s.fontFamily===getComputedStyle(document.querySelector('.mobile-navigation__setting-label')).fontFamily;});})()`))throw new Error('Mobile menu typography must be shared, preserving Docs hierarchy');
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="more"]').click()`);
  await delay(100);
  await devtools.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="more"]').click()`);
  await delay(100);
  const reduced=await devtools.evaluate<{panel:string;icon:string;transform:string}>(`(()=>{const panel=document.querySelector('#mobile-menu-more'),icon=document.querySelector('[data-mobile-menu="more"] svg');return {panel:getComputedStyle(panel).transitionDuration,icon:getComputedStyle(icon).transitionDuration,transform:getComputedStyle(icon).transform};})()`);
  if([reduced.panel,reduced.icon].some(value=>value.split(',').some(duration=>parseFloat(duration)>.00001))||reduced.transform!=='none')throw new Error('Reduced motion must disable menu and icon animation: '+JSON.stringify(reduced));
  await devtools.evaluate(`document.querySelector('[data-mobile-menu="more"]').click()`);
  await devtools.call('Emulation.setEmulatedMedia',{features:[]});
  await devtools.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await delay(80);
  if(!await devtools.evaluate(`!!document.querySelector('.site-actions [data-theme-toggle]:not(.button--switch)')&&!document.querySelector('.site-header__inner .site-nav svg,.site-header__inner .site-switcher svg')&&(!document.querySelector('.projects-search')||!!document.querySelector('.projects-toolbar .projects-search'))&&(!document.querySelector('[data-floating-period]')||!!document.querySelector('.site-header__utility [data-floating-period]'))`))throw new Error('Desktop controls not restored unchanged');
  await devtools.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:true});await delay(80);
  if(!await devtools.evaluate(`!!document.querySelector('[data-mobile-slot="more"] [data-theme-toggle]')`))throw new Error('Mobile controls not restored');
}

async function checkSiteSwitcher(devtools:Devtools,base:string):Promise<void> {
  for(const [path,current] of [["/digest/daily.html","Digest"],["/digest/cinema-legacy.html","Digest"],["/en/","Docs"],["/ru/what-is-kurami/","Docs"],["/hub/index.html","Hub"],["/hub/en.html","Hub"],["/projects/index.html","Projects"],["/projects/ru.html","Projects"]] as const)for(const width of [320,390,1280]){
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
    await open(devtools,`${base}${path}`);
    if(width<=620){await checkMobileNavigation(devtools,width,current);continue;}
    const state=await devtools.evaluate<{links:string[];current:string|null;projects:string|null;projectsHref:string|null;open:boolean;overflow:number;left:number;right:number}>(`(() => {
      const menu=document.querySelector('.site-switcher');
      menu.querySelector('summary').click();
      const nav=menu.querySelector('nav'),rect=nav.getBoundingClientRect();
      const projects=[...nav.querySelectorAll('.site-nav__link')].find(link=>link.textContent.trim().startsWith('Projects'));
      return {links:[...nav.querySelectorAll('a')].map(link=>link.textContent.trim()),current:nav.querySelector('[aria-current]')?.textContent.trim()??null,projects:projects?.getAttribute('aria-disabled')??null,projectsHref:projects?.getAttribute('href')??null,open:menu.open,overflow:document.documentElement.scrollWidth-innerWidth,left:rect.left,right:rect.right};
    })()`);
    const projectsHref=`https://kurami.shagon1k.win/${path==="/en/"||path==="/hub/en.html"||path==="/projects/index.html"?"en":"ru"}/projects/`;
    if(JSON.stringify(state.links)!==JSON.stringify(["Hub","Digest","Projects","Docs","Hermes↗","Dokploy↗"])||state.current!==current||state.projects!==null||state.projectsHref!==projectsHref||!state.open||state.overflow>1||state.left<0||state.right>width+1)throw new Error(`Site switcher ${path} at ${width}px: ${JSON.stringify(state)}`);
    await devtools.call("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:4,y:450});
    await devtools.call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:4,y:450});
    if(await devtools.evaluate("document.querySelector('.site-switcher').open"))throw new Error(`Apps outside dismissal failed ${path}`);
    await devtools.evaluate("document.querySelector('.site-switcher > summary').click();document.querySelector('.site-switcher > summary').click()");
    if(await devtools.evaluate("document.querySelector('.site-switcher').open"))throw new Error(`Apps repeated-click dismissal failed ${path}`);
  }
  for(const width of [320,390]){
    await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:true});
    await open(devtools,`${base}/en/state-and-truth/`);
    for(const key of ['sections','contents']){
      const selector=`#mobile-menu-${key}`;
      await devtools.evaluate(`document.querySelector('[data-mobile-menu="${key}"]').click()`);
      if(!await devtools.evaluate(`document.querySelector('${selector}').matches(':popover-open')`))throw new Error(`Docs menu did not open ${selector}`);
      await devtools.call("Input.dispatchMouseEvent",{type:"mousePressed",button:"left",clickCount:1,x:4,y:450});
      await devtools.call("Input.dispatchMouseEvent",{type:"mouseReleased",button:"left",clickCount:1,x:4,y:450});
      if(await devtools.evaluate(`document.querySelector('${selector}').matches(':popover-open')`))throw new Error(`Docs outside dismissal failed ${selector}`);
      await devtools.evaluate(`document.querySelector('[data-mobile-menu="${key}"]').click()`);
      await devtools.call("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
      await devtools.call("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
      if(!await devtools.evaluate(`!document.querySelector('${selector}').matches(':popover-open')&&document.activeElement===document.querySelector('[data-mobile-menu="${key}"]')`))throw new Error(`Docs Escape dismissal/focus failed ${selector}`);
      await devtools.evaluate(`document.querySelector('[data-mobile-menu="${key}"]').click();document.querySelector('[data-mobile-menu="${key}"]').click()`);
      if(await devtools.evaluate(`document.querySelector('${selector}').matches(':popover-open')`))throw new Error(`Docs repeat dismissal failed ${selector}`);
    }
  }
}

async function main(){
  const args=process.argv.slice(2);
  const out=args.find(arg=>arg.startsWith("--out="))?.slice(6);
  const compare=args.find(arg=>arg.startsWith("--compare="))?.slice(10);
  const screensOnly=args.includes("--screens-only");
  const viewports=args.includes("--viewports");
  const stress=args.includes("--stress");
  const keyboard=args.includes("--keyboard");
  if(!out)throw new Error("Usage: visual-regression.ts --out=<dir> [--compare=<baseline dir>] [/absolute/path/to/chromium]");
  const output=resolve(out);
  rmSync(output,{recursive:true,force:true});
  mkdirSync(output,{recursive:true});
  const served=await site();
  const server=createServer((request,response)=>{
    if(request.method!=="GET"&&request.method!=="HEAD"){response.writeHead(405).end();return;}
    const raw=new URL(request.url??"/","http://127.0.0.1").pathname;
    if(raw==="/api/news/order"){
      const filled=request.headers.referer?.includes("/digest/daily-filled");
      const order=Array.from({length:filled?6:3},(_,index)=>filled?`audit-story-${index}`:`story-${index+1}`);
      response.writeHead(200,{"content-type":"application/json"}).end(JSON.stringify({mode:"briefing",order,details:[],profile:JSON.parse(readFileSync(join(served,"fixture-profile.json"),"utf8"))}));
      return;
    }
    const path=resolve(served,`.${decodeURIComponent(raw)}`,raw.endsWith("/")?"index.html":"");
    if(!path.startsWith(`${served}${sep}`)||!existsSync(path)){response.writeHead(404).end();return;}
    response.writeHead(200,{"content-type":types[path.split(".").at(-1)??""]??"application/octet-stream"}).end(readFileSync(path));
  });
  // --serve=<port>: keep the fixture site running on loopback for manual review; no checks run.
  const serve=Number(args.find(arg=>arg.startsWith("--serve="))?.slice(8)??0);
  await new Promise<void>(done=>server.listen(serve,"127.0.0.1",done));
  const port=(server.address() as {port:number}).port;
  if(serve){console.log(`Fixture site on http://127.0.0.1:${port}/ (Ctrl+C stops)`);return;}
  const {devtools,close}=await launchBrowser(findBrowser(args.find(arg=>isAbsolute(arg))));
  const manifest:Record<string,string>={};
  const audit:Record<string,string[]>={};
  const contrastReview:Record<string,unknown[]>={};
  const layouts:Record<string,unknown>={};
  const keyboardChecks:Record<string,unknown>={};
  let auditedCount=0;
  try{
    await devtools.call("Page.enable");
    await devtools.call("Network.enable");
    await devtools.call("Network.setBlockedURLs",{urls:["https://*"]});
    if(viewports)await devtools.call("Page.addScriptToEvaluateOnNewDocument",{source:`(()=>{const NativeDate=Date;const fixed='2026-09-16T07:00:00Z';window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return NativeDate.parse(fixed);}};})()`});
    // A page-scoped run (KURAMI_UI_PAGES from `npm run test:changed`) checks only those pages; the library-wide
    // checks below (theme runtime, Neon motion and figures, site switcher, Stocks sorting) run in full runs.
    if(!process.env.KURAMI_UI_PAGES){
      for(const path of ["/digest/daily.html","/en/state-and-truth/","/lab/index.html","/hub/index.html"])await checkThemeRuntime(devtools,`http://127.0.0.1:${port}`,path);
      await checkNeonMotion(devtools,`http://127.0.0.1:${port}`);
      await checkNeonFigures(devtools,`http://127.0.0.1:${port}`);
      await checkSiteSwitcher(devtools,`http://127.0.0.1:${port}`);
      await open(devtools,`http://127.0.0.1:${port}/digest/stocks-filled-en.html`);
      const sorting=await devtools.evaluate<boolean>(`(()=>{
        const select=document.querySelector('[data-stock-sort]'),container=document.querySelector('[data-stock-rows]');
        const rows=[...container.children],order=()=>[...container.children].map(row=>row.dataset.stockRow).join(',');
        const original=order(),expected=[...rows].sort((a,b)=>Number(b.dataset.stockMove)-Number(a.dataset.stockMove)||Number(a.dataset.stockIndex)-Number(b.dataset.stockIndex)).map(row=>row.dataset.stockRow).join(',');
        select.value='moves';select.dispatchEvent(new Event('change',{bubbles:true}));const sorted=order()===expected;
        select.value='original';select.dispatchEvent(new Event('change',{bubbles:true}));return sorted&&order()===original;
      })()`);
      if(!sorting)throw new Error("Shared Stocks select must preserve native sorting and original order");
    }
    const audited:Record<string,string>={...pages};
    if(!screensOnly)for(const lang of ["en","ru"])for(const route of ["","changelog",...docsPages.map(page=>page.slug)])audited[`docs-${lang}-${route||"home"}`]??=`/${lang}/${route?route+"/":""}`;
    for(const [name,path] of Object.entries(audited))if(!Object.values(pages).includes(path)||name in pages)for(const width of widths)for(const theme of themes){
      await devtools.call("Emulation.setTouchEmulationEnabled",{enabled:width<600,maxTouchPoints:1});
      await devtools.call("Emulation.setDeviceMetricsOverride",{width,height:900,deviceScaleFactor:1,mobile:width<600});
      await open(devtools,`http://127.0.0.1:${port}${path}`);
      await devtools.evaluate(`(()=>{const style=document.createElement('style');style.textContent='*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}';document.head.append(style);(${JSON.stringify(theme)}.startsWith('neon')?['[data-theme-choice="neon"]','[data-mode-choice="'+(${JSON.stringify(theme)}==='neon'?'dark':'light')+'"]']:['[data-theme-choice="paper"]','[data-mode-choice="'+${JSON.stringify(theme)}+'"]']).forEach(selector=>document.querySelector(selector)?.click());return document.fonts.ready.then(()=>true)})()`);
      if(stress){
        await devtools.call("Emulation.setEmulatedMedia",{features:[{name:"prefers-reduced-motion",value:"reduce"}]});
        await devtools.evaluate(`document.documentElement.style.fontSize='200%'; document.querySelectorAll('main details, #hub-dashboard details').forEach(element=>element.open=true);document.fonts.ready`);
      }
      // Decode fixture images (including the intentionally failing logo) before measuring.
      await devtools.evaluate(`Promise.all([...document.images].map(image=>{image.loading='eager';return image.decode().catch(()=>{});})).then(()=>true)`);
      if(name.startsWith('digest-stocks-discovery')){
        const avatars=await devtools.evaluate(`(()=>{const loaded=[...document.querySelectorAll('[data-company-logo]')].filter(img=>img.getAttribute('src')==='/media/audit-logo.svg');const failed=[...document.querySelectorAll('[data-company-logo]')].filter(img=>img.getAttribute('src')==='/media/audit-logo-missing.svg');return loaded.length>0&&failed.length>0&&loaded.every(img=>img.naturalWidth>0&&img.parentElement.classList.contains('is-loaded'))&&failed.every(img=>img.naturalWidth===0&&!img.parentElement.classList.contains('is-loaded')&&getComputedStyle(img.parentElement.querySelector('.company-avatar__letters')).visibility==='visible');})()`);
        if(!avatars)throw new Error('Synthetic Stocks logos and letter fallback failed');
      }
      if(stress&&await devtools.evaluate(`getComputedStyle(document.documentElement).scrollBehavior`)!=='auto')throw new Error('Reduced-motion smooth-scroll suppression failed');
      if(keyboard)keyboardChecks[`${name}-${width}-${theme}`]=await checkKeyboard(devtools);
      await delay(150);
      if(!stress&&width>=1440&&["hub-home","projects-home","docs-home-en","digest-daily"].includes(name)){
        const uniform=await devtools.evaluate<boolean>(`(()=>{const main=document.querySelector('main'),header=document.querySelector('header .container');return [main,header].every(element=>element&&Math.abs(element.getBoundingClientRect().width-1320)<1)&&(!document.querySelector('.home')||Math.abs(document.querySelector('.home').getBoundingClientRect().width-main.getBoundingClientRect().width)<1);})()`);
        if(!uniform)throw new Error(`${name}: app/header/home must share the 1320px container`);
      }
      if(width<=620&&name.startsWith('digest-cinema-filled')){
        const stacked=await devtools.evaluate<boolean>(`[...document.querySelectorAll('.cinema-news')].every(item=>{const image=item.querySelector('.cinema-news__image.has-image'),copy=item.querySelector('.cinema-news__copy');if(!image)return true;const a=image.getBoundingClientRect(),b=copy.getBoundingClientRect();return a.bottom<=b.top+1&&Math.abs(a.left-b.left)<1&&a.width>innerWidth*.5;})`);
        if(!stacked)throw new Error('Mobile Cinema images must appear above their stories');
      }
      const issues=[...await devtools.evaluate<string[]>(AUDIT_EXPRESSION),...await devtools.evaluate<string[]>(inventoryExpression())];
      const pending=await devtools.evaluate<unknown[]>(CONTRAST_REVIEW_EXPRESSION);
      if(pending.length){
        const measured=await checkImageBackedContrast(devtools);
        contrastReview[`${name}-${width}-${theme}`]=measured;
        for(const check of measured)if(check.status==="manual-review-required")issues.push("Contrast pixel bound needs manual review: "+check.element);
      }
      auditedCount++;
      if(issues.length)audit[`${name}-${width}-${theme}`]=issues;
      if(!(name in pages))continue;
      if(viewports){
        const key=`${name}-${width}-${theme}`;
        layouts[key]=await devtools.evaluate(`(()=>{const size=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {text:el.textContent.trim().slice(0,80),x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),font:s.fontSize,shadow:s.boxShadow}};return {header:[...document.querySelectorAll('.site-brand,.site-actions,.site-header > .container > .site-nav')].map(size),titles:[...document.querySelectorAll('h1')].map(size),buttons:[...document.querySelectorAll('.button')].filter(el=>el.getBoundingClientRect().height).map(size),footer:[...document.querySelectorAll('.site-footer')].map(size),brokenImages:[...document.images].filter(image=>!image.complete||image.naturalWidth===0).map(image=>image.getAttribute('src'))}})()`);
        if(stress)layouts[key]={...layouts[key] as object,overflow:await devtools.evaluate(`(()=>{const width=document.documentElement.clientWidth,visible=[...document.body.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().width);const clipped=el=>{for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){if(['auto','scroll','hidden','clip'].includes(getComputedStyle(parent).overflowX)&&parent.getBoundingClientRect().right<=width+1)return true;}return false;};return {width,scroll:document.documentElement.scrollWidth,elements:visible.filter(el=>{const r=el.getBoundingClientRect();return (r.right>width+1||r.left< -1)&&!clipped(el)}).slice(0,24).map(el=>({tag:el.tagName,class:el.className,text:el.textContent.trim().slice(0,70),width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right,scroll:el.scrollWidth,client:el.clientWidth}))}})()`)};
        const viewport=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
        writeFileSync(join(output,`${key}-viewport.png`),Buffer.from(viewport.data,"base64"));
        if(width===390&&theme==="light")for(const selector of [".site-footer",".digest-feed",".weekly-charts",".weekly-topics",".cinema-trailer",".cinema-premiere",".cinema-rank",".cinema-news",".stock-details",".stocks-discovery",".investment-review",".review-section",".hub-alerts",".activity"]){
          const clip=await devtools.evaluate<{x:number;y:number;width:number;height:number;scale:number}|null>(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;const r=element.getBoundingClientRect();if(!r.width||!r.height)return null;return {x:Math.max(0,r.x+scrollX),y:Math.max(0,r.y+scrollY),width:Math.min(r.width,innerWidth),height:Math.min(r.height,900),scale:1}})()`);
          if(!clip)continue;
          const detail=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip});
          writeFileSync(join(output,`${key}-${selector.slice(1)}.png`),Buffer.from(detail.data,"base64"));
        }
      }
      const shot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true});
      const file=`${name}-${width}-${theme}.png`;
      const png=Buffer.from(shot.data,"base64");
      writeFileSync(join(output,file),png);
      manifest[file]=createHash("sha256").update(png).digest("hex");
    }
  }finally{await close();server.close();rmSync(served,{recursive:true,force:true});}
  writeFileSync(join(output,"manifest.json"),JSON.stringify(manifest,null,2));
  if(viewports)writeFileSync(join(output,"layouts.json"),JSON.stringify(layouts,null,2));
  writeFileSync(join(output,"audit.json"),JSON.stringify({audited:auditedCount,screenshots:Object.keys(manifest).length,widths,themes,stress,keyboardChecks,audit,contrastReview},null,2));
  if(Object.keys(audit).length){console.log(JSON.stringify({ok:false,audit},null,1));process.exitCode=1;return;}
  if(!compare){console.log(JSON.stringify({ok:true,themeRuntime:process.env.KURAMI_UI_PAGES?"skipped: page-scoped run":"verified",audited:auditedCount,screenshots:Object.keys(manifest).length,contrastReviewPages:Object.keys(contrastReview).length,out:output}));return;}
  const baseline=JSON.parse(readFileSync(resolve(compare,"manifest.json"),"utf8")) as Record<string,string>;
  const changed:Record<string,string>={};
  for(const file of Object.keys({...baseline,...manifest}).sort()){
    if(baseline[file]===manifest[file])continue;
    const before=resolve(compare,file),after=join(output,file);
    changed[file]=existsSync(before)&&existsSync(after)?`${(changedShare(decodePng(readFileSync(before)),decodePng(readFileSync(after)))*100).toFixed(2)}% pixels`:"missing";
  }
  console.log(JSON.stringify({ok:!Object.keys(changed).length,screenshots:Object.keys(manifest).length,changed,out:output},null,1));
  if(Object.keys(changed).length)process.exitCode=1;
}

await main();
