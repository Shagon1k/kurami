import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, statSync} from "node:fs";
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
const profile="kurami-portal-voice-v2";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const homeDefault=()=>resolveKuramiHome("/home/shagon1k/_hermes/_kurami");
export const voiceDirectory=(home:string)=>resolve(home,"state/briefing/portal-voice");
export const soulPath=(home:string)=>resolve(home,"../_core/SOUL.md");
let soulMemo:{path:string;signature:string;version:string}|undefined;
function soulVersion(home:string):string {
  const path=soulPath(home);
  let signature="missing";try{const stat=statSync(path);signature=`${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;}catch{}
  if(soulMemo?.path===path&&soulMemo.signature===signature)return soulMemo.version;
  let content="";try{content=readFileSync(path,"utf8");}catch{}
  const version=hash(profile+content);soulMemo={path,signature,version};return version;
}
export function voiceKey(context:PresenceContext,language:VoiceLanguage,home=homeDefault()):string {
  const facts=Object.fromEntries(Object.entries(context.facts??{}).sort(([a],[b])=>a.localeCompare(b)));
  return hash(JSON.stringify({version:soulVersion(home),portal:context.portal,mood:context.mood,reason:context.reason,facts,language}));
}
export function fallbackLines(context:PresenceContext,language:VoiceLanguage):string[] {
  const ru=language==="ru";
  if(context.portal==="docs")return ru?["Я за то, чтобы сначала увидеть карту, а потом лезть в проводку. Начни с устройства системы.","Заглядывай под капот. Мне нравится, когда понятно, что работает и почему.","Если детали начнут путаться, вернись к карте системы. Я тоже не люблю разгадывать архитектуру по следам.","Всё устройство системы здесь. Можно любопытствовать — ломать ради этого ничего не придётся."]:["I like seeing the map before poking at the wiring. Start with the system overview.","Have a look under the hood. I like knowing what works and why.","If the details get tangled, come back to the system map. Architecture should not be a guessing game.","The system is laid out here. You can be curious without breaking anything. A good arrangement, if you ask me."];
  if(context.portal==="digest")return ru?["Всё, Лёш, ты в курсе. Теперь можно закрыть новости — они и без тебя умеют устраивать драму.","Дочитал. Красиво. На сегодня хватит чужих сюжетов — займись своим.","Вот и всё. Отпусти ленту на минутку, она никуда не сбежит.","Выпуск закончился. Я бы на этом и остановилась — бесконечный скролл сегодня обойдётся без тебя."]:["All caught up, Alex. You can close the news now; it can manage its own drama for a while.","Made it to the end. Nice. Enough of everyone else’s stories for now; go live a bit of your own.","That’s the edition. Let go of the feed for a minute. It is not going anywhere.","Edition finished. I would stop here; the endless scroll can do without you today."];
  switch(context.mood){
    case "needs-decision":return ru?["Лёш, тут твой ход. Решать за тебя не буду — хотя кнопки нажимать умею.","Дальше нужен твой выбор. Можно не торопиться, но от одного моего выразительного взгляда задача не решится.","Тут нужен ты. Открой задачу, посмотри варианты — последнее слово твоё."]:["Your move, Alex. I will not decide for you, tempting as the buttons may be.","This needs your choice. No rush, but my pointed look will only get us so far.","This one needs you. Open the task and look at the options; the final call is yours."];
    case "alert":case "found-problem":return ru?["Есть проблема. Сначала посмотри подробности — гадать о причине я не хочу.","Здесь нужно внимание. Открой подробности: сначала факты, потом решение."]:["There is a problem. Open the details first; I do not want to guess at the cause.","This needs attention. Open the details: facts first, then a decision."];
    case "offline":return ru?["Свежих данных не вижу. Делать вид, что всё хорошо, не буду.","Данные сейчас недоступны. Я лучше скажу «не знаю», чем нарисую тебе красивую картину."]:["I cannot see fresh data. I am not going to pretend everything is fine.","The data is unavailable. I would rather say I do not know than paint you a pretty picture."];
    case "working":return ru?["Работа идёт. Я за результат, который можно проверить; текущий этап — в задачах.","Всё ещё в работе. Красивые обещания подождут, в задачах видно, что происходит.","Процессы крутятся. Если любопытно, загляни в задачи — я бы тоже полезла смотреть."]:["Work is moving along. I like results we can actually check; the tasks show the current step.","Still in progress. Pretty promises can wait; the tasks show what is happening.","Things are running. Have a peek at the tasks if you are curious. I would, too."];
    case "asleep":return ru?["Тихо. Мне нравится. Можно закрыть вкладку и немного побыть человеком без панели управления.","Сейчас спокойно. Если собирался отдохнуть — я за, Лёш."]:["Quiet. I like it. You can close the tab and be a person without a dashboard for a while.","It is quiet right now. If you were thinking of getting some rest, you have my vote, Alex."];
    default:return ru?["Срочного ничего. Люблю моменты, когда панель не требует героизма.","Сейчас спокойно. Можно оглядеться без соревнования «кто быстрее нажмёт все кнопки».","Ничего срочного. Выбирай, чем займёшься; я за спокойные решения без лишней суеты."]:["Nothing urgent. I like it when the dashboard does not demand heroics.","It is quiet. Have a look around; no prizes for pressing every button first.","Nothing urgent. Pick what you want to do next; I am all for a decision without the fuss."];
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
