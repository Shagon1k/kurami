import {cpSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {pages} from "./content.ts";
import {readDeploymentManifest,changesForDeployedSha,assertDocsSourceMatchesDeployment,type Language} from "./changelog.ts";
import {renderArticle,renderChangelog,renderHome} from "./render.ts";
import {DOCS_STYLES} from "./styles.ts";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const args=process.argv.slice(2);
const isPreview=args.length===1 && args[0]==="--preview";
const isDocsRelease=args.length===1 && args[0]==="--docs-release";
const hasManifest=args.length===2 && args[0]==="--deployment-manifest";
if(!isPreview&&!isDocsRelease&&!hasManifest) throw new Error("Use --preview, --docs-release, or --deployment-manifest <trusted path>");
const revision=hasManifest?readDeploymentManifest(resolve(args[1])):undefined;
if(revision)assertDocsSourceMatchesDeployment(revision);
if(!isPreview && execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim())throw new Error("Release docs build requires a clean working tree");
const docsSha=isPreview?null:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const output=resolve(root,"dist/human-docs");
const siteRoot=resolve(root,"integrations/hermes/skills/kurami-ui-preview-language/assets");
const paths=new Set<string>();
for(const page of pages){
  if(!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(page.slug)||paths.has(page.slug))throw new Error(`Invalid or duplicate docs route: ${page.slug}`);
  paths.add(page.slug);
  if(!page.title.en||!page.title.ru||!page.navTitle.en||!page.navTitle.ru||!page.summary.en||!page.summary.ru||!page.blocks.length||page.blocks.some(b=>!b.en||!b.ru))throw new Error(`Incomplete bilingual docs page: ${page.slug}`);
}
const changes=revision?({en:changesForDeployedSha(revision,"en"),ru:changesForDeployedSha(revision,"ru")}):{en:[],ru:[]};
for(const lang of ["en","ru"] as Language[])for(const change of changes[lang])if(change.page&&!paths.has(change.page))throw new Error(`Changelog links to missing route: ${change.page}`);
// Validate everything before replacing a previous build; a failed release gate leaves it untouched.
const rendered: [string,string][]=[];
for(const lang of ["en","ru"] as Language[]){
  rendered.push([`${lang}/index.html`,renderHome(lang)]);
  for(const page of pages)rendered.push([`${lang}/${page.slug}/index.html`,renderArticle(page,lang)]);
  rendered.push([`${lang}/changelog/index.html`,renderChangelog(lang,changes[lang],revision,!isPreview)]);
}
for(const [path,html] of rendered){
  const links=[...html.matchAll(/href="\/(en|ru)\/([a-z0-9/-]*)"/g)];
  for(const [, ,slug] of links)if(slug&&slug!=="changelog/"&&!paths.has(slug.replace(/\/$/,"")))throw new Error(`Broken internal route ${slug} in ${path}`);
}
rmSync(output,{recursive:true,force:true});
mkdirSync(resolve(output,"assets"),{recursive:true});
for(const [path,html] of rendered){const destination=resolve(output,path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,html);}
cpSync(resolve(siteRoot,"kurami-fox-transparent.png"),resolve(output,"assets/fox.png"));
cpSync(resolve(siteRoot,"kurami-favicon.svg"),resolve(output,"assets/favicon.svg"));
for(const font of ["onest-latin.woff2","onest-cyrillic.woff2","fragment-mono-latin.woff2"])cpSync(resolve(root,"src/human-docs/assets",font),resolve(output,"assets",font));
writeFileSync(resolve(output,"assets/docs.css"),DOCS_STYLES);
writeFileSync(resolve(output,"assets/theme.js"),`try{document.documentElement.dataset.theme=localStorage.getItem('kurami-theme')==='dark'?'dark':'light'}catch{}document.addEventListener('DOMContentLoaded',()=>{document.querySelector('[data-theme-toggle]')?.addEventListener('click',()=>{const root=document.documentElement;const theme=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=theme;try{localStorage.setItem('kurami-theme',theme)}catch{}})});`);
writeFileSync(resolve(output,"build.json"),JSON.stringify({revision:revision??null,docsSha,mode:isPreview?"preview":"release",pages:rendered.length},null,2));
console.log(`Built ${rendered.length} pages into ${output} (${revision??(isDocsRelease?"docs-only release; no verified app deploy":"unpublished preview")})`);
