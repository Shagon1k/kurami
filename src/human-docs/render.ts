import {surfaceAttributes} from "../ui-library/components/surface.ts";
import type {Change,Language} from "./changelog.ts";
import {allPages,homePage,pages,type HumanDocsPage} from "./content.ts";
import {aliases,groupLabels,groups,sectionLabels,sections,type Section} from "./content/site.ts";
import {assertSourcePath,walk} from "./content/schema.ts";
import {headingId,plainInline,renderInline,parseBlocks,wordCount,escapeText as escape,type Block} from "./markdown.ts";
import {renderDiagram} from "./diagrams/kit.ts";
import {generatedReference} from "./reference.ts";
import {renderLinkButton} from "../ui-library/components/button.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {type IconName} from "../ui-library/components/icon.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {renderSiteFooter} from "../ui-library/patterns/site-footer.ts";
import {kuramiSites} from "../ui-library/patterns/kurami-sites.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderCallout} from "../ui-library/components/callout.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {inlineDiagram} from "../ui-library/foundations/diagram.ts";
import {screenshotDimensions} from "./screenshot-dimensions.ts";
import {renderKuramiMood,renderKuramiPresence} from "../ui-library/components/kurami-mood.ts";
import {portalVoice} from "../portal-presence/voice.ts";

const REPO="https://github.com/Shagon1k/kurami";
const labels={
  en:{changelog:"Changelog",skip:"Skip to content",choose:"Switch to Russian",primaryNav:"Primary navigation",articleNav:"Documentation sections",toc:"On this page",next:"Next",min:"min read",glance:"At a glance",guarantees:"Guarantees",example:"Worked example",synthetic:"invented data",terms:"Key terms",codeMap:"Where it lives in the code",codeMapNote:"Source at revision",open:"Open full size",sections:"Sections",current:"Current state",
    latest:"Changes verified for deployed revision",unpublished:"No deployment revision was supplied. Changes are not claimed as live.",awaiting:"The application release history is not connected to a verified deployment.",source:"Commit",readPage:"Read the page",moved:"This page has moved"},
  ru:{changelog:"Изменения",skip:"К содержанию",choose:"Переключить на английский",primaryNav:"Основная навигация",articleNav:"Разделы документации",toc:"На странице",next:"Дальше",min:"мин чтения",glance:"Коротко",guarantees:"Гарантии",example:"Пример",synthetic:"вымышленные данные",terms:"Термины",codeMap:"Где это в коде",codeMapNote:"Исходники на версии",open:"Открыть в полный размер",sections:"Разделы",current:"Текущее состояние",
    latest:"Изменения подтверждены для развёрнутой версии",unpublished:"Версия развёртывания не указана. Изменения не заявлены как работающие.",awaiting:"Журнал изменений приложения не связан с подтверждённым развёртыванием.",source:"Коммит",readPage:"Открыть страницу",moved:"Страница переехала"},
} as const;

const url=(lang:Language,slug:string)=>`/${lang}/${slug&&slug!=="home"?slug+"/":""}`;
const pageBySlug=new Map(allPages.map(page=>[page.slug,page]));
const firstPage=(section:Section)=>pages.find(page=>page.section===section);
const resolveSlug=(slug:string)=>pageBySlug.has(slug)?slug:aliases[slug];

export type RenderOptions={sourceSha?:string;deployed?:boolean;root?:string;
  /** While pages are written in parallel, collect links to pages that do not exist yet instead of failing. */
  missingLinks?:string[]};
type Context={lang:Language;page:HumanDocsPage;options:RenderOptions;diagrams:{id:string;svg:string;excalidraw:string}[]};

function linkFor(context:Context){
  return (target:string)=>{
    if(target.startsWith("@")){
      const [slug,anchor]=target.slice(1).split("#");
      const resolved=resolveSlug(slug!);
      if(!resolved&&context.options.missingLinks){context.options.missingLinks.push(`${context.page.slug} → @${slug}`);return {href:`#missing-${slug}`};}
      if(!resolved)throw new Error(`${context.page.slug}: link to unknown page @${slug}`);
      return {href:`${url(context.lang,resolved)}${anchor?`#${anchor}`:""}`};
    }
    if(target.startsWith("repo:")){
      const [path,line]=target.slice(5).split("#");
      assertSourcePath(path!.replace(/\/$/,""),context.options.root);
      return {href:`${REPO}/${path!.endsWith("/")?"tree":"blob"}/${context.options.sourceSha??"main"}/${path!.replace(/\/$/,"")}${line?`#${line}`:""}`,external:true};
    }
    if(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(target))return {href:target,external:true};
    if(/^#[\p{L}\p{N}-]+$/u.test(target))return {href:target};
    throw new Error(`${context.page.slug}: unsupported link target ${target} (use @slug, repo:path, https:// or #anchor)`);
  };
}

const inline=(text:string,context:Context)=>renderInline(text,linkFor(context));

/** A list item that is a single paragraph renders inline, without a <p>. */
function itemHtml(item:Block[],context:Context):string {
  return item.length===1&&item[0]!.type==="paragraph"?inline(item[0]!.text,context):blocksHtml(item,context);
}

function splitLead(text:string):[string,string]|undefined {
  const match=text.match(/^\*\*(.+?)\*\*\s*[—:–-]\s*(.+)$/)??text.match(/^([^:—]{2,48}):\s+(.+)$/);
  return match?[match[1]!,match[2]!]:undefined;
}

function listItems(blocks:Block[],context:Context,name:string):Block[][] {
  const list=blocks[0];
  if(!list||list.type!=="list"||blocks.length!==1)throw new Error(`${context.page.slug}: :::${name} holds exactly one list`);
  return list.items;
}

const itemText=(item:Block[])=>item.length===1&&item[0]!.type==="paragraph"?item[0]!.text:"";

function container(block:Extract<Block,{type:"container"}>,context:Context):string {
  const t=labels[context.lang];
  const body=()=>blocksHtml(block.body,context);
  switch(block.name){
    case "note": case "warning": case "limit":
      return renderCallout({tone:block.name,title:block.args||undefined,body:{html:body()},className:"block"});
    case "glance": {
      const rows=listItems(block.body,context,"glance").map(item=>{
        const pair=splitLead(itemText(item));
        if(!pair)throw new Error(`${context.page.slug}: :::glance items are "Key: value"`);
        return `<div><dt>${inline(pair[0],context)}</dt><dd>${inline(pair[1],context)}</dd></div>`;
      }).join("");
      return `<section class="glance" aria-label="${escape(block.args||t.glance)}"><p class="glance__label">${escape(block.args||t.glance)}</p><dl>${rows}</dl></section>`;
    }
    case "guarantees":
      return `<section class="guarantees"><p class="guarantees__title">${escape(block.args||t.guarantees)}</p><ul>${listItems(block.body,context,"guarantees").map(item=>`<li>${itemHtml(item,context)}</li>`).join("")}</ul></section>`;
    case "example":
      return `<section class="example"><p class="example__label">${escape(t.example)} · ${escape(t.synthetic)}</p>${block.args?`<p class="example__title">${escape(block.args)}</p>`:""}${body()}</section>`;
    case "steps":
      return `<ol class="steps">${listItems(block.body,context,"steps").map(item=>{
        const text=item[0]?.type==="paragraph"?item[0].text:"";
        const pair=text.match(/^\*\*(.+?)\*\*\s*[:.—–-]?\s+(.+)$/);
        const rest=blocksHtml(item.slice(1),context);
        return `<li>${pair?`<span class="steps__actor">${inline(pair[1]!,context)}</span><p>${inline(pair[2]!,context)}</p>`:`<p>${inline(text,context)}</p>`}${rest}</li>`;
      }).join("")}</ol>`;
    case "compare": {
      const columns:{title:string;blocks:Block[]}[]=[];
      for(const inner of block.body){
        if(inner.type==="heading"&&inner.level===3)columns.push({title:inner.text,blocks:[]});
        else if(columns.length)columns.at(-1)!.blocks.push(inner);
        else throw new Error(`${context.page.slug}: :::compare starts with ### column headings`);
      }
      if(columns.length<2||columns.length>3)throw new Error(`${context.page.slug}: :::compare needs two or three ### columns`);
      return `<div class="compare compare--${columns.length}">${columns.map(column=>`<div class="compare__column"><p class="compare__title">${inline(column.title,context)}</p>${blocksHtml(column.blocks,context)}</div>`).join("")}</div>`;
    }
    case "cards":
      return `<ul class="cards">${listItems(block.body,context,"cards").map(item=>{
        const match=itemText(item).match(/^\[(.+?)\]\((@[a-z0-9-]+(?:#[\p{L}\p{N}-]+)?)\)\s*[—–-]?\s*(.*)$/u);
        if(!match)throw new Error(`${context.page.slug}: :::cards items are "[Title](@slug) — description"`);
        const href=linkFor(context)(match[2]!).href;
        const target=pageBySlug.get(resolveSlug(match[2]!.slice(1).split("#")[0]!)??"");
        const eyebrow=target&&target.slug!=="home"?`${groupLabels[target.group][context.lang]} · ${readingMinutes(target,context.lang)} ${t.min}`:"";
        return `<li><a class="card"${surfaceAttributes("panel")} href="${escape(href)}">${eyebrow?`<span class="card__eyebrow">${escape(eyebrow)}</span>`:""}<strong>${inline(match[1]!,context)}</strong>${match[3]?`<span class="card__text">${inline(match[3],context)}</span>`:""}</a></li>`;
      }).join("")}</ul>`;
    case "details":
      if(!block.args)throw new Error(`${context.page.slug}: :::details needs a summary`);
      return `<div class="block">${renderDisclosure({summary:block.args,body:body(),boxed:true})}</div>`;
    case "terms":
      return `<section class="terms"><p class="terms__label">${escape(block.args||t.terms)}</p><dl>${listItems(block.body,context,"terms").map(item=>{
        const pair=splitLead(itemText(item));
        if(!pair)throw new Error(`${context.page.slug}: :::terms items are "**term** — definition"`);
        return `<div><dt>${inline(pair[0],context)}</dt><dd>${inline(pair[1],context)}</dd></div>`;
      }).join("")}</dl></section>`;
    case "code-map": {
      const sha=context.options.sourceSha;
      const rows=listItems(block.body,context,"code-map").map(item=>{
        const match=itemText(item).match(/^`([^`]+)`\s*[—–-]\s*(.+)$/);
        if(!match)throw new Error(`${context.page.slug}: :::code-map items are "\`path\` — what it does"`);
        const path=match[1]!.replace(/\/$/,"");
        assertSourcePath(path,context.options.root);
        return `<li><a href="${REPO}/${match[1]!.endsWith("/")?"tree":"blob"}/${sha??"main"}/${escape(path)}" rel="noopener noreferrer"><code>${escape(match[1]!)}</code></a><span>${inline(match[2]!,context)}</span></li>`;
      }).join("");
      return `<aside class="code-map" aria-label="${escape(t.codeMap)}"><p class="code-map__title">${escape(block.args||t.codeMap)}</p>${sha?`<p class="code-map__note">${escape(t.codeMapNote)} <code>${sha.slice(0,12)}</code></p>`:""}<ul>${rows}</ul></aside>`;
    }
    default:
      throw new Error(`${context.page.slug}: unknown container :::${block.name}`);
  }
}

function leaf(block:Extract<Block,{type:"leaf"}>,context:Context):string {
  if(block.name==="shot"){
    const {file,size,alt,caption}=block.attrs;
    const {width,height}=screenshotDimensions(file!,context.options.root);
    return `<figure class="shot shot--${escape(size!)}"><a href="/assets/${escape(file!)}" class="shot__frame" aria-label="${escape(`${alt}. ${labels[context.lang].open}`)}"><img src="/assets/${escape(file!)}" alt="${escape(alt!)}" width="${width}" height="${height}" loading="lazy" decoding="async"></a><figcaption>${escape(caption!)}</figcaption></figure>`;
  }
  if(block.name==="generated")return `<div class="block generated">${generatedReference(block.attrs.name??"",context.lang)}</div>`;
  throw new Error(`${context.page.slug}: unknown directive ::${block.name}`);
}

function diagramHtml(source:string,context:Context):string {
  let rendered;
  try{rendered=renderDiagram(source);}catch(error){throw new Error(`${context.page.slug}/${context.lang}: ${(error as Error).message}`);}
  const id=`${context.page.slug}-${context.diagrams.length+1}-${context.lang}`;
  context.diagrams.push({id,svg:rendered.svg,excalidraw:rendered.excalidraw});
  return `<figure class="figure">${rendered.title?`<figcaption class="figure__title">${escape(rendered.title)}</figcaption>`:""}<div class="figure__scroll" role="region" tabindex="0" aria-label="${escape(rendered.title||rendered.desc.slice(0,80))}"><div class="figure__canvas" style="--figure-width:${Math.ceil(rendered.width)}">${inlineDiagram(rendered.svg,{id,label:rendered.desc})}</div></div><p class="figure__desc">${escape(rendered.desc)} <a href="/assets/diagram-${id}.svg">${escape(labels[context.lang].open)}</a></p></figure>`;
}

function blocksHtml(blocks:Block[],context:Context):string {
  // A table is named for screen readers by the nearest heading above it.
  let lastHeading=context.page.title[context.lang];
  return blocks.map(block=>{
    if(block.type==="heading")lastHeading=plainInline(block.text);
    switch(block.type){
      case "heading": {
        const id=headingId(block.text);
        return `<h${block.level} id="${escape(id)}">${inline(block.text,context)}</h${block.level}>`;
      }
      case "paragraph": return `<p>${inline(block.text,context)}</p>`;
      case "list": {
        const tag=block.ordered?"ol":"ul";
        return `<${tag}>${block.items.map(item=>`<li>${itemHtml(item,context)}</li>`).join("")}</${tag}>`;
      }
      case "table":
        return `<div class="block">${renderTable({caption:lastHeading,captionHidden:true,columns:block.header.map(plainInline),rows:block.rows.map(row=>row.map(cell=>({html:inline(cell,context)}))),rowHeaders:true,stack:true})}</div>`;
      case "code":
        if(block.lang==="diagram")return diagramHtml(block.text,context);
        return `<figure class="codeblock">${block.title?`<figcaption><code>${escape(block.title)}</code></figcaption>`:""}<pre><code${block.lang?` data-lang="${escape(block.lang)}"`:""}>${escape(block.text)}</code></pre></figure>`;
      case "container": return container(block,context);
      case "leaf": return leaf(block,context);
    }
  }).join("\n");
}

export function readingMinutes(page:HumanDocsPage,lang:Language):number {
  let diagrams=0;
  walk(page.blocks[lang],block=>{if(block.type==="code"&&block.lang==="diagram")diagrams++;});
  return Math.max(1,Math.round(wordCount(page.blocks[lang])/(lang==="ru"?170:200)+diagrams*.5));
}

function shell(lang:Language,title:string,description:string,body:string,active:Section|"changelog"|undefined,alternateSlug:string){
  const t=labels[lang],other:Language=lang==="en"?"ru":"en";
  const current=url(lang,alternateSlug);
  const links=[
    ...sections.filter(firstPage).map(section=>({href:url(lang,firstPage(section)!.slug),label:sectionLabels[section][lang],key:section as string})),
    {href:url(lang,"changelog"),label:t.changelog,key:"changelog"},
  ].map(link=>({href:link.href,label:link.label,mobileIcon:({basics:"home",digest:"news",projects:"projects",platform:"box",reference:"book",changelog:"history"} as Record<string,IconName>)[link.key],current:active===link.key?(link.href===current?"page" as const:"location" as const):undefined}));
  return renderDocument({
    lang,title:`${title} · Kurami docs`,description,favicon:"/assets/favicon.svg",styles:{href:"/assets/docs.css"},themeScript:true,skipLabel:t.skip,
    header:renderSiteHeader({
      mobile:{app:"docs",lang},
      brand:{href:url(lang,""),ariaLabel:lang==="ru"?"Kurami docs — главная":"Kurami docs — home",foxSrc:"/assets/fox.webp",suffix:"Docs"},
      nav:{label:t.primaryNav,links,collapse:{label:t.sections}},
      sites:kuramiSites("docs",lang),
      actions:renderLinkButton({label:other.toUpperCase(),href:url(other,alternateSlug),variant:"icon",ariaLabel:t.choose,attributes:{hreflang:other}})+renderThemeSwitch(lang),
    }),
    main:body,mainClass:"page",
    footer:renderSiteFooter({lang,app:"Docs"}),
  });
}

function side(lang:Language,section:Section|undefined,active:string){
  const t=labels[lang];
  const items=section
    ?`<p class="side__section">${escape(sectionLabels[section][lang])}</p>${groups.map(group=>{
        const members=pages.filter(page=>page.section===section&&page.group===group);
        if(!members.length)return "";
        return `<div class="side-group side-group--${group}"><h3>${escape(groupLabels[group][lang])}</h3><ul>${members.map(page=>`<li><a href="${url(lang,page.slug)}"${page.slug===active?' aria-current="page"':""}>${escape(page.navTitle[lang])}</a></li>`).join("")}</ul></div>`;
      }).join("")}`
    :`<p class="side__section">${t.sections}</p><div class="side-group"><ul>${sections.filter(firstPage).map(item=>`<li><a href="${url(lang,firstPage(item)!.slug)}">${escape(sectionLabels[item][lang])}</a></li>`).join("")}</ul></div>`;
  const page=pageBySlug.get(active),summary=[section?sectionLabels[section][lang]:t.sections,page?.navTitle[lang]].filter(Boolean).join(" · ");
  return `<nav class="side" aria-label="${t.articleNav}">${items}</nav>${renderDisclosure({summary,body:`<nav class="side-mobile__list" aria-label="${t.articleNav}">${items}</nav>`,boxed:true,variant:"inline",className:"side-mobile"})}`;
}

function toc(page:HumanDocsPage,lang:Language):{desktop:string;mobile:string} {
  const headings=page.blocks[lang].filter((block):block is Extract<Block,{type:"heading"}>=>block.type==="heading"&&block.level===2);
  if(headings.length<2)return {desktop:"",mobile:""};
  const links=`<ol>${headings.map(heading=>`<li><a href="#${escape(headingId(heading.text))}">${escape(plainInline(heading.text))}</a></li>`).join("")}</ol>`;
  return {desktop:`<nav class="toc" aria-label="${labels[lang].toc}"><p>${labels[lang].toc}</p>${links}</nav>`,mobile:renderDisclosure({summary:labels[lang].toc,body:`<nav class="toc-mobile__list" aria-label="${labels[lang].toc}">${links}</nav>`,boxed:true,variant:"inline",className:"toc-mobile"})};
}

function nextLink(page:HumanDocsPage,lang:Language):string {
  const next=page.next?pageBySlug.get(page.next):undefined;
  if(!next)return "";
  return `<nav class="next-page" aria-label="${labels[lang].next}"><span>${labels[lang].next}</span><a href="${url(lang,next.slug)}"><strong>${escape(next.title[lang])}</strong><small>${escape(next.summary[lang])}</small></a></nav>`;
}

export type RenderedPage={html:string;diagrams:{id:string;svg:string;excalidraw:string}[]};

export function renderArticle(page:HumanDocsPage,lang:Language,options:RenderOptions={}):RenderedPage {
  const context:Context={lang,page,options,diagrams:[]};
  const content=blocksHtml(page.blocks[lang],context);
  const eyebrow=[sectionLabels[page.section][lang],groupLabels[page.group][lang],`${readingMinutes(page,lang)} ${labels[lang].min}`].join(" · ");
  const tocHtml=toc(page,lang);
  const body=`<div class="layout${tocHtml.desktop?" layout--toc":""}">${side(lang,page.section,page.slug)}<article class="article" data-page="${escape(page.slug)}" data-group="${page.group}"><header class="intro"><p class="eyebrow page-eyebrow">${escape(eyebrow)}</p><h1 class="page-title">${escape(page.title[lang])}</h1><p class="lede page-subtitle">${escape(page.summary[lang])}</p></header>${tocHtml.mobile}<div class="prose">${content}</div>${nextLink(page,lang)}</article>${tocHtml.desktop}</div>`;
  return {html:shell(lang,page.title[lang],page.summary[lang],body,page.section,page.slug),diagrams:context.diagrams};
}

export function renderHome(lang:Language,options:RenderOptions={}):RenderedPage {
  if(!homePage)throw new Error("Missing content/pages/home.<lang>.md");
  const context:Context={lang,page:homePage,options,diagrams:[]};
  const voice=portalVoice({portal:"docs",mood:"welcome",reason:"docs-home"},lang);
  const body=`<div class="home"><div class="home__welcome"><header class="intro"><p class="eyebrow page-eyebrow">${escape(lang==="ru"?"Kurami · документация":"Kurami · documentation")}</p><h1 class="page-title">${escape(homePage.title[lang])}</h1><p class="lede page-subtitle">${escape(homePage.summary[lang])}</p></header>${renderKuramiPresence({...voice,mood:"welcome",voiceContext:"docs-home",action:renderLinkButton({label:lang==="ru"?"Карта системы":"System map",href:url(lang,"architecture"),variant:"secondary"})})}</div><div class="prose prose--home">${blocksHtml(homePage.blocks[lang],context)}</div></div>`;
  return {html:shell(lang,homePage.title[lang],homePage.summary[lang],body,undefined,""),diagrams:context.diagrams};
}

/** A small page left at an old route: it sends the reader to the page that now covers the topic. */
export function renderAlias(lang:Language,from:string,to:string):string {
  const target=pageBySlug.get(to);
  if(!target)throw new Error(`Alias ${from} points to missing page ${to}`);
  const href=url(lang,to);
  const body=`<div class="layout">${side(lang,target.section,"")}<article class="article"><header class="intro"><p class="eyebrow page-eyebrow">${escape(labels[lang].moved)}</p><h1 class="page-title">${escape(target.title[lang])}</h1><p class="lede page-subtitle"><a href="${href}">${escape(target.title[lang])} →</a></p></header></article></div>`;
  return shell(lang,target.title[lang],target.summary[lang],body,target.section,to).replace("<head>",`<head>\n  <meta http-equiv="refresh" content="0; url=${href}">\n  <link rel="canonical" href="${href}">`);
}

export function renderChangelog(lang:Language,changes:Change[],revision?:string,published=false,docsSha?:string,historyRevision?:string):string {
  if(docsSha&&!/^[0-9a-f]{40}$/.test(docsSha))throw new Error("Invalid documentation revision");
  if(historyRevision&&(!published||!/^[0-9a-f]{40}$/.test(historyRevision)))throw new Error("Invalid confirmed changelog revision");
  const ru=lang==="ru";
  const t=labels[lang],title=t.changelog;
  const byDate=new Map<string,Change[]>();
  for(const change of changes)byDate.set(change.date,[...(byDate.get(change.date)??[]),change]);
  const categories={en:{new:"New",improved:"Improved",fixed:"Fixed",operations:"Operations"},ru:{new:"Новое",improved:"Улучшено",fixed:"Исправлено",operations:"Эксплуатация"}};
  const context:Context={lang,page:homePage!,options:{},diagrams:[]};
  const cards=[...byDate].map(([date,items])=>`<section class="change-day"><h2>${escape(date)}</h2>${items.map(change=>{
    const page=change.page?resolveSlug(change.page):undefined;
    const blocks=parseBlocks(change.copy,`changelog ${change.sha}`);
    walk(blocks,block=>{if(block.type==="container"||block.type==="leaf"||block.type==="code"&&block.lang==="diagram")throw new Error("Changelog supports text, lists, headings, tables and code only");});
    return `<div class="change"><span class="change__category">${categories[lang][change.category]}</span><a href="${REPO}/commit/${change.sha}" rel="noopener noreferrer">${t.source} ${change.sha.slice(0,7)}</a><div class="prose change__copy">${blocksHtml(blocks,context)}</div>${page?`<a href="${url(lang,page)}">${t.readPage} ↗</a>`:""}</div>`;
  }).join("")}</section>`).join("");
  const status=revision
    ?`${t.latest}. ${ru?"Даты в списке — дни коммитов, не дни развёртывания.":"List dates are commit days, not deployment days."}`
    :historyRevision
      ?ru?`Сохранена подтверждённая история до версии ${historyRevision.slice(0,12)}. Новые изменения приложения в этот выпуск документации не добавлены. Даты в списке — дни коммитов, не дни развёртывания.`:`Confirmed history is preserved through revision ${historyRevision.slice(0,12)}. This documentation release adds no new application changes. List dates are commit days, not deployment days.`
      :published?t.awaiting:t.unpublished;
  const empty=revision
    ?ru?"После начальной точки пока нет опубликованных изменений.":"No published changes since the baseline."
    :published
      ?ru?"Этот выпуск документации не публикует изменения приложения.":"This documentation release does not publish application changes."
      :ru?"Локальный preview намеренно оставляет changelog приложения пустым.":"The local preview deliberately leaves the application changelog empty.";
  const docsVersion=published&&docsSha?`<p class="changelog-version">${ru?"Версия документации":"Documentation version"} <code title="${docsSha}">${docsSha.slice(0,12)}</code></p>`:"";
  const body=`<div class="layout">${side(lang,undefined,"")}<article class="article"><header class="intro"><p class="eyebrow page-eyebrow">${revision?escape(revision.slice(0,7)):published?ru?"Документация опубликована":"Documentation published":ru?"Локальный просмотр":"Local preview"}</p><h1 class="page-title">${title}</h1>${docsVersion}<p class="lede page-subtitle">${status}</p></header><div class="changes">${cards||`<p>${empty}</p>`}</div></article></div>`;
  return shell(lang,title,status,body,"changelog","changelog");
}

export function renderNotFound(lang:Language):string {
  const ru=lang==="ru",title=ru?"Страница не найдена":"Page not found",description=ru?"Этой страницы нет. Найди нужный раздел на главной документации.":"This page does not exist. Find the section you need on the documentation home page.";
  const body=`<div class="home"><header class="intro intro--kurami kurami-says kurami-says--side">${renderKuramiMood({mood:"found-problem",eager:true})}<div><p class="eyebrow page-eyebrow">404</p><h1 class="page-title">${title}</h1><div class="kurami-says__bubble"><p class="lede page-subtitle">${description}</p></div></div></header>${renderLinkButton({label:ru?"На главную Docs":"Docs home",href:url(lang,""),variant:"secondary"})}</div>`;
  return shell(lang,title,description,body,undefined,"");
}

export {resolveSlug};
