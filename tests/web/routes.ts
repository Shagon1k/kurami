import assert from "node:assert/strict";
import {resolveWebRoute,publicAppUrl} from "../../src/web/routes.ts";
import {projectDocument,projectHtml,projectCss} from "../../src/web/presentation.ts";
import {VIEWPORT_META} from "../../src/ui-library/patterns/page-shell.ts";

for(const [url,expected] of [
  ["/",{redirect:"/en/"}],
  ["/en/",{app:"hub",language:"en",upstream:"/en/"}],
  ["/ru/",{app:"hub",language:"ru",upstream:"/ru/"}],
  ["/en/docs",{redirect:"/en/docs/"}],
  ["/en/docs/projects/?q=x",{app:"docs",language:"en",upstream:"/en/projects/?q=x"}],
  ["/ru/projects/?project=pickflick&lang=en",{app:"projects",language:"ru",upstream:"/?project=pickflick&lang=ru"}],
  ["/en/digest/cinema/",{app:"digest",language:"en",upstream:"/en/cinema"}],
  ["/ru/digest/weekly",{app:"digest",language:"ru",upstream:"/ru/weekly"}],
  ["/en/digest/stocks?period=1m",{app:"digest",language:"en",upstream:"/en/stocks?period=1m"}],
  ["/_apps/projects/api/fragment?lang=ru",{app:"projects",language:"ru",upstream:"/api/fragment?lang=ru"}],
] as const)assert.deepEqual(resolveWebRoute(url),expected,url);
for(const path of ["//evil","/en/docs/../projects/","/en/%2e%2e/projects/","/_apps/docs/assets/../../build.json","/en/%2fprojects/","/en/%252fprojects/","/en/\\projects/","/_apps/docs/build.json","/_apps/docs/health","/en/projects/private/"])assert.equal(resolveWebRoute(path),null,path);
assert.equal(publicAppUrl("https://hermes.shagon1k.win/","hub","ru"),"https://hermes.shagon1k.win/");
assert.equal(publicAppUrl("https://kurami.shagon1k.win/en/projects/?project=x","docs","en"),"/en/projects/?project=x");
assert.equal(publicAppUrl("https://docs.shagon1k.win/en/projects/#run","hub","ru"),"/en/docs/projects/#run");
assert.equal(publicAppUrl("/?lang=ru&project=pickflick","projects","en"),"/ru/projects/?project=pickflick");
assert.equal(publicAppUrl("/assets/docs.css?v=abc","docs","en"),"/_apps/docs/assets/docs.css?v=abc");
const html='<html><head><style>@font-face{src:url("/assets/font.woff2")}</style><script src="/assets/theme.js"></script></head><body><a href="/en/projects/">Own Docs article</a><a href="https://projects.shagon1k.win/?lang=ru&amp;project=pickflick">Other app</a><script type="application/json">{"original":"/assets/original.png"}</script><code>&lt;a href="/en/original/"&gt;</code></body></html>';
const projected=projectDocument(html,"docs","en");
assert(projected.includes('href="/en/docs/projects/"'));
assert(projected.includes('href="/ru/projects/?project=pickflick"'));
assert(projected.includes('src="/_apps/docs/assets/theme.js"'));
assert(projected.includes('src:url("/_apps/docs/assets/font.woff2")'));
assert(projected.includes('"original":"/assets/original.png"'));
assert(projected.includes('&lt;a href="/en/original/"&gt;'));
assert.equal(projectDocument(projected,"docs","en"),projected);
assert.ok(projected.includes(VIEWPORT_META),"mounted documents get the shared edge-to-edge viewport");
assert.ok(projectDocument('<html><head><meta name="viewport" content="width=device-width"></head></html>',"digest","ru").includes(VIEWPORT_META),"retained mounted HTML is upgraded");
assert.equal(projectDocument('<main>Fragment</main>',"projects","en"),'<main>Fragment</main>');
for(const native of ['<link rel="manifest" href="/en/manifest.webmanifest">',"<link href='/old.json' rel='manifest'>",'<link rel="manifest" href="/a"><link rel="manifest" href="/b">']){
  const result=projectDocument(`<html><head>${native}</head></html>`,"hub","en");
  assert.equal((result.match(/rel="manifest"/g)??[]).length,1);
  assert.match(result,/href="\/manifest.webmanifest" crossorigin="use-credentials"/);
  assert.equal(projectDocument(result,"hub","en"),result);
}
assert.equal(projectCss('url(/assets/font.woff2)',"hub","en"),'url(/_apps/hub/assets/font.woff2)');
assert.equal(projectHtml('<a href="/?q=a&amp;project=b&amp;lang=ru">Task</a>',"projects","en"),'<a href="/ru/projects/?q=a&amp;project=b">Task</a>');
assert.equal(projectHtml('<meta http-equiv="refresh" content="0; url=/en/new-page/">',"docs","en"),'<meta http-equiv="refresh" content="0; url=/en/docs/new-page/">');
assert.equal(projectHtml('<div data-src="/original/source" data-href="/original/link"></div>',"docs","en"),'<div data-src="/original/source" data-href="/original/link"></div>');
const responsive='<img src="/assets/kurami-idle.webp" srcset="/assets/kurami-idle.webp 320w, /assets/kurami-idle-hd.png 1024w">';
const mountedResponsive=projectHtml(responsive,"hub","ru");
assert.equal(mountedResponsive,'<img src="/_apps/hub/assets/kurami-idle.webp" srcset="/_apps/hub/assets/kurami-idle.webp 320w, /_apps/hub/assets/kurami-idle-hd.png 1024w">');
assert.equal(projectHtml(mountedResponsive,"hub","ru"),mountedResponsive);
assert.deepEqual(resolveWebRoute("/_apps/hub/assets/kurami-idle-hd.png"),{app:"hub",language:"en",upstream:"/assets/kurami-idle-hd.png"});
assert.deepEqual(resolveWebRoute("/_apps/hub/api/portal-voice?key=test&lang=ru"),{app:"hub",language:"ru",upstream:"/api/portal-voice?key=test&lang=ru"});
assert.equal(resolveWebRoute("/en/#fake-route"),null);
console.log("Unified routes: locale, app boundaries, query preservation, archive projection and traversal rejection verified");
