import {cpSync,existsSync,mkdirSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {allPages,pages} from "./content.ts";
import {assertContent} from "./content/schema.ts";
import {aliases} from "./content/site.ts";
import {readDeploymentManifest,changesForDeployedSha,assertDocsSourceMatchesDeployment,type Language} from "./changelog.ts";
import {renderAlias,renderArticle,renderChangelog,renderHome,resolveSlug} from "./render.ts";
import {DOCS_STYLES} from "./styles.ts";
import {fontFiles} from "../ui-library/foundations/fonts.ts";
import {THEME_RUNTIME_JS} from "../ui-library/runtime/theme.ts";

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
const sourceSha=revision??docsSha??execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
const output=resolve(root,"dist/human-docs");
const siteRoot=resolve(root,"src/ui-library/assets/brand");
assertContent(allPages,root);
for(const [from,to] of Object.entries(aliases)){
  if(allPages.some(page=>page.slug===from))throw new Error(`Alias ${from} shadows a real page`);
  if(!allPages.some(page=>page.slug===to))throw new Error(`Alias ${from} points to missing page ${to}`);
}
const changes=revision?({en:changesForDeployedSha(revision,"en"),ru:changesForDeployedSha(revision,"ru")}):{en:[],ru:[]};
for(const lang of ["en","ru"] as Language[])for(const change of changes[lang])if(change.page&&!resolveSlug(change.page))throw new Error(`Changelog links to missing route: ${change.page}`);
// Validate everything before replacing a previous build; a failed release gate leaves it untouched.
const rendered:[string,string][]=[];
const diagrams:{id:string;svg:string}[]=[];
const options={sourceSha,deployed:Boolean(revision),root};
for(const lang of ["en","ru"] as Language[]){
  const home=renderHome(lang,options);
  rendered.push([`${lang}/index.html`,home.html]);diagrams.push(...home.diagrams);
  for(const page of pages){
    const article=renderArticle(page,lang,options);
    rendered.push([`${lang}/${page.slug}/index.html`,article.html]);diagrams.push(...article.diagrams);
  }
  for(const [from,to] of Object.entries(aliases))rendered.push([`${lang}/${from}/index.html`,renderAlias(lang,from,to)]);
  rendered.push([`${lang}/changelog/index.html`,renderChangelog(lang,changes[lang],revision,!isPreview)]);
}
const routes=new Set([...pages.map(page=>page.slug),...Object.keys(aliases),"changelog"]);
for(const [path,html] of rendered){
  for(const [, ,slug] of html.matchAll(/href\s*=\s*["']\/(en|ru)\/([a-z0-9/-]*)["']/g))if(slug&&!routes.has(slug.replace(/\/$/,"")))throw new Error(`Broken internal route ${slug} in ${path}`);
  for(const [, id] of html.matchAll(/href="\/assets\/diagram-([a-z0-9-]+)\.svg"/g))if(!diagrams.some(diagram=>diagram.id===id))throw new Error(`Missing diagram asset ${id} in ${path}`);
}
rmSync(output,{recursive:true,force:true});
mkdirSync(resolve(output,"assets"),{recursive:true});
for(const [path,html] of rendered){const destination=resolve(output,path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,html);}
// Flat names keep every diagram under the origin's plain /assets/<name>.<ext> rule.
for(const diagram of diagrams)writeFileSync(resolve(output,"assets",`diagram-${diagram.id}.svg`),diagram.svg);
cpSync(resolve(siteRoot,"kurami-fox-transparent.png"),resolve(output,"assets/fox.png"));
cpSync(resolve(siteRoot,"kurami-fox-header.webp"),resolve(output,"assets/fox.webp"));
cpSync(resolve(siteRoot,"kurami-favicon.svg"),resolve(output,"assets/favicon.svg"));
for(const font of fontFiles)cpSync(resolve(root,"src/ui-library/assets/fonts",font.file),resolve(output,"assets",font.file));
for(const file of readdirSync(resolve(root,"src/human-docs/assets")))if(/^shot-[a-z0-9-]+\.png$/.test(file))cpSync(resolve(root,"src/human-docs/assets",file),resolve(output,"assets",file));
writeFileSync(resolve(output,"assets/docs.css"),DOCS_STYLES);
writeFileSync(resolve(output,"assets/theme.js"),THEME_RUNTIME_JS);
writeFileSync(resolve(output,"build.json"),JSON.stringify({revision:revision??null,docsSha,mode:isPreview?"preview":"release",pages:rendered.length},null,2));
if(!existsSync(resolve(output,"en/index.html")))throw new Error("Docs build produced no home page");
console.log(`Built ${rendered.length} pages and ${diagrams.length} diagrams into ${output} (${revision??(isDocsRelease?"docs-only release; no verified app deploy":"unpublished preview")})`);
