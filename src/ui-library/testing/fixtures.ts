// Synthetic pages for joint Digest/Docs browser regression. No private data; nothing here is fetched.
import {upgradeLegacyPayload} from "../../briefing/migrations/addon-format.ts";
import {renderBriefingPage} from "../../briefing/ui/render-page.ts";
import {injectSiteNavigation} from "../../briefing/ui/components/site-header.ts";
import {renderStocksPage} from "../../briefing/stocks/render.ts";
import {renderWeeklyPage} from "../../briefing/weekly/render.ts";
import {renderInvestmentReview} from "../../briefing/investment-review/render.ts";
import {input as reviewInput,draft as reviewDraft} from "../../../tests/fixtures/briefing/investment-review.ts";
import {THEME_CSS} from "../themes/index.ts";
import {FOUNDATION_CSS} from "../foundations/index.ts";
import {BUTTON_CSS,renderButton,renderLinkButton} from "../components/button.ts";
import {PERIOD_SWITCH_CSS,renderPeriodSwitch} from "../components/period-switch.ts";
import {THEME_SWITCH_CSS,renderThemeSwitch} from "../components/theme-switch.ts";
import {TABLE_CSS,renderTable} from "../components/table.ts";
import {CALLOUT_CSS,renderCallout} from "../components/callout.ts";
import {DISCLOSURE_CSS,renderDisclosure} from "../components/disclosure.ts";
import {SITE_HEADER_CSS,renderSiteHeader} from "../patterns/site-header.ts";
import {renderDocument} from "../patterns/page-shell.ts";
import {ICON_CSS} from "../components/icon.ts";
import {STAT_CARD_CSS,renderStatCard,renderMeter} from "../components/stat-card.ts";
import {FORM_CSS,renderCheckbox} from "../components/form.ts";
import {renderHubPage,type HubLanguage} from "../../hub/render.ts";
import type {HubSnapshot} from "../../hub/snapshot.ts";
import {summarizeModelUsage,type UsageSample} from "../../core/api-equivalent.ts";

const at="2026-09-16T07:00:00Z";
const story=(index:number,headline:string,summary:string)=>({
  id:`story-${index}`,fingerprint:`story-fp-${index}`,headline,summary,details:["Синтетическая деталь для визуальной проверки."],
  topics:[{id:"technology",label:"Technology"},{id:"testing",label:"Testing"}],
});

export function syntheticDaily():string {
  return renderBriefingPage(upgradeLegacyPayload({
    schemaVersion:1,
    edition:{id:"daily:2026-09-16",type:"daily",localDate:"2026-09-16",timezone:"Europe/Vilnius",generatedAt:at,status:"complete",retentionUntil:"2026-09-21T07:00:00Z"},
    hero:{title:"Утренний обзор"},
    mail:{state:"ready",count:2,items:[
      {id:"mail-1",provider:"gmail",providerItemId:"message-1",class:"GENERAL",subject:"Синтетическое письмо"},
      {id:"mail-2",provider:"gmail",providerItemId:"message-2",class:"GENERAL",subject:"Второе письмо для проверки"},
    ]},
    calendar:{state:"ready",events:[{id:"event-1",title:"Встреча",start:"2026-09-16T10:00:00+03:00",end:"2026-09-16T11:00:00+03:00",location:"Офис",description:"Описание"}],allDayEvents:[]},
    weather:{state:"ready",temperatureC:18,location:"Город"},
    news:{state:"ready",pageSize:10,items:[
      story(1,"Первая синтетическая новость","Короткое содержание, чтобы проверить отступы и перенос строк в карточке сюжета."),
      story(2,"Вторая новость с длинным заголовком, который переносится на несколько строк","Ещё одно содержание."),
      story(3,"Третья новость","Проверка списка."),
    ]},
    sourceBatches:[],
    dataQuality:{state:"ready"},
  } as Record<string,unknown>));
}

/** An archived Cinema header from before the shared site pattern; no edition data is used. */
export function syntheticLegacyCinema():string {
  const archived='<!doctype html><html lang="ru" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#fbfbf8"><title>Кино · Kurami</title></head><body><a class="skip-link" href="#main">К содержанию</a><header class="utility-header" data-utility-header data-site-section="cinema"><div class="utility-header__inner page-shell"><time class="utility-meta" datetime="2026-09-12">12 сентября 2026</time><nav data-site-navigation></nav><div class="utility-actions"></div></div></header><main id="main">Синтетический выпуск</main></body></html>';
  return injectSiteNavigation(archived,[{section:"daily"},{section:"cinema"},{section:"weekly"}],"cinema");
}

export function syntheticStocksEmpty():string {
  return renderStocksPage(null,new URLSearchParams(),at);
}

export function syntheticWeeklyEmpty():string {
  return renderWeeklyPage(null);
}

export function syntheticInvestmentReview():string {
  return renderInvestmentReview(reviewInput,reviewDraft);
}

/** A sub-site assembled only from the library: proves a new site needs no Digest or Docs CSS. */
export function librarySubsite():string {
  const styles=[THEME_CSS,FOUNDATION_CSS,BUTTON_CSS,THEME_SWITCH_CSS,SITE_HEADER_CSS,TABLE_CSS,CALLOUT_CSS,DISCLOSURE_CSS,PERIOD_SWITCH_CSS,ICON_CSS,STAT_CARD_CSS,FORM_CSS,
    ".page { padding-block: var(--space-10); display: grid; gap: var(--space-6); max-width: 760px; } .page h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.25rem); line-height: 1.05; letter-spacing: -.04em; }"].join("\n");
  return renderDocument({
    lang:"en",title:"Library sub-site · Kurami",favicon:"/favicon.svg",styles:{inline:styles},themeScript:true,skipLabel:"Skip to content",
    header:renderSiteHeader({brand:{href:"/",ariaLabel:"Kurami — home",foxSrc:"/assets/kurami-fox.webp",suffix:"lab"},nav:{label:"Sections",links:[{href:"/lab/",label:"Overview",current:"page"},{href:"/lab/runs/",label:"Runs"},{href:"/lab/notes/",label:"Notes"}],collapse:{label:"Sections"}},actions:renderLinkButton({label:"RU",href:"/ru/",variant:"icon",ariaLabel:"Switch to Russian"})+renderThemeSwitch("en")}),
    main:`<h1>A new Kurami sub-site</h1>
${renderPeriodSwitch({key:"synthetic-usage",lang:"en",label:"Usage period"})}
${renderStatCard({label:"Tokens",value:"3.8M",full:"3,812,400",icon:"tokens",tone:"info"})}
${renderMeter({value:36.7,label:"Memory",tone:"info"})}
${renderCheckbox({name:"synthetic-repo",label:"Kurami",value:"kurami",checked:true})}
${renderCallout({tone:"note",title:"Built from the library",body:"Header, buttons, table, callout and disclosure come from src/ui-library; this page adds only its own layout."})}
${renderTable({caption:"Synthetic runs",columns:["Run","Duration","Checks"],rows:[["alpha","12 min","4/4"],["beta","7 min","3/4"]],rowHeaders:true,numeric:true,stack:true})}
${renderDisclosure({summary:"Technical detail",body:"<p>Nothing here is real data.</p>",boxed:true})}
${renderDisclosure({summary:"Events · 3",body:"<p>Shared inline disclosure.</p>",variant:"inline"})}
<p>${renderButton({label:"Primary action",variant:"primary"})} ${renderButton({label:"Secondary",variant:"secondary"})}</p>`,
    mainClass:"page",
    footer:`<footer class="container"><p>Kurami lab · synthetic</p></footer>`,
  });
}

/** Synthetic Hub page: fixed values keep visual regression independent of private runtime state. */
export function syntheticHubSnapshot():HubSnapshot {
  const projects=[
    ["pickflick","PickFlick",3,2,14,18],
    ["tailortales","TailorTales",2,0,8,12],
    ["ahurynovich-cv","AHurynovich-CV",1,1,4,6],
  ] as const;
  const snapshot:HubSnapshot={generatedAt:"2026-09-16T07:00:00Z",sources:{orchestrator:"available",git:"available"},
    codex:{state:"available",tokens7:3812400,tokens30:14268300,cached30:12876100,output30:361200,sessions30:39,coverage:"complete",
      models:[{name:"gpt-6-sol",sessions:27},{name:"gpt-6-luna",sessions:9},{name:"gpt-6-astra",sessions:3}],
      limits:[{name:"primary",usedPercent:42,remainingPercent:58,windowMinutes:10080,resetsAt:"2026-09-20T10:00:00Z",observedAt:"2026-09-16T06:59:00Z"}],updatedAt:"2026-09-16T06:59:00Z",account:{state:"live",resetCredits:2,observedAt:"2026-09-16T06:59:00Z",limits:[]}},
    operations:{healthStale:false,health:{version:1,checkedAt:"2026-09-16T06:59:00Z",ok:true,
      server:{hostname:"shagserv",cpuUsedPercent:12.3,cpuCores:8,loadAverage:[.8,.9,1.1],memoryUsedPercent:36.7,memoryUsedGiB:8.4,memoryTotalGiB:22.9,memoryAvailableGiB:14.5,swapUsedGiB:0,swapTotalGiB:0,uptimeSeconds:864000},
      cpuStatistics:{windowMinutes:8,sampleCount:32,averagePercent:10.2,peakPercent:28.1},network:{status:"online",latencyMs:18.4},speed:{downloadMbps:1202.9,uploadMbps:85.1,checkedAt:"2026-09-16T06:00:00Z"},disk:{usedPercent:18,availableGiB:158.1,state:"normal"},
      orchestrator:{database:"ok",containers:{total:12,running:12,unhealthy:0},previews:2,worktrees:3,worktreeLimit:6,quarantined:0,backupAgeHours:8.2,backupMaxAgeHours:84,backupFresh:true},issues:[]},
      alerts:[
        {id:"sample-ci",group:"task:pickflick:123",project:"pickflick",title:"Update watchlist",task:true,next:"start_repair",actor:"owner",severity:"warning",code:"ci_unrepaired",subject:"PickFlick #123",href:"https://github.com/Shagon1k/PickFlick/pull/123"},
        {id:"sample-review",group:"task:pickflick:123",project:"pickflick",title:"Update watchlist",task:true,next:"start_repair",actor:"owner",severity:"warning",code:"review_unrepaired",detail:"2",subject:"PickFlick #123",href:"https://github.com/Shagon1k/PickFlick/pull/123"}],
      activity:[]},
    totals:{working:2,review:3,attention:1,commits30:42},
    weeks:Array.from({length:12},(_,index)=>({start:new Date(Date.UTC(2026,5,29+index*7)).toISOString().slice(0,10),count:[0,2,1,4,3,6,8,11,7,13,4,9][index]!})),
    projects:[...projects.map(([key,name,number,review,commits7,commits30])=>({key,name,repository:`Shagon1k/${name}`,boardUrl:`https://github.com/users/Shagon1k/projects/${number}`,managed:true,
      board:{backlog:12,active:1,review,done:20,deferred:2},runs:{working:key==="pickflick"?2:0,attention:key==="pickflick"?1:0,ciFailed:0},
      poll:{capturedAt:"2026-09-16T06:58:00Z",state:"fresh" as const},git:{commits7,commits30,latestAt:"2026-09-16T06:30:00Z",state:"available" as const}})),
      {key:"kurami",name:"Kurami",repository:"Shagon1k/Kurami",boardUrl:"https://github.com/Shagon1k/Kurami",managed:false,board:null,runs:null,
        poll:{capturedAt:null,state:"unavailable"},git:{commits7:3,commits30:6,latestAt:"2026-09-16T06:00:00Z",state:"available"}}]};
  snapshot.codex.periods={7:{tokens:3812400,cached:3215000,output:104800,sessions:12,models:[{name:"gpt-6-sol",sessions:10},{name:"gpt-6-luna",sessions:2}]},30:{tokens:14268300,cached:12876100,output:361200,sessions:39,models:snapshot.codex.models}};
  const sample=(model:string|null,input:number,cached:number,cacheWrite:number,output:number):UsageSample=>({session:model??"unknown",event:{at:0,model,input,cached,cacheWrite,output,total:input+output,requestInput:200_000}});
  const recent=[sample("gpt-6-sol",2_900_000,2_600_000,100_000,100_000),sample("gpt-6-luna",807_600,615_000,50_000,4800)];
  const older=[sample("gpt-6-astra",90_000,80_000,1000,10_000),sample("gpt-6.1-sol",9_009_500,8_711_100,50_000,246_400),sample(null,1_100_000,870_000,49_000,0)];
  for(const days of [7,30] as const){
    const summary=summarizeModelUsage(days===7?recent:[...recent,...older]);
    Object.assign(snapshot.codex.periods[days],{modelUsage:summary.models,equivalent:summary.equivalent});
  }
  snapshot.commitDays=Array.from({length:30},(_,index)=>({start:new Date(Date.UTC(2026,7,17+index)).toISOString(),count:index<23?(index<13?1:0):[0,2,1,4,3,8,11][index-23]!}));
  snapshot.commitRepositories=Object.fromEntries(snapshot.projects.map(project=>[project.key,snapshot.commitDays!.map(day=>({...day,count:0}))]));
  const allocate=(from:number,to:number,budgets:number[])=>{
    for(let day=from;day<to;day++)for(let n=0;n<snapshot.commitDays![day]!.count;n++){
      const repo=budgets.findIndex(count=>count>0);if(repo<0)throw new Error("Fixture commit allocation exhausted");
      snapshot.commitRepositories![snapshot.projects[repo]!.key]![day]!.count++;budgets[repo]!--;
    }
  };
  allocate(0,23,[4,4,2,3]);allocate(23,30,[14,8,4,3]);
  snapshot.codex.account!.limits=snapshot.codex.limits;
  snapshot.codex.limitHistory=snapshot.commitDays.map((day,index)=>({date:day.start.slice(0,10),windows:index%9===0?{}:{"10080":(index*7)%90}}));
  snapshot.codex.limitUsage=snapshot.commitDays.map((day,index)=>({date:day.start.slice(0,10),windows:index%9===0?{}:{"10080":(index*3)%22},partial:index%7===0?{"10080":true}:{}}));
  snapshot.operations!.activity=Array.from({length:25},(_,index)=>{
    const project=snapshot.projects[index%4]!;
    return {id:`work-${index}`,group:`task:${project.key}:${123+index}`,project:project.key,agent:index%3===0?"Hermes":"Codex",at:new Date(Date.parse(at)-index*600_000-120_000).toISOString(),source:"Projects",subject:index===0?"Update watchlist":`Task #${123+index}`,event:index%4===0?"running":"parked_review",href:`https://github.com/${project.repository}/pull/${123+index}`};
  });
  snapshot.operations!.activity.push({id:"work-0-turn",group:"task:pickflick:123",project:"pickflick",agent:"Codex",sessionId:"synthetic-session",at:"2026-09-16T06:59:00Z",source:"Codex",subject:"Update watchlist",event:"task_complete"},{id:"work-0-ci",group:"task:pickflick:123",project:"pickflick",agent:"Codex",at:"2026-09-16T06:57:00Z",source:"CI",subject:"Update watchlist",event:"failed",result:"CI:failed",href:"https://github.com/Shagon1k/PickFlick/pull/123"});
  snapshot.usage={available:true,periods:{7:{completed:6,measured:5,medianTokens:821400,reworkPercent:12.5},30:{completed:18,measured:16,medianTokens:956700,reworkPercent:18.2}},projects:Object.fromEntries(projects.map(([key],index)=>[key,{7:{completed:2,measured:index===2?1:2,medianTokens:[741200,821400,932000][index]!,reworkPercent:[8.4,12.5,20.3][index]!},30:{completed:6,measured:index===2?6:5,medianTokens:[903600,956700,1042700][index]!,reworkPercent:[15.2,18.2,20.7][index]!}}]))};
  return snapshot;
}
export function syntheticHub(lang:HubLanguage="ru"):string {return renderHubPage(syntheticHubSnapshot(),lang);}
