import {cpSync,existsSync,mkdirSync,readdirSync,rmSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {pages} from "./content.ts";
import {assertContent} from "./content/schema.ts";
import {readDeploymentManifest,changesForDeployedSha,assertDocsSourceMatchesDeployment,type Language} from "./changelog.ts";
import {renderArticle,renderChangelog,renderHome} from "./render.ts";
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
assertContent(pages,root);
const paths=new Set(pages.map(page=>page.slug));
const changes=revision?({en:changesForDeployedSha(revision,"en"),ru:changesForDeployedSha(revision,"ru")}):{en:[],ru:[]};
for(const lang of ["en","ru"] as Language[])for(const change of changes[lang])if(change.page&&!paths.has(change.page))throw new Error(`Changelog links to missing route: ${change.page}`);
// Validate everything before replacing a previous build; a failed release gate leaves it untouched.
const rendered: [string,string][]=[];
for(const lang of ["en","ru"] as Language[]){
  rendered.push([`${lang}/index.html`,renderHome(lang)]);
  for(const page of pages)rendered.push([`${lang}/${page.slug}/index.html`,renderArticle(page,lang,sourceSha,Boolean(revision))]);
  rendered.push([`${lang}/changelog/index.html`,renderChangelog(lang,changes[lang],revision,!isPreview)]);
}
for(const [path,html] of rendered){
  const links=[...html.matchAll(/href\s*=\s*["']\/(en|ru)\/([a-z0-9/-]*)["']/g)];
  for(const [, ,slug] of links)if(slug&&slug!=="changelog/"&&!paths.has(slug.replace(/\/$/,"")))throw new Error(`Broken internal route ${slug} in ${path}`);
}
for(const lang of ["en","ru"])for(const diagram of ["system-map","daily-publication","project-run-state","recovery-topology","project-path"])if(!existsSync(resolve(root,"src/human-docs/assets",`${diagram}-${lang}.svg`)))throw new Error(`Missing ${lang} ${diagram} SVG`);
rmSync(output,{recursive:true,force:true});
mkdirSync(resolve(output,"assets"),{recursive:true});
for(const [path,html] of rendered){const destination=resolve(output,path);mkdirSync(dirname(destination),{recursive:true});writeFileSync(destination,html);}
cpSync(resolve(siteRoot,"kurami-fox-transparent.png"),resolve(output,"assets/fox.png"));
cpSync(resolve(siteRoot,"kurami-favicon.svg"),resolve(output,"assets/favicon.svg"));
for(const font of fontFiles)cpSync(resolve(root,"src/ui-library/assets/fonts",font.file),resolve(output,"assets",font.file));
for(const lang of ["en","ru"])for(const diagram of ["system-map","daily-publication","project-run-state","recovery-topology","project-path"])cpSync(resolve(root,"src/human-docs/assets",`${diagram}-${lang}.svg`),resolve(output,"assets",`${diagram}-${lang}.svg`));
for(const file of readdirSync(resolve(root,"src/human-docs/assets")))if(/^shot-[a-z0-9-]+\.png$/.test(file))cpSync(resolve(root,"src/human-docs/assets",file),resolve(output,"assets",file));
writeFileSync(resolve(output,"assets/docs.css"),DOCS_STYLES);
writeFileSync(resolve(output,"assets/theme.js"),THEME_RUNTIME_JS);
writeFileSync(resolve(output,"build.json"),JSON.stringify({revision:revision??null,docsSha,mode:isPreview?"preview":"release",pages:rendered.length},null,2));
console.log(`Built ${rendered.length} pages into ${output} (${revision??(isDocsRelease?"docs-only release; no verified app deploy":"unpublished preview")})`);
