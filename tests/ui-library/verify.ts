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
import {renderLinkButton} from "../../src/ui-library/components/button.ts";
import {validateRenderedHtml} from "../../src/briefing/html-artifacts.ts";
import {renderSiteHeader,renderSiteNav,SITE_HEADER_CSS} from "../../src/ui-library/patterns/site-header.ts";
import {renderDocument} from "../../src/ui-library/patterns/page-shell.ts";
import {renderTable,TABLE_CSS} from "../../src/ui-library/components/table.ts";
import {renderCallout,CALLOUT_CSS} from "../../src/ui-library/components/callout.ts";
import {renderDisclosure,DISCLOSURE_CSS} from "../../src/ui-library/components/disclosure.ts";
import {inlineDiagram} from "../../src/ui-library/foundations/diagram.ts";
import {exportBundle,exportDirectory} from "../../src/ui-library/export.ts";
import {readFileSync,readdirSync} from "node:fs";

const root=resolve(import.meta.dirname,"../..");

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
assert.throws(()=>renderLinkButton({label:"x",href:"javascript:alert(1)",variant:"icon"}),/Unsafe link/);
assert.throws(()=>renderLinkButton({label:"x",href:"//evil.example",variant:"icon"}),/Unsafe link/);

// Header and document patterns: one implementation for both sites, escaped input, safe links.
for(const [site,css] of [["Digest",BRIEFING_STYLES],["Docs",DOCS_STYLES]] as const)assert.equal(css.split(SITE_HEADER_CSS).length,2,`${site} includes the header pattern once`);
const header=renderSiteHeader({brand:{href:"/",ariaLabel:"Kurami",foxSrc:"/assets/fox.png",suffix:"docs",meta:{label:"<b>x</b>"}},nav:{label:"Sections",links:[{href:"/a/",label:"A",current:"page"},{href:"/b/",label:"B"}],collapse:{label:"Menu"}},actions:renderThemeSwitch("en")});
assert.match(header,/class="site-header site-header--collapsible" data-site-header/);
assert.match(header,/<a class="site-nav__link" href="\/a\/" aria-current="page">A<\/a>/);
assert.equal((header.match(/aria-label="Sections"/g)??[]).length,2,"inline and collapsed navigation");
assert.match(header,/&lt;b&gt;x&lt;\/b&gt;/);
assert.throws(()=>renderSiteNav({label:"x",links:[{href:"javascript:alert(1)",label:"x"}]}),/Unsafe navigation href/);
assert.throws(()=>renderSiteNav({label:"x",links:[],attributes:{onclick:"x"}}),/Unsafe header attribute/);
assert.match(renderSiteNav({label:"x",links:[],hideWhenEmpty:true}),/ hidden>/);
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
assert.match(renderCallout({tone:"warning",title:"T",body:"<x>"}),/^<aside class="callout callout--warning"><strong>T<\/strong><p>&lt;x&gt;<\/p><\/aside>$/);
assert.throws(()=>renderCallout({tone:"loud" as "note",body:"x"}),/Invalid callout tone/);
assert.match(renderDisclosure({summary:"<s>",body:"<p>b</p>",boxed:true,open:true}),/^<details class="disclosure disclosure--boxed" open><summary>&lt;s&gt;<\/summary><p>b<\/p><\/details>$/);

// Diagrams: every shipped scene stays inside the palette and becomes theme-aware when inlined.
const scenes=readdirSync(resolve(root,"src/human-docs/assets")).filter(file=>file.endsWith(".svg"));
assert.ok(scenes.length>=8);
for(const file of scenes){
  const inline=inlineDiagram(readFileSync(resolve(root,"src/human-docs/assets",file),"utf8"),{id:file.replace(".svg",""),label:"Scene"});
  assert.doesNotMatch(inline,/\s(?:fill|stroke)="#/,`${file} keeps no fixed colours`);
  assert.match(inline,/style="[^"]*var\(--diagram-[a-z-]+,#[0-9a-f]+\)/);
  assert.doesNotMatch(inline,new RegExp(`\\sid="(?!${file.replace(".svg","")}-)`),`${file} ids are namespaced`);
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

console.log(`UI library theme contract verified: ${colorRoles.length} colour roles × 2 modes, ${scaleRoles.length} scale roles, no retired or undefined tokens`);
