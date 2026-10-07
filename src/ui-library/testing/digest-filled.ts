import {withDigestLanguage,type DigestLanguage} from "../../briefing/i18n.ts";
import {upgradeLegacyPayload} from "../../briefing/migrations/addon-format.ts";
import {renderBriefingPage} from "../../briefing/ui/render-page.ts";
import {cinemaEnvelopeToBriefingPayload} from "../../briefing/cinema/payload.ts";
import {renderWeeklyPage} from "../../briefing/weekly/render.ts";
import {shiftDate,type WeeklyReview} from "../../briefing/weekly/model.ts";
import {renderStocksPage} from "../../briefing/stocks/render.ts";
import {parseStocksConfig} from "../../briefing/stocks/config.ts";
import {dayShift,type StocksSnapshot} from "../../briefing/stocks/model.ts";
import {engineeringBrief} from "../../briefing/engineering/model.ts";

const at="2026-09-20T07:00:00Z";
const media="/media/cinema/2026-09-19/audit-poster.svg";

export const auditPoster=`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="720" viewBox="0 0 480 720"><rect width="480" height="720" fill="#a38b54"/><circle cx="240" cy="250" r="130" fill="#f5e9c8"/><path d="M0 620L170 390L340 560L480 420V720H0Z" fill="#292720"/><text x="240" y="670" text-anchor="middle" fill="white" font-family="sans-serif" font-size="28">SYNTHETIC POSTER</text></svg>`;

export function syntheticDailyFilled(lang:DigestLanguage="ru"):string {
  return withDigestLanguage(lang,()=>renderBriefingPage(syntheticDailyFilledPayload()));
}

export function syntheticDailyFilledPayload() {
  const payload=upgradeLegacyPayload({schemaVersion:1,
    edition:{id:"daily:2026-09-16",type:"daily",localDate:"2026-09-16",timezone:"Europe/Vilnius",generatedAt:"2026-09-16T07:00:00Z",status:"complete",retentionUntil:"2026-09-23T07:00:00Z"},
    hero:{title:"Утренний обзор",en:{title:"Morning briefing"}},
    mail:{state:"ready",count:8,items:Array.from({length:8},(_,index)=>({id:`audit-mail-${index}`,provider:"gmail",providerItemId:`audit-message-${index}`,class:"GENERAL",subject:index===0?"Очень длинная тема синтетического письма: подробное уведомление о ходе проекта и следующих встречах":`Synthetic inbox message ${index+1}`}))},
    calendar:{state:"ready",events:Array.from({length:4},(_,index)=>({id:`audit-event-${index}`,title:index===0?"Встреча с длинным исходным названием и несколькими участниками":`Synthetic meeting ${index+1}`,start:`2026-09-16T${10+index}:00:00+03:00`,end:`2026-09-16T${11+index}:00:00+03:00`,location:"Synthetic meeting room",description:"Описание встречи для проверки плотности и переносов."})),allDayEvents:[]},
    weather:{state:"ready",temperatureC:18,location:"Synthetic City",condition:"🌧️ Дождь"},
    news:{state:"ready",pageSize:10,items:Array.from({length:6},(_,index)=>({
      id:`audit-story-${index}`,fingerprint:`audit-fingerprint-${index}`,headline:"Длинный редакционный заголовок синтетической новости для проверки карточки на телефоне",
      summary:"Тестовое содержание для проверки плотности, порядка действий и переноса длинных слов. Никаких реальных новостей или личных данных.",details:["Подробность синтетического сюжета для проверки раскрытия."],
      en:{headline:"A long editorial headline for checking a synthetic news card on a phone",summary:"Fixture copy for checking density, action placement and wrapping. No actual news or personal data.",details:["Synthetic story detail for checking the disclosure."]},
      topics:[{id:"technology",label:"Technology"},{id:"testing",label:"Testing"}],
      sources:[{sourceKey:"telegram:audit",itemIds:[String(index)],provider:"telegram",sourceLabel:"Synthetic source",url:"https://example.org/audit-story"}],
      ...(index===0?{media:[{id:"audit-image",kind:"image",src:"/media/audit-illustration.webp",alt:"Synthetic illustration",mimeType:"image/webp"}]}:{}),
    }))},sourceBatches:[],dataQuality:{state:"ready",summary:"Тестовые источники обновлены."},
  });
  payload.addons.engineering=engineeringBrief({waiting:[
    {project:"PickFlick",number:158,title:"Синтетическая задача с длинным названием для проверки обрезки строки на телефоне",url:"https://example.org/pull/158",hours:44},
    {project:"TailorTales",number:121,title:"Synthetic review",url:"https://example.org/pull/121",hours:73}],
    week:{completed:5,measured:4,medianTokens:1_240_000,reworkPercent:20}},at) as unknown as typeof payload.addons[string];
  return payload;
}

export function syntheticCinemaFilled(lang:DigestLanguage="ru",originalEditorial=false):string {
  const capturedAt="2026-09-19T07:00:00Z";
  const sourceId="source:audit";
  const coverage={start:"2026-09-12T00:00:00Z",end:"2026-09-19T00:00:00Z"};
  const envelope={version:1,state:"ready",capturedAt,data:{
    market:"LT",timezone:"Europe/Vilnius",language:"ru",localDate:"2026-09-19",
    coverage:{boxOffice:coverage,trailers:coverage,premieres:{start:"2026-09-19T00:00:00Z",end:"2026-09-26T00:00:00Z"},news:coverage},
    boxOffice:{state:"ready",capturedAt,featuredId:"film-1",provenance:[sourceId],
      charts:["WORLD","US/CA","LT"].flatMap(region=>(["weekend","ytd"] as const).map(period=>({
        id:region==="WORLD"?`world-${period}`:`${region.replace("/","-").toLowerCase()}-${period}`,
        region,period,label:`${region} · ${period}`,entries:Array.from({length:10},(_,index)=>({
          id:`film-${index+1}`,title:index===0?"The extraordinarily long journey home: a synthetic film title for narrow screens":`Synthetic Film ${index+1}`,
          rank:index+1,gross:{amount:(10-index)*1234567,currency:region==="LT"?"EUR":"USD"},
          changePercent:index===0?-12.4:-31.2,weeks:index+1,sourceId,
        })),
      }))),signals:[{id:"hold",kind:"best-hold",filmId:"film-1",filmTitle:"Synthetic Film 1",label:"Лучшее удержание",value:-12.4,unit:"%",sourceId}],
      trend:[{id:"film-1",label:"Synthetic Film 1",currency:"USD",points:Array.from({length:6},(_,index)=>({at:dayShift("2026-08-08",index*7),label:`Week ${index+1}`,gross:12000000-index*1600000}))}],
    },
    trailers:{state:"ready",capturedAt,provenance:[sourceId],items:Array.from({length:3},(_,index)=>({
      id:`trailer-${index}`,title:index===0?"A long original trailer title with a subtitle that needs several lines on a phone":"Synthetic Trailer "+(index+1),
      videoId:"AbCdEfGhI12",publisher:"Synthetic Studio",publisherChannelId:"UC"+"a".repeat(22),publisherRole:"official",publishedAt:"2026-09-18T07:00:00Z",
      sourceUrl:"https://example.org/trailer",thumbnailSrc:media,durationSeconds:144,trailerType:"main",sourceId,
    }))},
    premieres:{state:"ready",capturedAt,provenance:[sourceId],items:Array.from({length:3},(_,index)=>({
      id:`premiere-${index}`,localTitle:index===0?"Длинное название синтетической премьеры с дополнительным подзаголовком":"Synthetic Premiere "+(index+1),
      originalTitle:"Original Film Title",releaseDate:"2026-09-24",sourceUrl:"https://example.org/premiere",...(index!==2?{posterSrc:media}:{}),
      genres:["Drama","Adventure"],runtimeMinutes:142,ageRating:"N-13",directors:["Synthetic Director"],cast:["Actor One","Actor Two"],sourceId,
    }))},
    news:{state:"ready",capturedAt,provenance:[sourceId],items:Array.from({length:3},(_,index)=>({
      id:`cinema-story-${index}`,headline:"Синтетическая новость киноиндустрии с длинным редакционным заголовком",
      summary:"Тестовый текст для проверки переносов, плотности и внешних ссылок в полноценном выпуске. Никаких настоящих новостей или личных данных.",
      ...(originalEditorial?{}:{en:{headline:"Synthetic cinema industry story with a long editorial headline",summary:"Fixture copy for checking wrapping, density and source links in a filled edition. No actual news or personal data."}}),
      publisher:"Synthetic Cinema Source",publishedAt:"2026-09-18T07:00:00Z",sourceUrl:"https://example.org/cinema-news",...(index===0?{imageSrc:media}:{}),sourceId,
    }))},
    notes:[],quality:{summary:"Все тестовые разделы заполнены.",diagnostics:[]},
    provenance:[{id:sourceId,provider:"fixture",url:"https://example.org/cinema",fetchedAt:capturedAt}],
  }};
  return withDigestLanguage(lang,()=>renderBriefingPage(cinemaEnvelopeToBriefingPayload(envelope)));
}

export function syntheticWeeklyReview(partial=false):WeeklyReview {
  const days=Array.from({length:7},(_,index)=>({date:shiftDate("2026-09-13",index),timezone:"Europe/Vilnius",observedAt:at,
    stories:partial&&index===2?null:12+index,
    calendar:partial&&index===2?null:{events:2+index,allDay:0,busyMinutes:60+index*35,overlapMinutes:index*5},
    inbox:partial&&index===2?null:{first:18+index,last:12+index,firstAt:at,lastAt:at},
  }));
  return {version:1,state:partial?"partial":"ready",capturedAt:at,data:{
    publicationDate:"2026-09-20",start:"2026-09-13",end:"2026-09-19",timezone:"Europe/Vilnius",days,
    coverage:{news:partial?6:7,calendar:partial?6:7,mail:partial?6:7},
    totals:{stories:days.reduce((sum,day)=>sum+(day.stories??0),0),calendarMinutes:days.reduce((sum,day)=>sum+(day.calendar?.busyMinutes??0),0),calendarEvents:days.reduce((sum,day)=>sum+(day.calendar?.events??0),0),archived:23,more:8,less:3},
    calendarDeltaMinutes:90,
    topics:[{id:"technology",label:"Technology / Технологии и искусственный интеллект",more:6,less:2,net:4,previousNet:2},{id:"transport",label:"Transport / Транспорт",more:2,less:1,net:1,previousNet:-1}],
    insights:["Самый насыщенный день в календаре — суббота: 270 минут. Это запланированное время, а не измеренные рабочие часы.","Наблюдения почты показывают остаток, а не количество обработанных сообщений."],
  }};
}

export function syntheticWeeklyFilled(lang:DigestLanguage="ru",partial=false):string {
  const chronicle={names:{pickflick:"PickFlick",tailortales:"TailorTales"},days:[
    {day:"2026-09-19",events:[{at:"2026-09-19T09:00:00Z",project:"pickflick",issue:120,title:"Club invitations",kind:"done" as const}]},
    {day:"2026-09-17",events:[{at:"2026-09-17T09:00:00Z",project:"tailortales",issue:41,title:"Bedtime story pacing",kind:"review" as const},{at:"2026-09-17T12:00:00Z",project:"pickflick",issue:123,title:"Update watchlist",kind:"started" as const}]}]};
  return withDigestLanguage(lang,()=>renderWeeklyPage(syntheticWeeklyReview(partial),false,partial?null:chronicle));
}

export function syntheticStocksSnapshot():StocksSnapshot {
  const policy=parseStocksConfig({enabled:true,benchmark:"DEMO",moveThresholdPercent:2,assets:Array.from({length:12},(_,index)=>({
    id:index===0?"DEMO":`DEMO${index}`,symbol:(index===0?"DEMO":`DEMO${index}`)+".US",
    name:index===0?"Synthetic broad market exchange-traded fund with a long descriptive name":`Synthetic Company ${index}`,
    isin:"US"+String(index).padStart(10,"0"),currency:"USD",exchange:"US",timezone:"America/New_York",kind:index===0?"etf":"stock",
  }))});
  return {version:1,state:"partial",capturedAt:at,data:{provider:"eodhd",policy,series:policy.assets.map((asset,index)=>({
    asset,state:index===11?"unavailable":index===10?"stale":"ready",fetchedAt:index===11?null:index===10?"2026-09-10T07:00:00Z":at,
    points:index===11?[]:Array.from({length:95},(_,day)=>({date:dayShift("2026-06-17",day),close:100+index*4+day*.12+Math.sin(day/4)*(index+1),adjusted:100+index*4+day*.12+Math.sin(day/4)*(index+1)})),
  }))}};
}

export function syntheticStocksFilled(lang:DigestLanguage="ru",expanded=false):string {
  return withDigestLanguage(lang,()=>renderStocksPage(syntheticStocksSnapshot(),new URLSearchParams(expanded?"symbols=DEMO&period=3m":""),at));
}
