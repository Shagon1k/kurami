// Synthetic pages for joint Digest/Docs browser regression. No private data; nothing here is fetched.
import {upgradeLegacyPayload} from "../../briefing/migrations/addon-format.ts";
import {renderBriefingPage} from "../../briefing/ui/render-page.ts";
import {renderStocksPage} from "../../briefing/stocks/render.ts";

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
