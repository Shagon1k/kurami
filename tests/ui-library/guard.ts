// Keeps product code on the UI library. Existing exceptions are frozen per file in guard-baseline.json;
// a count may only go down. `--update` records reductions and refuses growth. A genuine
// product-specific exception is recorded with `--accept="<why no library part fits>"`, which keeps
// the reason in the baseline and must be matched by `UI-Library: exception` in the PR.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";

const root=resolve(import.meta.dirname,"../..");
const baselinePath=resolve(import.meta.dirname,"guard-baseline.json");
const products=["src/briefing/","src/human-docs/"];
const libraryClasses="button|theme-switch|site-header|site-brand|site-nav|site-menu|site-actions|table|callout|disclosure|diagram|container|skip-link|sr-only";

// What to use instead, shown when a rule catches new code.
const rules:Record<string,{pattern:RegExp;advice:string}>={
  "markup:button":{pattern:/<button\b|role=["']button["']/g,advice:"render controls with renderButton / renderLinkButton / renderThemeSwitch from src/ui-library/components"},
  "markup:button-class":{pattern:/class=["']button\b/g,advice:"do not hand-write library markup; call renderButton / renderLinkButton"},
  "markup:table":{pattern:/<table\b/g,advice:"render data tables with renderTable (src/ui-library/components/table.ts)"},
  "markup:details":{pattern:/<details\b/g,advice:"render disclosures with renderDisclosure, or add class=\"disclosure\" to a product component and list it in testing/audit.ts"},
  "markup:header":{pattern:/<header class=["'](?!site-header)[^"']*["'][^>]*data-|<header\b[^>]*role=["']banner/g,advice:"use the library site header pattern (renderSiteHeader)"},
  "markup:theme-toggle":{pattern:/data-theme-toggle/g,advice:"use renderThemeSwitch; the shared runtime owns theme behaviour"},
  "css:hex-colour":{pattern:/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}(?:[0-9a-fA-F]{2})?)?\b(?![-\w])/g,advice:"use a colour role, e.g. var(--text-muted) or var(--accent-primary); add a role to the theme if none fits"},
  "css:radius":{pattern:/border-radius:\s*\d/g,advice:"use var(--radius-sm), var(--radius) or var(--radius-md)"},
  "css:shadow":{pattern:/box-shadow:\s*-?\d/g,advice:"use var(--shadow-card), var(--shadow-card-sm) or var(--shadow-raised)"},
  "css:library-class":{pattern:new RegExp(`(?:^|[\\s,{}>+~(])\\.(?:${libraryClasses})(?![\\w-])[^{};\`]*\\{`,"gm"),advice:"do not restyle library classes in product CSS; tune them through their custom properties or change the library"},
};

function productFiles():string[] {
  return execFileSync("git",["ls-files","--cached","--others","--exclude-standard","--","src/*.ts"],{cwd:root,encoding:"utf8"}).split("\n").filter(file=>file&&products.some(prefix=>file.startsWith(prefix)));
}

/** Declaration blocks with three or more declarations that appear verbatim in both products. */
function duplicates(files:string[]):Record<string,string> {
  const seen=new Map<string,{products:Set<string>;selector:string}>();
  for(const file of files){
    const product=products.find(prefix=>file.startsWith(prefix))!;
    for(const match of readFileSync(resolve(root,file),"utf8").matchAll(/([^{}`;]{1,200})\{([^{}`]{20,})\}/g)){
      const declarations=match[2].split(";").map(value=>value.trim().replace(/\s+/g," ")).filter(value=>/^[a-z-]+\s*:/.test(value));
      if(declarations.length<3)continue;
      const key=createHash("sha256").update(declarations.sort().join(";")).digest("hex").slice(0,12);
      const entry=seen.get(key)??{products:new Set<string>(),selector:match[1].trim().split("\n").at(-1)!.trim()};
      entry.products.add(product);seen.set(key,entry);
    }
  }
  return Object.fromEntries([...seen].filter(([,entry])=>entry.products.size>1).map(([key,entry])=>[key,entry.selector]));
}

function measure():{counts:Record<string,Record<string,number>>;duplicates:Record<string,string>} {
  const files=productFiles(),counts:Record<string,Record<string,number>>={};
  for(const file of files){
    const source=readFileSync(resolve(root,file),"utf8");
    for(const [rule,{pattern}] of Object.entries(rules)){
      const count=[...source.matchAll(pattern)].length;
      if(count)(counts[rule]??={})[file]=count;
    }
  }
  return {counts,duplicates:duplicates(files)};
}

const current=measure();
if(process.argv.includes("--init")){
  assert.ok(!existsSync(baselinePath),"Baseline exists; use --update");
  writeFileSync(baselinePath,JSON.stringify(current,null,2)+"\n");
  console.log(JSON.stringify({initialized:true}));
  process.exit(0);
}
type Accepted={reason:string;growth:string[]};
const baseline=JSON.parse(readFileSync(baselinePath,"utf8")) as ReturnType<typeof measure>&{accepted?:Accepted[]};
const growth:string[]=[],reductions:string[]=[];
for(const rule of Object.keys(rules)){
  const before=baseline.counts[rule]??{},after=current.counts[rule]??{};
  for(const file of new Set([...Object.keys(before),...Object.keys(after)])){
    const was=before[file]??0,now=after[file]??0;
    if(now>was)growth.push(`${file}: ${rule} ${was} → ${now}. Instead: ${rules[rule].advice}.`);
    else if(now<was)reductions.push(`${file}: ${rule} ${was} → ${now}`);
  }
}
for(const [key,selector] of Object.entries(current.duplicates))if(!(key in baseline.duplicates))growth.push(`Duplicate declaration block in Digest and Docs (${selector}). A second product needs this look: move it into src/ui-library and use it from both.`);
for(const key of Object.keys(baseline.duplicates))if(!(key in current.duplicates))reductions.push(`duplicate ${baseline.duplicates[key]} resolved`);

const accept=process.argv.find(arg=>arg.startsWith("--accept="))?.slice(9).trim();
if(accept!==undefined){
  assert.ok(accept.length>=25,"--accept needs a specific reason (at least 25 characters)");
  assert.ok(growth.length,"Nothing to accept: no new exceptions");
  const accepted=[...(baseline.accepted??[]),{reason:accept,growth:growth.map(line=>line.replace(/\. Instead:.*$/,""))}];
  writeFileSync(baselinePath,JSON.stringify({...current,accepted},null,2)+"\n");
  console.log(JSON.stringify({accepted:growth.length,reason:accept}));
}else if(process.argv.includes("--update")){
  assert.deepEqual(growth,[],`Refusing to record growth; use --accept="<reason>" for a genuine exception:\n${growth.join("\n")}`);
  writeFileSync(baselinePath,JSON.stringify({...current,accepted:baseline.accepted},null,2)+"\n");
  console.log(JSON.stringify({updated:true,reductions}));
}else{
  assert.deepEqual(growth,[],`UI guard: new code bypasses the UI library.\n${growth.join("\n")}\nIf no library part fits, prefer extending the library (a variant or custom property). For a genuine product-specific component run node tests/ui-library/guard.ts --accept="<why>" and declare UI-Library: exception with UI-Reason in the PR.`);
  assert.deepEqual(reductions,[],`UI guard: exceptions went down (good). Record it with: node tests/ui-library/guard.ts --update\n${reductions.join("\n")}`);
  const total=Object.values(current.counts).reduce((sum,files)=>sum+Object.values(files).reduce((a,b)=>a+b,0),0);
  console.log(`UI guard: no new hand-written controls, literal colours/shapes, library-class overrides or cross-product duplicates (${total} frozen exceptions, ${Object.keys(current.duplicates).length} frozen duplicates)`);
}
