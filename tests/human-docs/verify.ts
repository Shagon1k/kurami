import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {pages} from "../../src/human-docs/content.ts";
import {digestNavigation} from "../../src/human-docs/content/digest.ts";
import {assertContent,type HumanDocsBlock,type HumanDocsPage} from "../../src/human-docs/content/schema.ts";
import {changesForDeployedSha,readDeploymentManifest,assertDocsSourceMatchesDeployment,onlyDocsPackageScriptsChanged,onlyDocsWorkflowChanged} from "../../src/human-docs/changelog.ts";
import {renderArticle,renderChangelog,renderHome} from "../../src/human-docs/render.ts";
import {DOCS_STYLES} from "../../src/human-docs/styles.ts";
import {assertSyntheticFixture,syntheticDailyHtml} from "../../src/human-docs/fixtures/synthetic-daily.ts";
import {INTEREST_POLICY} from "../../src/briefing/interest-profile.ts";
import {evaluateDocsImpact} from "./impact.ts";

const productChange=["src/briefing/weekly/lifecycle.ts"];
assert.match(evaluateDocsImpact(productChange,"").join(" "),/Docs-Impact/);
assert.match(evaluateDocsImpact(productChange,"Docs-Impact: none\nDocs-Reason: moved code").join(" "),/specific/);
assert.deepEqual(evaluateDocsImpact(productChange,"Docs-Impact: none\nDocs-Reason: Pure module extraction with no intended change to Weekly behavior."),[]);
assert.match(evaluateDocsImpact(productChange,"Docs-Impact: updated\nChangelog-EN: Weekly retries failed counters.\nChangelog-RU: Weekly повторяет запись счётчиков.").join(" "),/digest/);
assert.deepEqual(evaluateDocsImpact([...productChange,"src/human-docs/content/digest.ts"],"Docs-Impact: updated\nChangelog-EN: Weekly retries failed counters.\nChangelog-RU: Weekly повторяет запись счётчиков."),[]);
assert.match(evaluateDocsImpact(["src/orchestrator/runtime/controller.ts","src/briefing/weekly/lifecycle.ts","src/human-docs/content/projects.ts"],"Docs-Impact: updated\nChangelog-EN: Runs and Weekly changed.\nChangelog-RU: Изменены запуски и Weekly.").join(" "),/digest/);
assert.deepEqual(evaluateDocsImpact(["src/human-docs/styles.ts"],""),[]);
assert.deepEqual(evaluateDocsImpact([".github/workflows/regression.yml"],""),[]);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{check:"tsc"}},{scripts:{check:"tsc","docs:preview":"node build.ts","test:docs:browser":"node browser.ts"}}),true);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{"test:docs":"node old.ts",check:"tsc"}},{scripts:{"test:docs":"node new.ts",check:"tsc"}}),true);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{"test:product":"node old.ts",check:"tsc"}},{scripts:{"test:product":"node new.ts",check:"tsc"}}),false);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{check:"tsc"}},{scripts:{check:"tsc --noEmit","docs:preview":"node build.ts"}}),false);
assert.equal(onlyDocsPackageScriptsChanged({scripts:{check:"tsc"},dependencies:{foo:"1"}},{scripts:{check:"tsc"},dependencies:{foo:"2"}}),false);
const regressionWorkflow="      - run: npm ci\n      - run: npm test";
const withDocsGate="      - run: npm ci\n      - if: github.event_name == 'pull_request'\n        run: node tests/human-docs/impact.ts\n      - run: npm test";
assert.equal(onlyDocsWorkflowChanged(regressionWorkflow,withDocsGate),true);
assert.equal(onlyDocsWorkflowChanged(regressionWorkflow,withDocsGate.replace("npm test","npm run check")),false);

// Keep diagram connectors between cards and reserve space below prose maps.
assert.match(DOCS_STYLES,/\.architecture-map__path \{[^}]*gap: 24px/);
assert.match(DOCS_STYLES,/\.block \.system-map \{ margin-bottom: 24px; \}/);
assert.match(DOCS_STYLES,/\.table--stack table, \.table--stack tbody, \.table--stack tr, \.table--stack caption \{ display: block; width: 100%;/);
// Small accent labels on the light section background need the darker AA accent-text role.
assert.match(DOCS_STYLES,/:root \{[^}]*--text-accent: #c71410;/);
for(const lang of ["en","ru"] as const)for(const theme of ["light","dark"] as const){
  const fixture=syntheticDailyHtml(lang,theme);
  assert.doesNotThrow(()=>assertSyntheticFixture(fixture));
  assert.ok(fixture.includes(`lang="${lang}" data-theme="${theme}"`));
}
assert.throws(()=>assertSyntheticFixture('<html data-synthetic="true"><script src="https://example.org"></script></html>'),/network-isolated/);

const root=resolve(import.meta.dirname,"../..");
assert.doesNotThrow(()=>assertContent(pages,root));
assert.ok(readFileSync(resolve(root,"docs/interest-profile-v1.md"),"utf8")
  .includes(`base = -${INTEREST_POLICY.positionStep} × zero-based index`));
assert.equal(pages.length,29);
assert.deepEqual(pages.filter(page=>page.section==="digest").map(page=>page.slug),[
  "daily","for-me","daily-addons","signals","daily-lifecycle","weekly","cinema",
  "stocks","stocks-discovery","investment-review","weekly-cinema","stocks-review",
]);
const digestNavSlugs=digestNavigation.flatMap(group=>group.slugs);
assert.equal(new Set(digestNavSlugs).size,digestNavSlugs.length);
assert.deepEqual(digestNavSlugs,["daily","for-me","daily-addons","signals","daily-lifecycle","weekly","cinema","stocks","stocks-discovery","investment-review"]);
const slugs=new Set(pages.map(p=>p.slug));
assert.equal(slugs.size,pages.length);
const validRoutes=new Set(["/en/","/ru/","/en/changelog/","/ru/changelog/",...pages.flatMap(page=>[`/en/${page.slug}/`,`/ru/${page.slug}/`])]);
for(const page of pages){
  assert.equal(page.blocks.filter(block=>block.type==="diagram"||block.type==="html"&&block.visual).length,1,`${page.slug} has one explicit visual`);
  assert.equal(page.blocks.filter(block=>block.type==="details"||block.type==="technical").length,1,`${page.slug} has one inline disclosure`);
}
const invalidContent=(change:(copy:typeof pages)=>void)=>{
  const copy=structuredClone(pages);
  change(copy);
  return copy;
};
assert.throws(()=>assertContent(invalidContent(copy=>{copy[1].slug=copy[0].slug;})),/duplicate docs route/);
const firstHtml=(copy:typeof pages)=>copy[0].blocks[0] as Extract<HumanDocsBlock,{type:"html"}>;
assert.throws(()=>assertContent(invalidContent(copy=>{firstHtml(copy).ru="";})),/Empty ru block/);
assert.throws(()=>assertContent(invalidContent(copy=>{firstHtml(copy).en='<p><script>alert(1)</script></p>';})),/Unsafe or unstructured markup/);
assert.throws(()=>assertContent(invalidContent(copy=>{firstHtml(copy).en='<div data-visual="home-map"></div>';})),/Unsafe or unstructured markup/);
assert.throws(()=>assertContent(invalidContent(copy=>{firstHtml(copy).en='<a href="/ru/daily/">wrong locale</a>';})),/Wrong-language link/);
assert.throws(()=>assertContent(invalidContent(copy=>{firstHtml(copy).en="<a href='/ru/daily/'>wrong locale</a>";})),/Wrong-language link/);
assert.throws(()=>assertContent(invalidContent(copy=>{copy[0].sources=["../outside.md"];})),/Invalid docs source path/);
assert.throws(()=>assertContent(invalidContent(copy=>{copy[0].sources=["docs/not-a-real-doc.md"];}),root),/Missing docs source/);
const semanticFixture:HumanDocsPage={
  slug:"semantic-fixture",section:"understand",
  title:{en:"Fixture",ru:"Пример"},navTitle:{en:"Fixture",ru:"Пример"},summary:{en:"Semantic content",ru:"Структурированный контент"},
  blocks:[
    {type:"diagram",visual:"roles",explanation:{en:"The owner keeps the final decision.",ru:"Последнее решение остаётся за владельцем."}},
    {type:"table",caption:{en:"Ownership",ru:"Ответственность"},columns:{en:["Question","Owner"],ru:["Вопрос","Владелец"]},rows:{en:[["Decision","Human"]],ru:[["Решение","Человек"]]}},
    {type:"callout",tone:"limit",title:{en:"Limit",ru:"Ограничение"},body:{en:"No automatic merge.",ru:"Нет автоматического merge."}},
    {type:"example",synthetic:true,title:{en:"Sample run",ru:"Пример запуска"},body:{en:"A sample issue waits for review.",ru:"Вымышленная задача ждёт ревью."}},
    {type:"technical",summary:{en:"Technical detail",ru:"Техническая деталь"},body:{en:"A guard checks state.",ru:"Проверка сверяет состояние."},code:{en:"if (a < b) return;",ru:"if (a < b) return;"}},
    {type:"source-links",paths:["README.md"]},
  ],
};
assert.doesNotThrow(()=>assertContent([semanticFixture],root));
for(const lang of ["en","ru"] as const){
  const html=renderArticle(semanticFixture,lang,"a".repeat(40));
  assert.match(html,/<figure class="roles-map">/);
  assert.match(html,/<table><caption>/);
  assert.match(html,/<th scope="row">/);
  assert.match(html,/class="table__label" aria-hidden="true"/);
  assert.match(html,/class="callout callout--limit block"/);
  assert.ok(html.includes(lang==="en"?"Synthetic example":"Вымышленный пример"));
  assert.match(html,/<details class="disclosure disclosure--boxed technical">/);
  assert.ok(html.includes("a &lt; b"));
  assert.equal((html.match(/class="source-notes"/g)??[]).length,1);
}
const badSemantic=(change:(page:HumanDocsPage)=>void)=>{const copy=structuredClone(semanticFixture);change(copy);return [copy];};
assert.throws(()=>assertContent(badSemantic(page=>{(page.blocks[1] as Extract<HumanDocsBlock,{type:"table"}>).rows.ru[0].pop();})),/Invalid ru table/);
assert.throws(()=>assertContent(badSemantic(page=>{(page.blocks[1] as Extract<HumanDocsBlock,{type:"table"}>).rows.ru.push(["Другой","Человек"]);})),/Unmatched docs table translations/);
assert.throws(()=>assertContent(badSemantic(page=>{(page.blocks[0] as Extract<HumanDocsBlock,{type:"diagram"}>).explanation.ru="";})),/diagram explanation/);
assert.throws(()=>assertContent(badSemantic(page=>{(page.blocks[3] as Extract<HumanDocsBlock,{type:"example"}>).synthetic=false as true;})),/must be synthetic/);
assert.throws(()=>assertContent(badSemantic(page=>{(page.blocks[5] as Extract<HumanDocsBlock,{type:"source-links"}>).paths=["../secret"];})),/Invalid docs source path/);
assert.throws(()=>assertContent(badSemantic(page=>{page.sources=["README.md"];})),/Duplicate docs source links/);
const assertInternalLinks=(html:string)=>{
  for(const match of html.matchAll(/<a [^>]*href="([^"]+)"/g)){
    if(match[1].startsWith("/"))assert.ok(validRoutes.has(match[1]),`Unknown internal docs route: ${match[1]}`);
  }
};
for(const page of pages){
  for(const lang of ["en","ru"] as const){
    assert.ok(page.title[lang]&&page.navTitle?.[lang]&&page.summary[lang]);
    assert.doesNotMatch(JSON.stringify({title:page.title[lang],navTitle:page.navTitle[lang],summary:page.summary[lang],blocks:page.blocks}),/\bAlex\b|Л[её]ш[а-яё]*|09:00|10:00|Вильнюс|Vilnius|Схема поведения, не реальный API|Conceptual rule, not a callable API/i);
    const html=renderArticle(page,lang);
    assert.match(html,new RegExp(`<html lang="${lang}"`));
    if(!["weekly-cinema","stocks-review"].includes(page.slug))assert.ok(html.includes(`/${lang}/${page.slug}/`));
    assert.ok(html.includes(`/${lang==="en"?"ru":"en"}/${page.slug}/`));
    assert.ok(!html.includes("data-visual="),`Unrendered visual in ${page.slug}`);
    assert.equal((html.match(/<figure class=/g)??[]).length+(html.match(/<div class="visual">/g)??[]).length,1,`${page.slug}/${lang} must have one purposeful visual`);
    assertInternalLinks(html);
    if(page.slug==="for-me"){
      assert.ok(page.navTitle[lang].includes(lang==="ru"?"новости":"news order"));
      assert.ok(page.summary[lang].includes(lang==="ru"?"новостей Daily":"Daily news stories"));
    }
    if(page.slug==="daily"){
      const sidebar=html.match(/<nav class="side"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
      assert.ok(sidebar);
      assert.ok(sidebar.includes(lang==="ru"?"<h3>Рынки</h3>":"<h3>Markets</h3>"));
      assert.ok(sidebar.indexOf(`/${lang}/for-me/`)<sidebar.indexOf(`/${lang}/weekly/`));
      assert.ok(sidebar.indexOf(`/${lang}/weekly/`)<sidebar.indexOf(`/${lang}/cinema/`));
      assert.ok(sidebar.indexOf(`/${lang}/cinema/`)<sidebar.indexOf(`/${lang}/stocks/`));
      assert.ok(!sidebar.includes(`/${lang}/weekly-cinema/`));
      assert.ok(!sidebar.includes(`/${lang}/stocks-review/`));
    }
    if(page.slug==="project-orchestrator"){
      assert.match(html,/<figure class="architecture-map">[\s\S]*?<ol class="architecture-map__path">/);
      assert.equal((html.match(/class="architecture-map__outcomes"/g)??[]).length,1);
      assert.ok(html.includes("docs/technical-reference.md"));
      assert.ok(html.includes(lang==="ru"?"Безопасная остановка":"Safe stop"));
      assert.ok(html.includes(lang==="ru"?"Где искать намерение, состояние и подтверждение":"Where to look for intent, state and proof"));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,5);
      assert.ok(html.includes(`/${lang}/project-digest/`));
    }
    if(page.slug==="project-digest"){
      assert.match(html,/<figure class="project-digest-map">/);
      assert.equal((html.match(/class="project-digest-map__paths"/g)??[]).length,1);
      assert.ok(html.includes(lang==="ru"?"Принятое предложение всё ещё может конфликтовать":"An accepted proposal can still conflict"));
      assert.ok(html.includes(lang==="ru"?"Accept записывает решение в SQLite":"Accept records your decision in SQLite"));
    }
    if(page.slug==="daily-lifecycle"){
      assert.match(html,new RegExp(`<figure class="scene-map">[\\s\\S]*?<svg class="diagram" aria-label="[^"]+"[^>]*role="img"[\\s\\S]*?id="daily-publication-${lang}-tip"`));
      assert.ok(html.includes(lang==="ru"?"Что проверять при сбое этапа":"What to check when a stage fails"));
      assert.ok(html.includes(lang==="ru"?"Успех планировщика — не успех Daily":"A scheduler success is not a Daily success"));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,3);
      const svg=readFileSync(resolve(root,`src/human-docs/assets/daily-publication-${lang}.svg`),"utf8");
      const scene=JSON.parse(readFileSync(resolve(root,`src/human-docs/diagrams/daily-publication-${lang}.excalidraw`),"utf8"));
      assert.equal(scene.type,"excalidraw");
      assert.match(svg,/<svg[^>]*viewBox="0 0 560 1100"/);
      assert.ok(svg.includes(lang==="ru"?"Сбой до публикации":"Before publication fails"));
      assert.ok(svg.includes(lang==="ru"?"Сбой уведомления":"Notification fails later"));
      assert.ok(page.sources?.includes("docs/daily-briefing-runtime.md"));
    }
    if(page.slug==="who-does-what"){
      assert.match(html,/<figure class="roles-map">/);
      assert.equal((html.match(/class="roles-map__card"/g)??[]).length,3);
      for(const role of ["Hermes",lang==="ru"?"Курами":"Kurami","Codex"])assert.ok(html.includes(role));
      assert.ok(html.includes(lang==="ru"?"Вымышленный пример":"Synthetic example"));
      assert.ok(html.includes(lang==="ru"?"Точный head SHA":"exact head SHA"));
    }
    if(page.slug==="reading-state"){
      assert.match(html,/<figure class="state-legend">/);
      assert.equal((html.match(/<dt>/g)??[]).length,6);
      assert.ok(html.includes(lang==="ru"?"Ждёт владельца":"Awaiting owner"));
    }
    if(page.slug==="what-is-kurami"){
      assert.match(html,/<figure class="system-map">/);
      assert.equal((html.match(/class="system-map__path"/g)??[]).length,2);
      assert.equal((html.match(/class="system-map__products"/g)??[]).length,1);
      assert.ok(html.includes(lang==="ru"?"Решение владельца":"Owner decision"));
    }
    if(page.slug==="system-map"){
      assert.match(html,new RegExp(`<figure class="scene-map">[\\s\\S]*?<svg class="diagram" aria-label="[^"]+"[^>]*role="img"[\\s\\S]*?id="system-map-${lang}-tip"`));
      assert.ok(html.includes(lang==="ru"?"У каждого процесса своё состояние":"Each workflow keeps its own state"));
      assert.equal(page.blocks.some(block=>block.type==="table"),false);
      const svg=readFileSync(resolve(root,`src/human-docs/assets/system-map-${lang}.svg`),"utf8");
      const scene=JSON.parse(readFileSync(resolve(root,`src/human-docs/diagrams/system-map-${lang}.excalidraw`),"utf8"));
      assert.equal(scene.type,"excalidraw");
      assert.match(svg,/<svg[^>]*viewBox="0 0 560 1000"/);
      assert.ok(svg.includes(lang==="ru"?"Два входа · три процесса":"Two ways in · three workflows"));
      assert.ok(svg.includes(lang==="ru"?"Агент — только если нужен":"An agent only when needed"));
      assert.ok(!scene.elements.some((element:{id?:string})=>element.id==="owner-box"||element.id==="branch-to-owner"));
      for(const label of ["Digest","Project Orchestrator","Operations"])assert.ok(svg.includes(label)&&scene.elements.some((element:{text?:string})=>element.text===label));
    }
    if(page.slug==="daily"||page.slug==="weekly-cinema"||page.slug==="stocks-review"){
      assert.match(html,/<figure class="comparison-map">/);
      assert.equal((html.match(/class="comparison-map__card"/g)??[]).length,2);
    }
    if(page.slug==="daily"){
      assert.ok(html.includes(lang==="ru"?"Вымышленный пример":"Synthetic example"));
      assert.ok(html.includes(lang==="ru"?"а не расписание Курами":"not Kurami’s configured schedule"));
    }
    if(page.slug==="daily-addons"){
      assert.ok(html.includes(lang==="ru"?"Кому принадлежит каждый блок Daily":"Who owns each Daily section"));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,4);
    }
    if(page.slug==="weekly-cinema"){
      assert.ok(html.includes(lang==="ru"?"Два результата — две границы принятия":"Two outcomes, two acceptance boundaries"));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"Поздний сбой Daily не откатывает":"A later Daily failure does not roll Cinema back"));
    }
    if(page.slug==="weekly"){
      assert.ok(html.includes(lang==="ru"?"Пять дней — не семь":"Five days are not seven"));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,4);
      assert.ok(html.includes("/preview/weekly"));
    }
    if(page.slug==="cinema"){
      assert.ok(html.includes(lang==="ru"?"Может ли новый Cinema заменить страницу?":"Can a new Cinema candidate replace the page?"));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"Остались два блока":"Two sections survive"));
    }
    if(page.slug==="stocks"){
      assert.ok(html.includes(lang==="ru"?"Одна котировка, два разных числа":"One quote, two kinds of number"));
      assert.ok(page.sources?.includes("docs/charts.md"));
      assert.ok(html.includes(lang==="ru"?"свой масштаб":"its own scale"));
    }
    if(page.slug==="stocks-discovery"){
      assert.ok(html.includes(lang==="ru"?"Заметное движение может не пройти сверку":"A mover can fail verification"));
      assert.ok(html.includes(lang==="ru"?"четырёх календарных дней":"four calendar days"));
      assert.ok(page.sources?.includes("src/briefing/stocks/discovery-model.ts"));
    }
    if(page.slug==="investment-review"){
      assert.ok(html.includes(lang==="ru"?"Что означает состояние отчёта":"What each report state means"));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"не доказывают верность каждого аналитического вывода":"do not prove every research judgment correct"));
    }
    if(["signals","weekly","cinema","stocks","stocks-discovery","investment-review"].includes(page.slug)){
      assert.match(html,/<figure class="digest-map">/);
      assert.equal((html.match(/<dt>|<li><span class="folio">0[1-3]<\/span>/g)??[]).length,3);
    }
    if(page.slug==="for-me"){
      assert.match(html,/<figure class="order-map">/);
      assert.equal((html.match(/class="order-map__column"/g)??[]).length,2);
      assert.ok(html.includes(lang==="ru"?"десяти активных реакций":"ten active reactions"));
      assert.ok(html.includes(lang==="ru"?"Девять, десять, снова девять":"Nine, ten, then nine"));
      assert.ok(html.includes(lang==="ru"?"Старые реакции без сведений об источнике":"Older reactions without source context"));
    }
    if(page.slug==="signals"){
      assert.ok(html.includes(lang==="ru"?"Свежий Calendar, устаревший Mail":"Fresh Calendar, stale Mail"));
      assert.ok(html.includes(lang==="ru"?"Calendar завтра":"tomorrow’s Calendar"));
      assert.ok(html.includes(lang==="ru"?"без скрипта она остаётся скрытой":"without browser script it stays hidden"));
    }
    if(page.slug==="project-admission"){
      assert.match(html,/<figure class="admission-map">/);
      assert.equal((html.match(/class="admission-map__status"/g)??[]).length,1);
      assert.equal((html.match(/class="admission-map__gates"/g)??[]).length,1);
      for(const status of ["PASS","WARN","FAIL"])assert.ok(html.includes(status));
      assert.equal((html.match(/<li><span class="folio">0[1-4]<\/span>/g)??[]).length,4);
      assert.ok(html.includes(lang==="ru"?"Активная задача — ещё не новое событие":"An active item is not a new event"));
      assert.ok(html.includes("admission_pending"));
      assert.ok(html.includes(lang==="ru"?"лимит Codex-сессий проверяется при старте":"Codex session capacity is enforced when"));
    }
    if(page.slug==="run-lifecycle"){
      assert.match(html,new RegExp(`<figure class="scene-map">[\\s\\S]*?<svg class="diagram" aria-label="[^"]+"[^>]*role="img"[\\s\\S]*?id="project-run-state-${lang}-tip"`));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,4);
      assert.ok(html.includes(lang==="ru"?"Состояние Review-ready требует освобождения CLI":"Review-ready requires CLI release"));
      const svg=readFileSync(resolve(root,`src/human-docs/assets/project-run-state-${lang}.svg`),"utf8");
      const scene=JSON.parse(readFileSync(resolve(root,`src/human-docs/diagrams/project-run-state-${lang}.excalidraw`),"utf8"));
      assert.equal(scene.type,"excalidraw");
      assert.match(svg,/<svg[^>]*viewBox="0 0 560 1210"/);
      assert.ok(scene.elements.some((element:{id?:string})=>element.id==="cancel-stop"));
      assert.ok(scene.elements.some((element:{id?:string})=>element.id==="unsafe-stop"));
      assert.ok(svg.includes(lang==="ru"?"Нужен разбор":"Needs attention"));
    }
    if(page.slug==="engineering-evidence"){
      assert.match(html,/<figure class="project-cards">/);
      assert.equal((html.match(/class="project-cards__card"/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"Не является deploy":"Is not a deployment"));
      assert.ok(html.includes(lang==="ru"?"Новый коммит — новая проверка":"A new commit changes the question"));
      assert.ok(html.includes(lang==="ru"?"отметку владельца":"owner’s <strong>Mark reviewed"));
    }
    if(page.slug==="owner-controls"){
      assert.match(html,/<figure class="sample-run-card">/);
      assert.ok(html.includes(lang==="ru"?"Вымышленная карточка Discord":"Synthetic Discord card"));
      assert.equal((html.match(/class="sample-run-card__action"/g)??[]).length,1);
      assert.equal((html.match(/<th scope="row">/g)??[]).length,4);
      assert.ok(html.includes(lang==="ru"?"Запрос, выполнение и итог — разные события":"Request, execution and result are separate events"));
    }
    if(page.slug==="health"){
      assert.match(html,/<figure class="health-map">/);
      assert.ok(html.includes(lang==="ru"?"Вымышленная карточка System Health":"Synthetic System Health card"));
      assert.equal((html.match(/class="health-map__groups"/g)??[]).length,1);
      assert.equal((html.match(/<th scope="row">/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"три последовательные":"three consecutive"));
    }
    if(page.slug==="recovery"){
      assert.match(html,new RegExp(`<figure class="scene-map">[\\s\\S]*?<svg class="diagram" aria-label="[^"]+"[^>]*role="img"[\\s\\S]*?id="recovery-topology-${lang}-tip"`));
      assert.equal((html.match(/<th scope="row">/g)??[]).length,4);
      const svg=readFileSync(resolve(root,`src/human-docs/assets/recovery-topology-${lang}.svg`),"utf8");
      const scene=JSON.parse(readFileSync(resolve(root,`src/human-docs/diagrams/recovery-topology-${lang}.excalidraw`),"utf8"));
      assert.equal(scene.type,"excalidraw");
      assert.match(svg,/<svg[^>]*viewBox="0 0 560 940"/);
      assert.ok(scene.elements.some((element:{id?:string})=>element.id==="backup-offsite"));
      assert.ok(scene.elements.some((element:{id?:string})=>element.id==="backup-host"));
      assert.ok(svg.includes(lang==="ru"?"Не копируется":"Not copied"));
      assert.ok(html.includes(lang==="ru"?"Локальный зашифрованный архив":"A local encrypted bundle alone"));
    }
    if(page.slug==="automation-boundaries"){
      assert.match(html,/<figure class="boundary-map">/);
      assert.equal((html.match(/class="boundary-map__card"/g)??[]).length,3);
      assert.equal((html.match(/<th scope="row">/g)??[]).length,4);
      assert.ok(html.includes(lang==="ru"?"данными, а не инструкциями":"data, not instructions"));
    }
    if(page.slug==="scheduling"){
      assert.match(html,/<figure class="schedule-evidence">/);
      assert.equal((html.match(/<th scope="row">/g)??[]).length,4);
      assert.ok(html.includes(lang==="ru"?"Таймер сработал, но копия не завершена":"The timer ran; the backup did not finish"));
    }
    if(page.slug==="maintenance"){
      assert.match(html,/<figure class="maintenance-scope">/);
      assert.equal((html.match(/class="maintenance-scope__column maintenance-scope__column--/g)??[]).length,2);
      assert.equal((html.match(/<th scope="row">/g)??[]).length,3);
      assert.ok(html.includes(lang==="ru"?"без <code>--apply</code>":"without <code>--apply</code>"));
    }
    if(page.slug==="connector-authority"){
      assert.match(html,/<figure class="connector-contours">/);
      assert.equal((html.match(/<th scope="row">/g)??[]).length,3);
      for(const contour of ["composio-read","composio-automation","composio"])assert.ok(html.includes(contour));
      assert.ok(html.includes(lang==="ru"?"Hosted MCP сам не проверяет":"Hosted MCP does not enforce"));
    }
  }
}
for(const lang of ["en","ru"] as const){
  const page=pages.find(page=>page.slug==="system-map")!;
  const sha="a".repeat(40);
  const html=renderArticle(page,lang,sha);
  assert.ok(html.includes(`https://github.com/Shagon1k/kurami/blob/${sha}/README.md`));
  assert.ok(html.includes(lang==="ru"?"не доказательство развёртывания":"does not prove application deployment"));
  const deployed=renderArticle(page,lang,sha,true);
  assert.ok(deployed.includes(lang==="ru"?"подтверждённой версии приложения":"verified application revision"));
}
for(const lang of ["en","ru"] as const){
  const sha="a".repeat(40);
  for(const page of pages.filter(page=>page.section==="digest")){
    assert.ok(page.sources?.length,`${page.slug} needs source anchors`);
    const html=renderArticle(page,lang,sha);
    for(const path of page.sources??[])assert.ok(html.includes(`https://github.com/Shagon1k/kurami/blob/${sha}/${path}`));
    assert.ok(html.includes(lang==="ru"?"не доказательство развёртывания":"does not prove application deployment"));
  }
  for(const slug of ["project-orchestrator","project-digest","project-admission","run-lifecycle","engineering-evidence","owner-controls"]){
    const page=pages.find(page=>page.slug===slug)!;
    assert.ok(page.sources?.length,`${slug} needs source anchors`);
    const html=renderArticle(page,lang,sha);
    for(const path of page.sources??[])assert.ok(html.includes(`https://github.com/Shagon1k/kurami/blob/${sha}/${path}`));
  }
  for(const page of pages.filter(page=>page.section==="operations")){
    assert.ok(page.sources?.length,`${page.slug} needs source anchors`);
    const html=renderArticle(page,lang,sha);
    for(const path of page.sources??[])assert.ok(html.includes(`https://github.com/Shagon1k/kurami/blob/${sha}/${path}`));
  }
}
for(const lang of ["en","ru"] as const){
  const html=renderHome(lang);
  assert.ok(html.includes("system-map__paths"));
  assert.equal((html.match(/class="system-map__path"/g)??[]).length,2);
  assert.ok(html.includes(lang==="ru"?"Решение владельца":"Owner decision"));
  assert.ok(html.includes("/assets/theme.js"));
  assert.ok(html.includes('class="site-menu"'));
  assert.ok(html.includes('class="site-nav"'));
  assert.ok(html.includes(`aria-label="${lang==="ru"?"Основная навигация":"Primary navigation"}"`));
  assert.ok(html.includes('id="main" class="container page" tabindex="-1"'));
  assert.ok(html.includes('data-theme-toggle')&&html.includes('aria-pressed="false"'));
  const sectionArticle=renderArticle(pages.find(page=>page.slug==="who-does-what")!,lang);
  assert.ok(sectionArticle.includes(`href="/${lang}/" aria-current="location"`));
  assert.ok(sectionArticle.includes(`aria-label="${lang==="ru"?"Разделы документации":"Documentation sections"}"`));
  const emptyChangelog=renderChangelog(lang,[]);
  assert.ok(!emptyChangelog.includes("github.com/Shagon1k/kurami/commit/"));
  assert.ok(emptyChangelog.includes(lang==="ru"?"намеренно оставляет changelog приложения пустым":"deliberately leaves the application changelog empty"));
  const previewStatus=lang==="ru"?"Версия развёртывания не указана":"No deployment revision was supplied";
  const changelogArticle=emptyChangelog.slice(emptyChangelog.indexOf("<article"),emptyChangelog.indexOf("</article>"));
  assert.equal(changelogArticle.split(previewStatus).length-1,1);
  assertInternalLinks(html);
  assertInternalLinks(emptyChangelog);
}
const scratch=mkdtempSync(join(tmpdir(),"kurami-docs-test-"));
try {
  const manifest=join(scratch,"deployment.json");
  const sha=execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim();
  writeFileSync(manifest,JSON.stringify({status:"succeeded",appSha:sha}));
  assert.equal(readDeploymentManifest(manifest),sha);
  if(execFileSync("git",["status","--porcelain"],{cwd:root,encoding:"utf8"}).trim())assert.throws(()=>assertDocsSourceMatchesDeployment(sha),/clean working tree/);
  writeFileSync(manifest,JSON.stringify({status:"failed",appSha:sha}));
  assert.throws(()=>readDeploymentManifest(manifest),/status=succeeded/);
  assert.throws(()=>changesForDeployedSha("596c877","en"),/40-character/);
  const changes=changesForDeployedSha("596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26","en");
  assert.equal(changes.length,3);
  assert.ok(changes.every(c=>slugs.has(c.page!)));
  const publishedDocsChanges=changesForDeployedSha("095b03fb0f40bf39b914fef13dfec4c1b8348f7b","en");
  assert.equal(publishedDocsChanges.length,7);
  assert.ok(publishedDocsChanges.some(c=>c.sha==="847a7248193d708f07886b02d4e397995624c75b"&&c.category==="new"));
  assert.ok(publishedDocsChanges.every(c=>!c.page||slugs.has(c.page)));
  const classifiedThroughHandoff=changesForDeployedSha("f06f8eb0c5c9857f8d0dd0fa14c172a215c04304","en");
  assert.equal(classifiedThroughHandoff.length,7);
  assert.ok(classifiedThroughHandoff.every(c=>c.sha!=="f06f8eb0c5c9857f8d0dd0fa14c172a215c04304"));
  const classifiedThroughAudit=changesForDeployedSha("6ae670a12f7224a4386677ef5dac8c2e07793b3f","en");
  const classifiedThroughAuditRu=changesForDeployedSha("6ae670a12f7224a4386677ef5dac8c2e07793b3f","ru");
  assert.equal(classifiedThroughAudit.length,15);
  assert.equal(classifiedThroughAuditRu.length,15);
  assert.deepEqual(classifiedThroughAudit.map(change=>change.sha),classifiedThroughAuditRu.map(change=>change.sha));
  assert.ok(classifiedThroughAudit.some(change=>change.sha==="94cfd0091a78ec6712f3e0794ceb4a21c2a03fbf"&&change.page==="weekly"));
  assert.ok(classifiedThroughAudit.every(change=>!change.page||slugs.has(change.page)));
  assert.ok(renderChangelog("en",publishedDocsChanges,"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("private bilingual Kurami documentation site"));
  assert.ok(renderChangelog("en",publishedDocsChanges,"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("List dates are commit days, not deployment days."));
  assert.ok(renderChangelog("ru",changesForDeployedSha("095b03fb0f40bf39b914fef13dfec4c1b8348f7b","ru"),"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("двуязычный сайт документации"));
  assert.ok(renderChangelog("ru",changesForDeployedSha("095b03fb0f40bf39b914fef13dfec4c1b8348f7b","ru"),"095b03fb0f40bf39b914fef13dfec4c1b8348f7b").includes("Даты в списке — дни коммитов, не дни развёртывания."));
  assert.ok(renderChangelog("en",changes,"596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26").includes("review stage requires"));
  assert.ok(renderChangelog("ru",changesForDeployedSha("596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26","ru"),"596c877dfa0f7d1a82bfaacfed1c1194fdbd6b26").includes("Изменения подтверждены"));
  assert.ok(renderChangelog("en",[],undefined,true).includes("Docs are published; no verified application deployment"));
  assert.ok(renderChangelog("ru",[],undefined,true).includes("Документация опубликована"));
  const built=resolve(root,"dist/human-docs");
  if(existsSync(built)) {
    assert.ok(!existsSync(join(built,"index.html")),"Root must redirect on the origin, not render a choice page");
    const metadata=JSON.parse(readFileSync(join(built,"build.json"),"utf8")) as {mode:string;revision:string|null;docsSha?:string|null};
    assert.ok(["preview","release"].includes(metadata.mode));
    if(metadata.mode==="preview") assert.ok(metadata.docsSha==null);
    else assert.match(metadata.docsSha??"",/^[0-9a-f]{40}$/);
    if(!metadata.revision)assert.ok(!readFileSync(join(built,"en/changelog/index.html"),"utf8").includes("review stage requires"));
  }
} finally {rmSync(scratch,{recursive:true,force:true});}
console.log(`Verified ${pages.length} bilingual docs pages, shared map, preview honesty and curated release gate`);
