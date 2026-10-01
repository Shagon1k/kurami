// A docs page is two Markdown files, `<slug>.ru.md` and `<slug>.en.md`, under content/pages/<section>/.
// Frontmatter places the page (section, group, order); the body is the docs Markdown subset.
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import type {Block} from "../markdown.ts";
import {diagramSkeleton} from "../diagrams/kit.ts";
import {groups,sections,type Group,type Section} from "./site.ts";

export type Localized<T>={en:T;ru:T};
export type Language="en"|"ru";

export type HumanDocsPage={
  slug:string;
  section:Section;
  group:Group;
  order:number;
  title:Localized<string>;
  navTitle:Localized<string>;
  summary:Localized<string>;
  blocks:Localized<Block[]>;
  /** Slug of the natural following page, rendered as a "Next" link after the content. */
  next?:string;
};

const slugPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sourcePattern=/^[a-zA-Z0-9_./-]+$/;

export function assertSourcePath(path:string,root?:string):void {
  if(!sourcePattern.test(path)||path.includes("..")||path.startsWith("/"))throw new Error(`Invalid docs source path: ${path}`);
  if(root&&!existsSync(resolve(root,path)))throw new Error(`Missing docs source: ${path}`);
}

export function walk(blocks:Block[],visit:(block:Block)=>void):void {
  for(const block of blocks){
    visit(block);
    if(block.type==="list")block.items.forEach(item=>walk(item,visit));
    if(block.type==="container")walk(block.body,visit);
  }
}

/** What must be the same in both languages: the pictures, screenshots, generated tables and section count. */
export function skeleton(blocks:Block[]):string[] {
  const out:string[]=[];
  walk(blocks,block=>{
    if(block.type==="heading"&&block.level===2)out.push("h2");
    else if(block.type==="code"&&block.lang==="diagram")out.push(`diagram:${diagramSkeleton(block.text)}`);
    else if(block.type==="leaf")out.push(`${block.name}:${block.attrs.file??block.attrs.name??""}`);
    else if(block.type==="container"&&["code-map","glance","guarantees"].includes(block.name))out.push(block.name);
  });
  return out;
}

export function assertContent(pages:readonly HumanDocsPage[],root?:string):void {
  const routes=new Set<string>();
  for(const page of pages){
    if(page.slug!=="home"&&!slugPattern.test(page.slug)||routes.has(page.slug))throw new Error(`Invalid or duplicate docs route: ${page.slug}`);
    routes.add(page.slug);
    if(!sections.includes(page.section)||!groups.includes(page.group))throw new Error(`Page ${page.slug} has an unknown section or group`);
    for(const lang of ["en","ru"] as const){
      for(const [field,value] of [["title",page.title[lang]],["nav",page.navTitle[lang]],["summary",page.summary[lang]]] as const)
        if(!value?.trim()||/[<>]/.test(value))throw new Error(`Empty or marked-up ${lang} ${field} in ${page.slug}`);
      if(!page.blocks[lang].length)throw new Error(`Empty ${lang} page ${page.slug}`);
    }
    const [en,ru]=[skeleton(page.blocks.en),skeleton(page.blocks.ru)];
    if(JSON.stringify(en)!==JSON.stringify(ru))throw new Error(`EN and RU of ${page.slug} differ in structure:\n  en: ${en.join(" ")}\n  ru: ${ru.join(" ")}`);
    for(const lang of ["en","ru"] as const)walk(page.blocks[lang],block=>{
      if(block.type==="leaf"&&block.name==="shot"){
        const file=block.attrs.file??"";
        if(!/^shot-[a-z0-9-]+\.png$/.test(file))throw new Error(`Invalid screenshot file ${file} in ${page.slug}`);
        if(root&&!existsSync(resolve(root,"src/human-docs/assets",file)))throw new Error(`Missing screenshot ${file} in ${page.slug}`);
        if(!["card","wide"].includes(block.attrs.size??""))throw new Error(`Screenshot ${file} in ${page.slug} needs size="card" or size="wide"`);
        if(!block.attrs.alt?.trim()||!block.attrs.caption?.trim())throw new Error(`Screenshot ${file} in ${page.slug} needs alt and caption`);
      }
    });
  }
  for(const page of pages)if(page.next!==undefined&&(!routes.has(page.next)||page.next===page.slug))throw new Error(`Invalid next page for ${page.slug}: ${page.next}`);
}
