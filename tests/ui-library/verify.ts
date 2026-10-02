import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {resolve} from "node:path";
import {colorRoles,scaleRoles,type Theme} from "../../src/ui-library/tokens/index.ts";
import {kuramiTheme,themeCss,THEME_CSS} from "../../src/ui-library/themes/index.ts";
import {BRIEFING_STYLES} from "../../src/briefing/ui/styles.ts";
import {DOCS_STYLES} from "../../src/human-docs/styles.ts";
import {FOUNDATION_CSS,fontFiles} from "../../src/ui-library/foundations/index.ts";
import {injectRuntime} from "../../src/briefing/server.ts";
import {renderPageShell} from "../../src/briefing/ui/page-shell.ts";
import {existsSync} from "node:fs";
import {THEME_RUNTIME_JS,THEME_SCRIPT_TAG} from "../../src/ui-library/runtime/theme.ts";
import {renderThemeSwitch} from "../../src/ui-library/components/theme-switch.ts";
import {renderButton,renderLinkButton} from "../../src/ui-library/components/button.ts";
import {validateRenderedHtml} from "../../src/briefing/html-artifacts.ts";
import {renderSiteHeader,renderSiteNav,renderSiteSwitcher,SITE_HEADER_CSS} from "../../src/ui-library/patterns/site-header.ts";
import {kuramiSites} from "../../src/ui-library/patterns/kurami-sites.ts";
import {renderSiteFooter} from "../../src/ui-library/patterns/site-footer.ts";
import {formatSiteDate} from "../../src/ui-library/foundations/date.ts";
import {renderDocument} from "../../src/ui-library/patterns/page-shell.ts";
import {renderTable,TABLE_CSS} from "../../src/ui-library/components/table.ts";
import {renderCallout,CALLOUT_CSS} from "../../src/ui-library/components/callout.ts";
import {renderDisclosure,DISCLOSURE_CSS} from "../../src/ui-library/components/disclosure.ts";
import {renderNumberField,renderSelectField,renderSearchField,renderCheckbox} from "../../src/ui-library/components/form.ts";
import {renderStatCard,renderMeter} from "../../src/ui-library/components/stat-card.ts";
import {renderIcon,iconPath} from "../../src/ui-library/components/icon.ts";
import {renderSelectionControl,SELECTION_CONTROL_CSS} from "../../src/ui-library/components/selection-control.ts";
import {renderPill} from "../../src/ui-library/components/pill.ts";
import {renderPopover} from "../../src/ui-library/components/popover.ts";
import {renderDialog} from "../../src/ui-library/components/dialog.ts";
import {renderPeriodSwitch} from "../../src/ui-library/components/period-switch.ts";
import {inlineDiagram} from "../../src/ui-library/foundations/diagram.ts";
import {renderDiagram} from "../../src/human-docs/diagrams/kit.ts";
import {exportBundle,exportDirectory} from "../../src/ui-library/export.ts";
import {baselineGrew,evaluateUiImpact,touchesUi} from "../../src/ui-library/testing/impact.ts";
import {readFileSync,readdirSync} from "node:fs";

const attributedSelect=renderSelectField({name:"sort",label:"Order",value:"original",options:[{value:"original",label:"My order"}],attributes:{"data-stock-sort":true,"aria-label":"Order & sort"}});
assert.match(attributedSelect,/<select name="sort" data-stock-sort aria-label="Order &amp; sort">/);
assert.throws(()=>renderSelectField({name:"sort",label:"Order",value:"original",options:[],attributes:{onchange:"alert(1)"}}),/Unsafe select attribute/);
assert.match(renderIcon("bellOff"),/aria-hidden="true"/);

const root=resolve(import.meta.dirname,"../..");
const periodControl=renderPeriodSwitch({key:"usage",lang:"en",label:"Usage period"});
assert.match(periodControl,/role="group" aria-label="Usage period"/);
assert.match(periodControl,/data-period-days="30" aria-pressed="true"/);
assert.match(periodControl,/data-period-days="7" aria-pressed="false"/);
const floatingPeriod=renderPeriodSwitch({key:"global",lang:"ru",label:"Период",floating:true});
assert.match(floatingPeriod,/data-period-trigger="global" aria-expanded="false" aria-controls="period-global-choices"/);
assert.match(floatingPeriod,/>30д<\/button>/);
assert.match(renderPeriodSwitch({key:"usage",lang:"ru",selected:7,label:"Расход"}),/>7д</);
assert.throws(()=>renderPeriodSwitch({key:'bad"key',lang:"en",label:"Usage"}),/Invalid period key/);

// Every role is declared once per mode; light is the root mode.
for(const role of colorRoles){
  assert.match(THEME_CSS,new RegExp(`:root \\{[^}]*--${role}: #`),`light ${role}`);
  assert.match(THEME_CSS,new RegExp(`html\\[data-theme="dark"\\] \\{[^}]*--${role}: #`),`dark ${role}`);
}
assert.ok(BRIEFING_STYLES.startsWith(`\n${THEME_CSS}`)||BRIEFING_STYLES.includes(THEME_CSS),"Digest uses the library theme");
assert.ok(DOCS_STYLES.startsWith(THEME_CSS),"Docs uses the library theme");

// A new theme replaces values only; an incomplete one is rejected.
const inverted:Theme={...kuramiTheme,name:"test",light:kuramiTheme.dark,dark:kuramiTheme.light};
assert.match(themeCss(inverted),/:root \{ color-scheme: dark;/);
const incomplete=structuredClone(kuramiTheme);
delete (incomplete.dark.colors as Partial<Record<string,string>>)["focus-ring"];
assert.throws(()=>themeCss(incomplete),/missing roles: focus-ring/);
const noShape=structuredClone(kuramiTheme);
delete (noShape.scale as Partial<Record<string,string>>)["radius"];
assert.throws(()=>themeCss(noShape),/missing scale roles: radius/);
for(const role of scaleRoles)assert.match(THEME_CSS,new RegExp(`:root \\{[^}]*--${role}: `),`scale ${role}`);

// Components read semantic roles only: no retired names and no undefined custom properties.
const sources=execFileSync("git",["grep","--untracked","-hoE","-e","var\\(--[a-z0-9-]+","--","src/*.ts"],{cwd:root,encoding:"utf8"}).split("\n").filter(Boolean);
const retired=/^var\(--(paper|surface|panel|section|section-shadow|ink|muted|signal|signal-soft|line|grid|positive|warning|focus|docs-signal-text)$/;
assert.deepEqual(sources.filter(value=>retired.test(value)),[],"retired token names");
const known=new Set<string>([...colorRoles,...scaleRoles]);
const local=execFileSync("git",["grep","--untracked","-hoE","-e","--[a-z0-9-]+\\s*:","--","src/*.ts"],{cwd:root,encoding:"utf8"}).split("\n").map(value=>value.replace(/\s*:$/,"").slice(2)).filter(Boolean);
for(const name of local)known.add(name);
const undefinedNames=[...new Set(sources.map(value=>value.slice(6)))].filter(name=>!known.has(name));
assert.deepEqual(undefinedNames,[],"custom properties used without a definition");

// Foundations: both sites include them once; every font subset and its family licence ship in the repo.
for(const [site,css] of [["Digest",BRIEFING_STYLES],["Docs",DOCS_STYLES]] as const)assert.equal(css.split(FOUNDATION_CSS).length,2,`${site} includes foundations once`);
for(const font of fontFiles){
  assert.ok(existsSync(resolve(root,"src/ui-library/assets/fonts",font.file)),font.file);
  assert.ok(existsSync(resolve(root,"src/ui-library/assets/fonts",`OFL-${font.family.replaceAll(" ","-")}.txt`)),`${font.family} licence`);
  assert.ok(FOUNDATION_CSS.includes(`url("/assets/${font.file}")`),`${font.file} face`);
}
const page=renderPageShell({title:"T",brand:"Kurami",date:"2026-09-16",dateLabel:"16",generated:"10:00",timezone:"UTC",content:"<p>x</p>"});
assert.doesNotMatch(page.match(/<footer[\s\S]*?<\/footer>/)?.[0]??"",/Обновлено|Updated/,"missing snapshot time is not invented");
const timedPage=renderPageShell({title:"T",brand:"Kurami",date:"2026-09-16",dateLabel:"16",generated:"10:00",updatedAt:"2026-09-16T07:00:00Z",timezone:"Europe/Vilnius",content:"<p>x</p>"});
assert(timedPage.includes(formatSiteDate("2026-09-16T07:00:00Z","ru",true)),"Digest footer uses the shared snapshot formatter");
assert.doesNotMatch(page,/fonts\.(googleapis|gstatic)\.com/,"Digest pages load no third-party fonts");
const frozen='<html><head><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Onest" rel="stylesheet"></head><body></body></html>';
const served=injectRuntime(frozen);
assert.doesNotMatch(served,/fonts\.googleapis\.com/,"older editions stop requesting Google Fonts");
assert.ok(served.includes('url("/assets/onest-latin.woff2")'),"older editions get self-hosted faces");
assert.equal(injectRuntime(page).includes("@font-face"),page.includes("@font-face"),"current pages are not given a second copy");

// Theme runtime: valid browser JS without TS residue; injected once per served Digest page, never frozen into artifacts.
assert.doesNotThrow(()=>new Function(THEME_RUNTIME_JS),"runtime parses as JavaScript");
assert.match(THEME_RUNTIME_JS,/prefers-color-scheme: dark/);
assert.doesNotMatch(page,/<script/,"rendered Digest HTML stays script-free");
assert.doesNotThrow(()=>validateRenderedHtml(page),"page passes the artifact validator");
const injected=injectRuntime(page);
assert.equal(injected.split(THEME_SCRIPT_TAG).length,2,"one theme script");
assert.ok(injected.indexOf(THEME_SCRIPT_TAG)<injected.indexOf("</head>"),"theme script runs in head");
assert.equal(injectRuntime(injected).split(THEME_SCRIPT_TAG).length,2,"injection is idempotent");
// One switch markup for every site: constant accessible name, state in aria-pressed.
for(const [lang,name] of [["ru","Тёмная тема"],["en","Dark theme"]] as const){
  const button=renderThemeSwitch(lang);
  assert.match(button,/data-theme-toggle[^>]*aria-pressed="false"/);
  assert.match(button,new RegExp(`<span class="sr-only">${name}</span>`));
  assert.match(button,/data-theme-icon/);
}
assert.match(renderLinkButton({label:"RU",href:"/ru/",variant:"icon",attributes:{hreflang:"ru"}}),/^<a class="button button--icon" href="\/ru\/" hreflang="ru">RU<\/a>$/);
assert.match(renderButton({label:"Reset",variant:"subtle",size:"compact"}),/^<button class="button button--subtle button--compact" type="button">Reset<\/button>$/);
assert.match(renderLinkButton({label:"More",href:"/more/",variant:"subtle",size:"compact"}),/^<a class="button button--subtle button--compact"/);
const svgButton=renderButton({label:"Больше такого",variant:"icon",iconPath:"M12 19V5 M6 11l6-6 6 6"});
assert.match(svgButton,/<button[^>]*aria-label="Больше такого"[^>]*><svg class="button__svg"[^>]*><path d="M12 19V5 M6 11l6-6 6 6"\/><\/svg><\/button>/);
assert.doesNotMatch(svgButton,/<span|🔔/);
assert.throws(()=>renderButton({label:"x",variant:"icon",icon:"x",iconPath:"M0 0"}),/both text and SVG/);
const counterToggle=renderButton({label:"need you",count:0,variant:"toggle",attributes:{"aria-pressed":"false"}});
assert.match(counterToggle,/aria-label="0 need you"/);
assert.match(counterToggle,/aria-pressed="false"/);
assert.match(counterToggle,/<strong class="button__count">0<\/strong> need you/);
const responsiveButton=renderButton({label:"Sync & freshness",compactLabel:"<Sync>",variant:"quiet"});
assert.match(responsiveButton,/aria-label="Sync &amp; freshness"/);
assert.match(responsiveButton,/<span class="button__label--full">Sync &amp; freshness<\/span>/);
assert.match(responsiveButton,/<span class="button__label--compact" aria-hidden="true">&lt;Sync&gt;<\/span>/);
const iconCount=renderButton({label:"active",compactLabel:"",count:3,iconPath:"M0 0",visibleLabel:true,variant:"toggle"});
assert.match(iconCount,/aria-label="3 active"/);
assert.doesNotMatch(iconCount,/button__label--compact/);
for(const count of [-1,NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>renderButton({label:"tasks",count,variant:"toggle"}),/Invalid button count/);
assert.throws(()=>renderLinkButton({label:"x",href:"javascript:alert(1)",variant:"icon"}),/Unsafe link/);
assert.throws(()=>renderLinkButton({label:"x",href:"//evil.example",variant:"icon"}),/Unsafe link/);

// Header and document patterns: one implementation for both sites, escaped input, safe links.
for(const [site,css] of [["Digest",BRIEFING_STYLES],["Docs",DOCS_STYLES]] as const)assert.equal(css.split(SITE_HEADER_CSS).length,2,`${site} includes the header pattern once`);
const header=renderSiteHeader({brand:{href:"/",ariaLabel:"Kurami",foxSrc:"/assets/fox.webp",suffix:"docs",meta:{label:"<b>x</b>"}},nav:{label:"Sections",links:[{href:"/a/",label:"A",current:"page"},{href:"/b/",label:"B"}],collapse:{label:"Menu"}},actions:renderThemeSwitch("en")});
assert.match(header,/class="site-header site-header--collapsible" data-site-header/);
assert.match(header,/<a class="site-nav__link" href="\/a\/" aria-current="page">A<\/a>/);
assert.equal((header.match(/aria-label="Sections"/g)??[]).length,2,"inline and collapsed navigation");
assert.match(header,/&lt;b&gt;x&lt;\/b&gt;/);
assert.doesNotMatch(header,/site-header__utility/);
assert.match(renderSiteHeader({brand:{href:"/",ariaLabel:"Hub",foxSrc:"/fox.webp"},nav:{label:"Sections",links:[],hideWhenEmpty:true},actions:"",utility:renderPeriodSwitch({key:"global",lang:"en",label:"All statistics"})}),/class="site-header__utility"><div class="period-switch"/);
assert.match(renderButton({label:"<Models>",variant:"quiet",iconPath:"M0 0",visibleLabel:true}),/<\/svg><span>&lt;Models&gt;<\/span>/);
assert.throws(()=>renderSiteNav({label:"x",links:[{href:"javascript:alert(1)",label:"x"}]}),/Unsafe navigation href/);
assert.throws(()=>renderSiteNav({label:"x",links:[],attributes:{onclick:"x"}}),/Unsafe header attribute/);
assert.match(renderSiteNav({label:"x",links:[],hideWhenEmpty:true}),/ hidden>/);
const sites=renderSiteSwitcher(kuramiSites("docs","en"));
const footer=renderSiteFooter({lang:"en",app:"Digest",updated:"<time>",credit:{label:"Logos",href:"https://example.org/"}});
assert.match(footer,/class="site-footer container"/);assert.match(footer,/Updated · &lt;time&gt;/);
assert.match(footer,/href="https:\/\/kurami\.shagon1k\.win\/en\/docs\/"/);
assert.throws(()=>renderSiteFooter({lang:"en",app:"X",credit:{label:"x",href:"javascript:bad()"}}),/Invalid footer credit/);
assert.equal(formatSiteDate("bad","en"),"—");
assert.equal(formatSiteDate("2026-09-12","en"),"12 Sept 2026");
assert.match(sites,/<summary aria-label="Apps">/);
assert.match(sites,/href="https:\/\/kurami\.shagon1k\.win\/en\/"[^>]*>Hub<\/a>/);
assert.match(sites,/href="https:\/\/kurami\.shagon1k\.win\/en\/docs\/" aria-current="location">Docs<\/a>/);
assert.match(sites,/href="https:\/\/hermes\.shagon1k\.win\/" target="_blank" rel="noopener noreferrer"[^>]*>Hermes<span/);
assert.match(sites,/href="https:\/\/dokploy\.shagon1k\.win\/" target="_blank" rel="noopener noreferrer"[^>]*>Dokploy<span/);
assert.match(sites,/href="https:\/\/kurami\.shagon1k\.win\/en\/projects\/">Projects<\/a>/);
assert.doesNotMatch(sites,/site-nav__link--disabled/);
assert.equal((sites.match(/class="site-nav__link(?: site-nav__link--external)?"/g)??[]).length,6);
assert.match(renderLinkButton({label:"Open source",href:"https://source.example",variant:"icon",iconPath:"M0 0",visibleLabel:false,target:"_blank"}),/rel="noopener noreferrer" aria-label="Open source"/);
assert.throws(()=>renderLinkButton({label:"X",href:"/",variant:"icon",className:'bad"'}),/Unsafe link button class/);
assert.throws(()=>renderLinkButton({label:"X",href:"/",variant:"icon",visibleLabel:false}),/requires an icon/);
assert.match(renderSiteSwitcher(kuramiSites("hub")),/href="https:\/\/kurami\.shagon1k\.win\/ru\/docs\/"/);
const documentHtml=renderDocument({lang:"en",title:"T",favicon:"/f.svg",styles:{href:"/s.css"},themeScript:true,skipLabel:"Skip",header,main:"<p>m</p>",footer:"<footer></footer>"});
assert.match(documentHtml,/<a class="skip-link" href="#main">Skip<\/a>/);
assert.match(documentHtml,/<main id="main" class="container" tabindex="-1">/);
assert.ok(documentHtml.indexOf(THEME_SCRIPT_TAG)<documentHtml.indexOf("</head>"));
assert.throws(()=>renderDocument({lang:"en\"",title:"T",favicon:"/f",styles:{href:"/s"},themeScript:false,skipLabel:"s",header:"",main:"",footer:""}),/Invalid document language/);

// Components shared by both products: included once, escaped by default, trusted HTML only when marked.
for(const css of [TABLE_CSS,CALLOUT_CSS,DISCLOSURE_CSS])for(const [site,styles] of [["Digest",BRIEFING_STYLES],["Docs",DOCS_STYLES]] as const)assert.equal(styles.split(css).length,2,`${site} includes a component once`);
const table=renderTable({caption:"Cap",columns:["Name","Value"],rows:[["<b>",{html:"<em>1</em>"}]],rowHeaders:true,numeric:true,stack:true});
assert.match(table,/^<div class="table table--numeric table--stack"><table><caption>Cap<\/caption>/);
assert.match(table,/<th scope="row">&lt;b&gt;<\/th><td><span class="table__label" aria-hidden="true">Value<\/span><em>1<\/em><\/td>/);
assert.throws(()=>renderTable({columns:["a","b"],rows:[["only one"]]}),/does not match/);
assert.match(renderTable({caption:"Named by a heading",captionHidden:true,columns:["a"],rows:[["1"]]}),/<caption class="sr-only">Named by a heading<\/caption>/);
assert.match(renderCallout({tone:"warning",title:"T",body:"<x>"}),/^<aside class="callout callout--warning"><strong>T<\/strong><p>&lt;x&gt;<\/p><\/aside>$/);
assert.throws(()=>renderCallout({tone:"loud" as "note",body:"x"}),/Invalid callout tone/);
assert.equal(renderCallout({tone:"note",body:{html:"<p>a <code>b</code></p><ul><li>c</li></ul>"}}),'<aside class="callout callout--note"><p>a <code>b</code></p><ul><li>c</li></ul></aside>',"trusted block markup is kept");
assert.match(renderDisclosure({summary:"<s>",body:"<p>b</p>",boxed:true,open:true}),/^<details class="disclosure disclosure--boxed" open><summary>&lt;s&gt;<\/summary><p>b<\/p><\/details>$/);
assert.match(renderSelectField({label:"<label>",name:"model",value:"a",options:[{value:"a",label:'<option>"'}]}),/&lt;label&gt;/);
assert.match(renderSearchField({label:"Поиск",name:"q",value:'<unsafe>"',placeholder:'"find"'}),/type="search" value="&lt;unsafe&gt;&quot;" placeholder="&quot;find&quot;"/);
assert.match(renderSelectField({label:"Model",name:"model",value:"a",options:[{value:"a",label:"A"}]}),/value="a" selected>A<\/option>/);
assert.match(renderNumberField({label:"WIP",name:"wip",value:2,min:1,max:3}),/name="wip" type="number" value="2" min="1" max="3"/);
assert.match(renderCheckbox({name:"repo",label:"<Repo>",value:'a"b',checked:true}),/value="a&quot;b" checked/);
assert.match(renderCheckbox({name:"repo",label:"Kurami",value:"kurami"}),/data-selection-variant="data"/);
assert.match(renderSelectionControl({label:"<Mail>",disabled:true}),/ disabled/);
assert.match(renderSelectionControl({label:"<Mail>"}),/&lt;Mail&gt;/);
assert.throws(()=>renderSelectionControl({label:"Mail",attributes:{onclick:"bad"}}),/Unsafe selection attribute/);
assert.throws(()=>renderSelectionControl({label:"Mail",className:'bad"class'}),/Unsafe selection class/);
assert.equal(BRIEFING_STYLES.split(SELECTION_CONTROL_CSS).length,2,"Digest selection CSS has one shared source");
assert.match(renderDisclosure({summary:"Events",body:"",variant:"inline"}),/disclosure--inline/);
assert.match(renderPopover({id:"controls",label:"<Controls>",body:"<p>content</p>"}),/popover="auto" aria-label="&lt;Controls&gt;"/);
assert.throws(()=>renderPopover({id:'bad"id',label:"Controls",body:""}),/Invalid popover ID/);
assert.match(renderStatCard({label:"<Tokens>",value:"1M",full:'1"000',tone:"info",icon:"tokens"}),/data-tone="info"/);
assert.match(renderStatCard({label:"<Tokens>",value:"1M",full:'1"000'}),/title="1&quot;000"/);
assert.match(renderStatCard({label:"<Tokens>",value:"1M"}),/&lt;Tokens&gt;/);
assert.match(renderMeter({label:"CPU",value:0}),/aria-valuenow="0"/);
for(const value of [-1,101,NaN,Infinity])assert.throws(()=>renderMeter({label:"CPU",value}),/Invalid meter/);
assert.match(renderIcon("controls"),/aria-hidden="true"/);assert.match(iconPath("cpu"),/^M/);
assert.match(renderDisclosure({summary:"Events",body:"",key:'id"1'}),/data-disclosure-key="id&quot;1"/);
assert.match(renderDialog({id:"test-dialog",title:"<title>",closeLabel:"Close",body:"<p>Trusted</p>"}),/aria-labelledby="test-dialog-title"/);
assert.match(renderDialog({id:"test-dialog",title:"<title>",closeLabel:"Close",body:""}),/&lt;title&gt;/);
for(const closeLabel of ["Close","Закрыть"]){
  const dialog=renderDialog({id:"test-dialog",title:"Title",closeLabel,body:""});
  assert.match(dialog,/class="button button--icon"/);
  assert.ok(dialog.includes(`aria-label="${closeLabel}"`));
  assert.ok(dialog.includes(`title="${closeLabel}"`));
  assert.match(dialog,/data-dialog-close[^>]*><svg[^>]*aria-hidden="true"/);
  assert.ok(!dialog.includes(`>${closeLabel}<`),"close label is accessible, not visible text");
}
assert.throws(()=>renderDialog({id:'bad"id',title:"T",closeLabel:"Close",body:""}),/Invalid dialog ID/);

// Diagrams: every docs picture comes from the diagram kit, stays inside the palette and becomes theme-aware when inlined.
const scenes={
  graph:renderDiagram('kind: graph\ndesc: Every node kind and edge style, drawn once for the palette check.\nnode a "Owner" owner at 0,0\nnode b "Store" store at 1,0\nnode c "External" external at 2,0\nnode d "Start" start at 0,1\nnode e "Wait" wait at 1,1\nnode f "End" end at 2,1\nnode g "Fail" fail at 0,2\nnode h "Check" decision at 1,2\nnode i "table" "a · b" entity at 2,2\ngroup x "Group" a b highlight\nedge a -> b "x" accent\nedge b -> c dashed\nedge d -> e muted\nedge e <-> f').svg,
  sequence:renderDiagram('kind: sequence\ndesc: Two actors and a phase for the palette check.\nactor a "A" owner\nactor b "B" external\nmsg a -> b "go" accent\nphase "Later"\nself b "work"\nnote b "done"').svg,
  timeline:renderDiagram('kind: timeline\ndesc: One lane with every mark for the palette check.\nlane l "Lane"\nspan l 01:00-02:00 "Span" accent\nat l 03:00 "Point"\nevery l 120m "tick"').svg,
};
for(const [name,svg] of Object.entries(scenes)){
  const inline=inlineDiagram(svg,{id:`kit-${name}`,label:"Scene"});
  assert.doesNotMatch(inline,/\s(?:fill|stroke)="#/,`${name} keeps no fixed colours`);
  assert.match(inline,/style="[^"]*var\(--diagram-(success|warning),#[0-9a-f]+\)/.test(inline)||name!=="graph"?/var\(--diagram-/:/diagram-success/);
  assert.doesNotMatch(inline,new RegExp(`\\sid="(?!kit-${name}-)`),`${name} ids are namespaced`);
}
assert.throws(()=>inlineDiagram('<svg><rect fill="#123456"/></svg>',{id:"x",label:"x"}),/outside the diagram palette/);
assert.throws(()=>inlineDiagram('<svg onload="x()"></svg>',{id:"x",label:"x"}),/Unsafe diagram/);

// The UI-language skill points at the real library: generated bundle is fresh, named parts exist,
// and it carries no second copy of colours, fonts or reference templates.
for(const [file,content] of Object.entries(exportBundle()))assert.equal(readFileSync(resolve(exportDirectory,file),"utf8"),content,`${file} is stale: run npm run ui:export`);
const skillRoot=resolve(root,"integrations/hermes/skills/kurami-ui-preview-language");
const skillText=[resolve(skillRoot,"SKILL.md"),...readdirSync(resolve(skillRoot,"references")).map(file=>resolve(skillRoot,"references",file))].map(file=>readFileSync(file,"utf8")).join("\n");
assert.ok(!existsSync(resolve(skillRoot,"templates")),"reference templates removed");
assert.doesNotMatch(skillText,/#[0-9a-fA-F]{6}\b|fonts\.googleapis|templates\//,"skill restates no colours, Google Fonts or templates");
// Named functions must exist in the library or in Digest's canonical components.
const exported=new Set<string>();
for(const dir of ["src/ui-library","src/briefing"])for(const file of readdirSync(resolve(root,dir),{recursive:true,encoding:"utf8"}))if(file.endsWith(".ts"))for(const match of readFileSync(resolve(root,dir,file),"utf8").matchAll(/export (?:async )?(?:function|const) ([A-Za-z_]+)/g))exported.add(match[1]);
const named=[...new Set(skillText.match(/\b(?:render[A-Z][A-Za-z]+|inlineDiagram|[A-Z][A-Z_]+_CSS|THEME_RUNTIME_JS)\b/g))];
assert.ok(named.length>=10,"skill names real functions");
for(const name of named)assert.ok(exported.has(name),`skill names ${name}, which no module exports`);
for(const path of new Set(skillText.match(/src\/ui-library\/[a-z0-9/._-]+[a-z0-9]/g)))assert.ok(existsSync(resolve(root,path)),`skill path ${path} exists`);

// Every Digest page renderer is exercised by the joint browser regression; a new page type needs a fixture.
const fixtureSource=readFileSync(resolve(root,"src/ui-library/testing/fixtures.ts"),"utf8");
const renderers=execFileSync("git",["grep","--untracked","-hoE","-e","export (async )?function render[A-Za-z]*(Page|InvestmentReview)\\b","--","src/briefing/*.ts"],{cwd:root,encoding:"utf8"}).split("\n").filter(Boolean).map(line=>line.replace(/^export (?:async )?function /,""));
assert.ok(renderers.length>=4,"page renderers found");
for(const renderer of renderers)assert.match(fixtureSource,new RegExp(`\\b${renderer}\\(`),`${renderer} has no fixture in src/ui-library/testing/fixtures.ts, so test:ui-browser never audits it`);

// PR declaration: UI changes say whether they used, extended or bypassed the library.
assert.ok(touchesUi("src/human-docs/render.ts")&&touchesUi("src/briefing/stocks/styles.ts")&&!touchesUi("src/orchestrator/runtime/controller.ts"));
assert.deepEqual(evaluateUiImpact(["src/orchestrator/x.ts"],"",false),[]);
assert.match(evaluateUiImpact(["src/briefing/ui/styles.ts"],"",false)[0]!,/UI-Library: used/);
assert.deepEqual(evaluateUiImpact(["src/briefing/ui/styles.ts"],"UI-Library: used",false),[]);
assert.match(evaluateUiImpact(["src/briefing/ui/styles.ts"],"UI-Library: extended",false)[0]!,/src\/ui-library/);
assert.match(evaluateUiImpact(["src/briefing/ui/styles.ts"],"UI-Library: used",true)[0]!,/baseline grew/);
assert.match(evaluateUiImpact(["src/briefing/ui/styles.ts"],"UI-Library: exception\nUI-Reason: short",true)[0]!,/UI-Reason/);
assert.deepEqual(evaluateUiImpact(["src/briefing/ui/styles.ts"],"UI-Library: exception\nUI-Reason: Stocks sparkline needs its own compact control",true),[]);
const frozenBaseline=JSON.stringify({counts:{"css:radius":{"a.ts":2}},duplicates:{}});
assert.equal(baselineGrew(frozenBaseline,JSON.stringify({counts:{"css:radius":{"a.ts":1}},duplicates:{}})),false);
assert.equal(baselineGrew(frozenBaseline,JSON.stringify({counts:{"css:radius":{"a.ts":3}},duplicates:{}})),true);
assert.equal(baselineGrew(frozenBaseline,JSON.stringify({counts:{},duplicates:{abc:".x"}})),true);
assert.equal(baselineGrew(null,frozenBaseline),false,"introducing the baseline freezes, it does not grow");

console.log(`UI library theme contract verified: ${colorRoles.length} colour roles × 2 modes, ${scaleRoles.length} scale roles, no retired or undefined tokens`);

assert.match(renderPill({label:"<Ready>",tone:"success"}),/pill--success[^>]*>[\s\S]*&lt;Ready&gt;/);
assert.match(renderTable({columns:["Status"],headers:[{html:"<strong>Status</strong>"}],sortDirections:["ascending"],rows:[]}),/aria-sort="ascending"><strong>Status<\/strong>/);
assert.throws(()=>renderTable({columns:["Status"],headers:[],rows:[]}),/header count/);
