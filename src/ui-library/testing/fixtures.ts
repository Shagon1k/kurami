// Synthetic pages for joint Digest/Docs browser regression. No private data; nothing here is fetched.
import {upgradeLegacyPayload} from "../../briefing/migrations/addon-format.ts";
import {renderBriefingPage} from "../../briefing/ui/render-page.ts";
import {renderStocksPage} from "../../briefing/stocks/render.ts";
import {renderWeeklyPage} from "../../briefing/weekly/render.ts";
import {renderInvestmentReview} from "../../briefing/investment-review/render.ts";
import {input as reviewInput,draft as reviewDraft} from "../../../tests/fixtures/briefing/investment-review.ts";
import {THEME_CSS} from "../themes/index.ts";
import {FOUNDATION_CSS} from "../foundations/index.ts";
import {BUTTON_CSS,renderButton,renderLinkButton} from "../components/button.ts";
import {THEME_SWITCH_CSS,renderThemeSwitch} from "../components/theme-switch.ts";
import {TABLE_CSS,renderTable} from "../components/table.ts";
import {CALLOUT_CSS,renderCallout} from "../components/callout.ts";
import {DISCLOSURE_CSS,renderDisclosure} from "../components/disclosure.ts";
import {SITE_HEADER_CSS,renderSiteHeader} from "../patterns/site-header.ts";
import {renderDocument} from "../patterns/page-shell.ts";
import {renderHubPage} from "../../hub/render.ts";
import type {HubSnapshot} from "../../hub/snapshot.ts";

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
  const styles=[THEME_CSS,FOUNDATION_CSS,BUTTON_CSS,THEME_SWITCH_CSS,SITE_HEADER_CSS,TABLE_CSS,CALLOUT_CSS,DISCLOSURE_CSS,
    ".page { padding-block: var(--space-10); display: grid; gap: var(--space-6); max-width: 760px; } .page h1 { margin: 0; font-size: clamp(2rem, 5vw, 3.25rem); line-height: 1.05; letter-spacing: -.04em; }"].join("\n");
  return renderDocument({
    lang:"en",title:"Library sub-site · Kurami",favicon:"/favicon.svg",styles:{inline:styles},themeScript:true,skipLabel:"Skip to content",
    header:renderSiteHeader({brand:{href:"/",ariaLabel:"Kurami — home",foxSrc:"/assets/kurami-fox.png",suffix:"lab"},nav:{label:"Sections",links:[{href:"/lab/",label:"Overview",current:"page"},{href:"/lab/runs/",label:"Runs"},{href:"/lab/notes/",label:"Notes"}],collapse:{label:"Sections"}},actions:renderLinkButton({label:"RU",href:"/ru/",variant:"icon",ariaLabel:"Switch to Russian"})+renderThemeSwitch("en")}),
    main:`<h1>A new Kurami sub-site</h1>
${renderCallout({tone:"note",title:"Built from the library",body:"Header, buttons, table, callout and disclosure come from src/ui-library; this page adds only its own layout."})}
${renderTable({caption:"Synthetic runs",columns:["Run","Duration","Checks"],rows:[["alpha","12 min","4/4"],["beta","7 min","3/4"]],rowHeaders:true,numeric:true,stack:true})}
${renderDisclosure({summary:"Technical detail",body:"<p>Nothing here is real data.</p>",boxed:true})}
<p>${renderButton({label:"Primary action",variant:"primary"})} ${renderButton({label:"Secondary",variant:"secondary"})}</p>`,
    mainClass:"page",
    footer:`<footer class="container"><p>Kurami lab · synthetic</p></footer>`,
  });
}

/** Synthetic Hub page: fixed values keep visual regression independent of private runtime state. */
export function syntheticHub():string {
  const projects=[
    ["pickflick","PickFlick",3,2,14,18],
    ["tailortales","TailorTales",2,0,8,12],
    ["ahurynovich-cv","AHurynovich-CV",1,1,4,6],
  ] as const;
  const snapshot:HubSnapshot={generatedAt:"2026-09-16T07:00:00Z",sources:{orchestrator:"available",git:"available"},
    codex:{state:"available",tokens7:3812400,tokens30:14268300,cached30:12876100,output30:361200,sessions30:39,coverage:"complete",
      models:[{name:"gpt-6-sol",sessions:27},{name:"gpt-6-luna",sessions:9},{name:"gpt-6-astra",sessions:3}],
      limits:[{name:"primary",usedPercent:42,remainingPercent:58,windowMinutes:10080,resetsAt:"2026-09-20T10:00:00Z",observedAt:"2026-09-16T06:59:00Z"},
        {name:"secondary",usedPercent:18,remainingPercent:82,windowMinutes:300,resetsAt:"2026-09-16T09:00:00Z",observedAt:"2026-09-16T06:59:00Z"}],updatedAt:"2026-09-16T06:59:00Z"},
    totals:{working:2,review:3,attention:1,commits30:42},
    weeks:Array.from({length:12},(_,index)=>({start:new Date(Date.UTC(2026,5,29+index*7)).toISOString().slice(0,10),count:[0,2,1,4,3,6,8,11,7,13,4,9][index]!})),
    projects:[...projects.map(([key,name,number,review,commits7,commits30])=>({key,name,repository:`Shagon1k/${name}`,boardUrl:`https://github.com/users/Shagon1k/projects/${number}`,managed:true,
      board:{backlog:12,active:1,review,done:20,deferred:2},runs:{working:key==="pickflick"?2:0,attention:key==="pickflick"?1:0,ciFailed:0},
      poll:{capturedAt:"2026-09-16T06:58:00Z",state:"fresh" as const},git:{commits7,commits30,latestAt:"2026-09-16T06:30:00Z",state:"available" as const}})),
      {key:"kurami",name:"Kurami",repository:"Shagon1k/Kurami",boardUrl:"https://github.com/Shagon1k/Kurami",managed:false,board:null,runs:null,
        poll:{capturedAt:null,state:"unavailable"},git:{commits7:3,commits30:6,latestAt:"2026-09-16T06:00:00Z",state:"available"}}]};
  return renderHubPage(snapshot);
}
