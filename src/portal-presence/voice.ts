import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync} from "node:fs";
import {resolve} from "node:path";
import {execFile} from "node:child_process";
import {homedir} from "node:os";
import {dirname} from "node:path";
import {resolveKuramiHome} from "../core/kurami-home.ts";
import type {KuramiMood} from "../ui-library/components/kurami-mood.ts";

export type VoiceLanguage="ru"|"en";
export type PresenceContext={portal:"hub"|"projects"|"digest"|"docs";mood:KuramiMood;reason:string;facts?:Record<string,string|number|boolean>};
export type PortalVoice={key:string;speech:string;lines:string[];language:VoiceLanguage};
type CachedVoice={key:string;language:VoiceLanguage;lines:string[];createdAt:string};
export const VOICE_TTL_MS=12*60*60*1000;
const profile="kurami-portal-voice-v1";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const homeDefault=()=>resolveKuramiHome("/home/shagon1k/_hermes/_kurami");
export const voiceDirectory=(home:string)=>resolve(home,"state/briefing/portal-voice");
export const soulPath=(home:string)=>resolve(home,"../_core/SOUL.md");
let soulMemo:{path:string;at:number;version:string}|undefined;
function soulVersion(home:string):string {
  const path=soulPath(home);
  if(soulMemo?.path===path&&Date.now()-soulMemo.at<300_000)return soulMemo.version;
  let content="";try{content=readFileSync(path,"utf8");}catch{}
  const version=hash(profile+content);soulMemo={path,at:Date.now(),version};return version;
}
export function voiceKey(context:PresenceContext,language:VoiceLanguage,home=homeDefault()):string {
  const facts=Object.fromEntries(Object.entries(context.facts??{}).sort(([a],[b])=>a.localeCompare(b)));
  return hash(JSON.stringify({version:soulVersion(home),portal:context.portal,mood:context.mood,reason:context.reason,facts,language}));
}
export function fallbackLines(context:PresenceContext,language:VoiceLanguage):string[] {
  const ru=language==="ru";
  if(context.portal==="docs")return ru?["Тут разобрано, как всё устроено. Начни с карты системы.","Начни с общей картины. В детали нырнём по мере надобности.","Если потеряешься в деталях, вернись к карте системы."]:["This is how it all fits together. Start with the system map.","Start with the bigger picture. We can get into the details as you need them.","If the details get tangled, come back to the system map."];
  if(context.portal==="digest")return ru?["Всё, ты в курсе. Можно выдохнуть.","На сегодня картина собрана. Новости могут немного побыть без тебя.","Добрались до конца. Теперь можно заняться своим днём."]:["You're up to date. Take a breath.","That's the picture for today. The news can manage without you for a bit.","We made it to the end. Time to get on with your day."];
  switch(context.mood){
    case "needs-decision":return ru?["Тут нужен твой взгляд. Как решишь — продолжим.","На этом шаге нужен ты. Давай выберем, как двигаться дальше.","Оставила тебе место за рулём. Посмотри, что ждёт решения."]:["I need your take here. Once you decide, we can move on.","This step needs you. Let's choose where to go next.","Your turn at the wheel. Have a look at what needs a decision."];
    case "alert":case "found-problem":return ru?["Есть проблема, которая требует внимания. Посмотри подробности.","Здесь стоит разобраться с проблемой. Всё известное — в подробностях."]:["There's a problem that needs attention. Open the details.","This needs a closer look. The details show what we know."];
    case "offline":return ru?["Сейчас не вижу актуальное состояние. Давай дождёмся данных.","Данные пока недоступны. Как появятся, будет понятнее."]:["I can't see the current state right now. Let's wait for fresh data.","The data is unavailable for now. We'll know more when it returns."];
    case "working":return ru?["Работа идёт. Текущий этап можно посмотреть в задачах.","Процессы ещё крутятся. Загляни в задачи, если хочется подробностей.","Пока всё в работе. Результаты будем оценивать по мере готовности."]:["Work is moving along. The tasks show the current step.","Things are still running. Open the tasks if you want the details.","Still in progress. We'll look at the results as they become ready."];
    case "asleep":return ru?["Сейчас спокойно. Остальное можно оставить до утра.","Тихая смена. Можно немного отдохнуть."]:["It's quiet right now. The rest can wait until morning.","A quiet shift. Get some rest if you can."];
    default:return ru?["Срочного ничего. Можно спокойно выбрать, чем займёмся дальше.","Сейчас спокойно. Давай без спешки.","Спокойный момент. Можно оглядеться и выбрать следующий шаг."]:["Nothing urgent. We can take our time choosing what's next.","It's quiet right now. No need to rush.","A quiet moment. Have a look around and pick the next step."];
  }
}
export function validateVoiceLines(value:unknown,language:VoiceLanguage):string[] {
  if(!Array.isArray(value)||value.length<2||value.length>4)throw new Error("Invalid voice bank");
  const lines=value.map(line=>{
    if(typeof line!=="string")throw new Error("Invalid voice line");
    const text=line.trim().replace(/\s+/g," ");
    if(text.length<12||text.length>220||/[<>\d]|https?:|\p{Cc}/u.test(text))throw new Error("Unsafe voice line");
    if(language==="ru"?!/[А-Яа-яЁё]/u.test(text):/[А-Яа-яЁё]/u.test(text))throw new Error("Wrong voice language");
    return text;
  });
  if(new Set(lines).size!==lines.length)throw new Error("Repeated voice line");
  return lines;
}
export function cachedPortalVoice(key:string,language:VoiceLanguage,home=homeDefault(),now=Date.now()):CachedVoice|null {
  if(!/^[a-f0-9]{64}$/.test(key))return null;
  try{
    const value=JSON.parse(readFileSync(resolve(voiceDirectory(home),`${key}.json`),"utf8")) as CachedVoice;
    const age=now-Date.parse(value.createdAt);
    if(value.key!==key||value.language!==language||!Number.isFinite(age)||age<0||age>=VOICE_TTL_MS)return null;
    return {...value,lines:validateVoiceLines(value.lines,language)};
  }catch{return null;}
}
type VoiceRequest={context:PresenceContext;language:VoiceLanguage;key:string;requestedAt:string};
type Starter=(home:string,key:string)=>Promise<void>;
let scheduler:((context:PresenceContext,language:VoiceLanguage,key:string)=>void)|undefined;
export function portalVoice(context:PresenceContext,language:VoiceLanguage,home=homeDefault()):PortalVoice {
  const key=voiceKey(context,language,home),cached=cachedPortalVoice(key,language,home);
  const lines=cached?.lines??fallbackLines(context,language);
  scheduler?.(context,language,key);
  return {key,language,lines,speech:lines[0]!};
}
const defaultStarter:Starter=(home,key)=>new Promise((done,reject)=>{
  execFile("systemd-run",["--user","--collect","--quiet",`--unit=kurami-voice-${key.slice(0,24)}`,"--slice=kurami-dev.slice","-p",`Environment=PATH=${dirname(process.execPath)}:${homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin`,"-p",`Environment=KURAMI_HOME=${home}`,"--",process.execPath,resolve(home,"app/src/portal-presence/worker.ts"),"--key",key],{timeout:10_000},error=>error?reject(error):done());
});
/** Production entry points enable jobs. Renderers and tests never start model work by themselves. */
export function configurePortalVoice(home:string,start:Starter=defaultStarter):()=>void {
  const pending=new Set<string>();let nextStart=0;
  const previous=scheduler;
  scheduler=(context,language,key)=>{
    if(context.mood==="alert"||context.mood==="found-problem"||context.mood==="offline"||cachedPortalVoice(key,language,home)||pending.has(key)||Date.now()<nextStart)return;
    nextStart=Date.now()+60_000;pending.add(key);
    void Promise.resolve().then(async()=>{
      mkdirSync(voiceDirectory(home),{recursive:true,mode:0o700});
      const path=resolve(voiceDirectory(home),`${key}.request.json`);
      if(existsSync(path)){
        try{const previous=JSON.parse(readFileSync(path,"utf8")) as VoiceRequest;if(Date.now()-Date.parse(previous.requestedAt)<300_000)return;}catch{}
        try{unlinkSync(path);}catch{}
      }
      const request:VoiceRequest={context,language,key,requestedAt:new Date().toISOString()};
      try{writeFileSync(path,JSON.stringify(request),{flag:"wx",mode:0o600});}catch{return;}
      try{await start(home,key);}catch{try{unlinkSync(path);}catch{}}
    }).catch(()=>{}).finally(()=>pending.delete(key));
  };
  const installed=scheduler;
  return ()=>{if(scheduler===installed)scheduler=previous;};
}
export function writePortalVoice(home:string,request:VoiceRequest,lines:unknown,now=new Date()):void {
  if(request.key!==voiceKey(request.context,request.language,home))throw new Error("Voice context changed");
  const value:CachedVoice={key:request.key,language:request.language,lines:validateVoiceLines(lines,request.language),createdAt:now.toISOString()};
  const path=resolve(voiceDirectory(home),`${request.key}.json`),temporary=path+`.${process.pid}.tmp`;
  writeFileSync(temporary,JSON.stringify(value),{mode:0o600});renameSync(temporary,path);
}
