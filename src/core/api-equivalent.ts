import type {UsageEvent} from "./codex-usage.ts";

export const API_RATE_DATE="2026-09-30";
export const API_RATE_SOURCE="https://developers.openai.com/api/docs/pricing";
type Rates={input:number;cached:number;write:number;output:number;longContext:boolean};
const rates:Record<string,Rates>={
  "gpt-6-astra":{input:10,cached:1,write:12.5,output:50,longContext:true},
  "gpt-6-sol":{input:2,cached:.2,write:2.5,output:10,longContext:true},
  "gpt-6.1-sol":{input:2,cached:.1,write:2.5,output:10,longContext:true},
  "gpt-6-luna":{input:.1,cached:.01,write:.125,output:.5,longContext:true},
  "gpt-5.6-sol":{input:4,cached:.4,write:5,output:20,longContext:true},
  "gpt-5.6-luna":{input:.2,cached:.02,write:.25,output:1.2,longContext:true},
  "gpt-5.3-codex":{input:1.75,cached:.175,write:1.75,output:14,longContext:false},
};

export type ApiEquivalent={usd:number|null;pricedTokens:number;unpricedTokens:number;uncertainTokens:number};
export type ModelUsage={name:string;sessions:number;input:number;cached:number;cacheWrite:number|null;output:number;tokens:number;equivalent:ApiEquivalent};
export type UsageSample={event:UsageEvent;session:string};

/** Current Standard API rates, not subscription spending or historical invoices. */
export function estimateApiEquivalent(event:UsageEvent):{usd:number;uncertain:boolean}|null {
  const model=event.model==="gpt-5.6"?"gpt-5.6-sol":event.model;
  const rate=model&&Object.hasOwn(rates,model)?rates[model]:undefined;
  if(!rate||![event.input,event.cached,event.output,event.total].every(value=>Number.isSafeInteger(value)&&value>=0)||event.cached>event.input)return null;
  const write=event.cacheWrite??0;
  if(!Number.isSafeInteger(write)||write<0||event.cached+write>event.input)return null;
  if(event.requestInput!==null&&(!Number.isSafeInteger(event.requestInput)||event.requestInput<0))return null;
  const long=rate.longContext&&event.requestInput!==null&&event.requestInput>272_000;
  const inputFactor=long?2:1,outputFactor=long?1.5:1;
  const usd=((event.input-event.cached-write)*rate.input+event.cached*rate.cached+write*rate.write)*inputFactor/1e6+event.output*rate.output*outputFactor/1e6;
  return {usd,uncertain:rate.longContext&&(event.cacheWrite===null||event.requestInput===null)};
}

export function summarizeModelUsage(samples:UsageSample[]):{models:ModelUsage[];equivalent:ApiEquivalent} {
  const models=new Map<string,{row:ModelUsage;sessions:Set<string>}>();
  const empty=():ApiEquivalent=>({usd:null,pricedTokens:0,unpricedTokens:0,uncertainTokens:0});
  const equivalent=empty();
  const add=(target:ApiEquivalent,event:UsageEvent,price:ReturnType<typeof estimateApiEquivalent>)=>{
    if(price){target.usd=(target.usd??0)+price.usd;target.pricedTokens+=event.total;if(price.uncertain)target.uncertainTokens+=event.total;}
    else target.unpricedTokens+=event.total;
  };
  for(const {event,session} of samples){
    const name=event.model??"unknown";
    const group=models.get(name)??{row:{name,sessions:0,input:0,cached:0,cacheWrite:0,output:0,tokens:0,equivalent:empty()},sessions:new Set<string>()};
    const price=estimateApiEquivalent(event);
    group.row.input+=event.input;group.row.cached+=event.cached;
    group.row.cacheWrite=group.row.cacheWrite===null||event.cacheWrite===null?null:group.row.cacheWrite+event.cacheWrite;
    group.row.output+=event.output;group.row.tokens+=event.total;group.sessions.add(session);
    group.row.sessions=group.sessions.size;
    add(group.row.equivalent,event,price);add(equivalent,event,price);
    models.set(name,group);
  }
  return {models:[...models.values()].map(group=>group.row).sort((a,b)=>b.tokens-a.tokens||a.name.localeCompare(b.name)),equivalent};
}
