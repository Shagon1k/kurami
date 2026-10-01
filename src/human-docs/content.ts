// Loads every docs page from content/pages/<section>/<slug>.<lang>.md (plus home.<lang>.md).
// Section, depth group and order come from the Russian frontmatter; the English file must agree.
import {existsSync,readdirSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {parseBlocks,splitFrontmatter,type Frontmatter} from "./markdown.ts";
import type {HumanDocsPage} from "./content/schema.ts";
import {groups,sections,type Group,type Section} from "./content/site.ts";

export type {HumanDocsPage} from "./content/schema.ts";

export const pagesRoot=resolve(import.meta.dirname,"content/pages");
const structural=["section","group","order","next"] as const;

function text(meta:Frontmatter,key:string,context:string):string {
  const value=meta[key];
  if(typeof value!=="string"||!value.trim())throw new Error(`${context}: frontmatter needs ${key}`);
  return value;
}

export function loadPage(slug:string,files:{en:string;ru:string}):HumanDocsPage {
  const ru=splitFrontmatter(readFileSync(files.ru,"utf8"),files.ru),en=splitFrontmatter(readFileSync(files.en,"utf8"),files.en);
  for(const key of structural)if(JSON.stringify(ru.meta[key])!==JSON.stringify(en.meta[key]))throw new Error(`${slug}: ${key} differs between ru and en frontmatter`);
  const home=slug==="home";
  const section=(home?"basics":text(ru.meta,"section",files.ru)) as Section;
  const group=(home?"start":text(ru.meta,"group",files.ru)) as Group;
  if(!sections.includes(section))throw new Error(`${files.ru}: unknown section ${section}`);
  if(!groups.includes(group))throw new Error(`${files.ru}: unknown group ${group}`);
  const order=home?0:Number(text(ru.meta,"order",files.ru));
  if(!Number.isFinite(order))throw new Error(`${files.ru}: order must be a number`);
  const next=typeof ru.meta.next==="string"&&ru.meta.next?ru.meta.next:undefined;
  return {
    slug,section,group,order,next,
    title:{en:text(en.meta,"title",files.en),ru:text(ru.meta,"title",files.ru)},
    navTitle:{en:typeof en.meta.nav==="string"?en.meta.nav:text(en.meta,"title",files.en),ru:typeof ru.meta.nav==="string"?ru.meta.nav:text(ru.meta,"title",files.ru)},
    summary:{en:text(en.meta,"summary",files.en),ru:text(ru.meta,"summary",files.ru)},
    blocks:{en:parseBlocks(en.body,files.en),ru:parseBlocks(ru.body,files.ru)},
  };
}

/** `onIncomplete` lets an author tool skip a page whose other language is still being written. */
export function loadPages(root=pagesRoot,onIncomplete?:(slug:string)=>void):HumanDocsPage[] {
  const found=new Map<string,{en?:string;ru?:string}>();
  const visit=(dir:string)=>{
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const path=resolve(dir,entry.name);
      if(entry.isDirectory()){visit(path);continue;}
      const match=entry.name.match(/^([a-z0-9-]+)\.(en|ru)\.md$/);
      if(!match)throw new Error(`Unexpected file in docs pages: ${path}`);
      const record=found.get(match[1]!)??{};
      if(record[match[2] as "en"|"ru"])throw new Error(`Duplicate docs page ${match[1]} (${match[2]})`);
      record[match[2] as "en"|"ru"]=path;found.set(match[1]!,record);
    }
  };
  if(existsSync(root))visit(root);
  const pages:HumanDocsPage[]=[];
  for(const [slug,files] of found){
    if(!files.en||!files.ru){
      if(onIncomplete){onIncomplete(slug);continue;}
      throw new Error(`Docs page ${slug} needs both ${slug}.ru.md and ${slug}.en.md`);
    }
    pages.push(loadPage(slug,{en:files.en,ru:files.ru}));
  }
  const sectionIndex=(page:HumanDocsPage)=>page.slug==="home"?-1:sections.indexOf(page.section);
  return pages.sort((a,b)=>sectionIndex(a)-sectionIndex(b)||groups.indexOf(a.group)-groups.indexOf(b.group)||a.order-b.order||a.slug.localeCompare(b.slug));
}

/** Every page including home, in reader order. */
// Author tools set KURAMI_DOCS_DRAFTS=1 to skip pages whose second language is still being written; builds never do.
export const allPages:HumanDocsPage[]=loadPages(pagesRoot,process.env.KURAMI_DOCS_DRAFTS==="1"?()=>{}:undefined);
/** Article pages (everything except home), in reader order. */
export const pages:HumanDocsPage[]=allPages.filter(page=>page.slug!=="home");
export const homePage:HumanDocsPage|undefined=allPages.find(page=>page.slug==="home");
