import {existsSync} from "node:fs";
import {resolve} from "node:path";

export const sections=["basics","digest","projects","operations","docs"] as const;
export type Section=typeof sections[number];
export type Localized<T>={en:T;ru:T};

export const visualIds=[
  "home-map","system-architecture","roles","state-legend","comparison",
  "daily-publication","weekly-contrast","stocks-boundary","for-me-order",
  "signals-gates","weekly-evidence","cinema-states","stocks-data",
  "discovery-screen","review-acceptance",
  "project-architecture","project-digest","project-admission","project-flow","project-run-state","engineering-evidence",
  "owner-controls","health-map","schedule-evidence","recovery-topology","recovery-matrix",
  "maintenance-scope","connector-contours","automation-boundaries",
  "ui-layers","project-path",
] as const;
export type VisualId=typeof visualIds[number];

// Legacy HTML remains while sections are migrated. New content uses explicit
// structure for representations, evidence and optional technical detail.
export type HumanDocsBlock=
  | {type:"html";en:string;ru:string;visual?:VisualId}
  | {type:"details";summary:Localized<string>;en:string;ru:string}
  | {type:"diagram";visual:VisualId;explanation:Localized<string>}
  | {type:"table";caption:Localized<string>;columns:Localized<string[]>;rows:Localized<string[][]>}
  | {type:"callout";tone:"note"|"limit"|"warning";title:Localized<string>;body:Localized<string>}
  | {type:"example";synthetic:true;title:Localized<string>;body:Localized<string>}
  | {type:"technical";summary:Localized<string>;body:Localized<string>;code?:Localized<string>}
  | {type:"screenshot";file:string;alt:Localized<string>;caption:Localized<string>}
  | {type:"source-links";paths:string[]};

export type HumanDocsPage={
  slug:string;
  section:Section;
  title:Localized<string>;
  navTitle:Localized<string>;
  summary:Localized<string>;
  blocks:HumanDocsBlock[];
  sources?:string[];
  /** Slug of the natural following page, rendered as a "Next" link after the content. */
  next?:string;
};

const slugPattern=/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const sourcePattern=/^[a-zA-Z0-9_./-]+$/;
const unsafeMarkup=/<\s*(?:script|iframe|object|embed|form|input|button)\b|\bon[a-z]+\s*=|javascript:|data:text\/html/i;
const visualSet=new Set<string>(visualIds);
function assertPlain(value:string|undefined,context:string):void {
  if(!value?.trim()||/[<>]/.test(value))throw new Error(`Empty or marked-up ${context}`);
}

export function assertSafeMarkup(raw:string,context:string):void {
  if(unsafeMarkup.test(raw)||/data-visual\s*=|<\s*\/?details\b|<\s*\/?summary\b/i.test(raw))throw new Error(`Unsafe or unstructured markup in ${context}`);
}

export function assertSourcePath(path:string,root?:string):void {
  if(!sourcePattern.test(path)||path.includes("..")||path.startsWith("/"))throw new Error(`Invalid docs source path: ${path}`);
  if(root&&!existsSync(resolve(root,path)))throw new Error(`Missing docs source: ${path}`);
}

export function assertContent(pages:readonly HumanDocsPage[],root?:string):void {
  const routes=new Set<string>();
  for(const page of pages){
    if(!slugPattern.test(page.slug)||routes.has(page.slug))throw new Error(`Invalid or duplicate docs route: ${page.slug}`);
    routes.add(page.slug);
    if(!sections.includes(page.section)||!page.blocks.length)throw new Error(`Incomplete docs page: ${page.slug}`);
    for(const lang of ["en","ru"] as const){
      if(!page.title[lang]?.trim()||!page.navTitle[lang]?.trim()||!page.summary[lang]?.trim())throw new Error(`Incomplete ${lang} docs page: ${page.slug}`);
      for(const [index,block] of page.blocks.entries()){
        const context=`${page.slug}/${lang}/${index}`;
        if(block.type==="html"||block.type==="details"){
          if(!block[lang]?.trim())throw new Error(`Empty ${lang} block ${index} in ${page.slug}`);
          assertSafeMarkup(block[lang],context);
          for(const match of block[lang].matchAll(/href\s*=\s*["']\/(en|ru)\//g))if(match[1]!==lang)throw new Error(`Wrong-language link in ${page.slug}/${lang}`);
          if(block.type==="details")assertPlain(block.summary[lang],`disclosure title in ${context}`);
        }else if(block.type==="diagram"){
          if(!visualSet.has(block.visual))throw new Error(`Unknown docs visual in ${page.slug}`);
          assertPlain(block.explanation[lang],`diagram explanation in ${context}`);
        }else if(block.type==="table"){
          assertPlain(block.caption[lang],`table caption in ${context}`);
          const columns=block.columns[lang],rows=block.rows[lang];
          if(!columns?.length||!rows?.length||columns.some(value=>!value?.trim())||rows.some(row=>row.length!==columns.length||row.some(value=>!value?.trim())))throw new Error(`Invalid ${lang} table in ${context}`);
          for(const value of [...columns,...rows.flat()])if(/[<>]/.test(value))throw new Error(`Markup in ${lang} table in ${context}`);
        }else if(block.type==="callout"||block.type==="example"||block.type==="technical"){
          assertPlain(block.type==="technical"?block.summary[lang]:block.title[lang],`block title in ${context}`);
          assertPlain(block.body[lang],`block body in ${context}`);
          if(block.type==="technical"&&block.code&&!block.code[lang]?.trim())throw new Error(`Empty technical code in ${context}`);
          if(block.type==="callout"&&!(["note","limit","warning"] as string[]).includes(block.tone))throw new Error(`Invalid callout tone in ${context}`);
          if(block.type==="example"&&block.synthetic!==true)throw new Error(`Docs example must be synthetic in ${context}`);
        }else if(block.type==="screenshot"){
          if(!/^shot-[a-z0-9-]+\.png$/.test(block.file))throw new Error(`Invalid screenshot file in ${context}`);
          if(root&&!existsSync(resolve(root,"src/human-docs/assets",block.file)))throw new Error(`Missing screenshot ${block.file}`);
          assertPlain(block.alt[lang],`screenshot alt in ${context}`);
          assertPlain(block.caption[lang],`screenshot caption in ${context}`);
        }else if(block.type!=="source-links")throw new Error(`Unknown docs block in ${page.slug}/${index}`);
      }
    }
    for(const block of page.blocks)if(block.type==="html"&&block.visual&&!visualSet.has(block.visual))throw new Error(`Unknown docs visual in ${page.slug}`);
    for(const block of page.blocks)if(block.type==="table"&&(block.columns.en.length!==block.columns.ru.length||block.rows.en.length!==block.rows.ru.length))throw new Error(`Unmatched docs table translations in ${page.slug}`);
    if(page.blocks.filter(block=>block.type==="source-links").length>1||page.sources?.length&&page.blocks.some(block=>block.type==="source-links"))throw new Error(`Duplicate docs source links in ${page.slug}`);
    for(const block of page.blocks)if(block.type==="source-links"){
      if(!block.paths.length)throw new Error(`Empty docs source links in ${page.slug}`);
      for(const path of block.paths)assertSourcePath(path,root);
    }
    for(const path of page.sources??[])assertSourcePath(path,root);
  }
  for(const page of pages){
    if(page.next!==undefined&&(!routes.has(page.next)||page.next===page.slug))throw new Error(`Invalid next page for ${page.slug}: ${page.next}`);
  }
}
