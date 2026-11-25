import type {RunUsage,UsageStage} from "../orchestrator/projects/usage/read-model.ts";
import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderInfoButton,renderInfoNote} from "../ui-library/components/info-tip.ts";
import type {Language} from "./i18n.ts";

const words={
  en:{title:"Usage & cost",pending:"Pending",partial:"Partial",complete:"Collected",unavailable:"Unavailable",input:"Input",cached:"Cached subset",output:"Output",model:"Model",unknown:"Unknown",elapsed:"Elapsed",attempts:"Observed attempts",estimate:"API-equivalent estimate",details:"Models and stages",stage:"Stage",sessions:"Sessions",outcome:"Outcome",shared:"Shared thread excluded",rates:"Rate source",tokens:"tokens",unpriced:"Tokens without a tariff",uncertain:"Tokens with uncertain pricing",
    note:"Input includes cached tokens. Output includes reasoning. Estimates use the saved Standard API tariff version, not subscription billing. Unknown tariffs are excluded; * marks incomplete or uncertain estimates. Elapsed is wall-clock time from run creation to its terminal transition, not active time. Attempts count recorded turns, or one per session without turn metadata, plus attempts missing a thread.",
    stages:{implementation:"Implementation",review:"Review",fix_review:"Fix review",fix_ci:"Fix CI",unknown:"Unattributed"}},
  ru:{title:"Использование и стоимость",pending:"Ожидается",partial:"Частично",complete:"Собрано",unavailable:"Недоступно",input:"Входные",cached:"Из них кеш",output:"Выходные",model:"Модель",unknown:"Неизвестно",elapsed:"Прошло времени",attempts:"Известные попытки",estimate:"Оценка эквивалента API",details:"Модели и этапы",stage:"Этап",sessions:"Сессии",outcome:"Итог",shared:"Общий поток исключён",rates:"Источник тарифа",tokens:"токенов",unpriced:"Токены без тарифа",uncertain:"Токены с неточной оценкой",
    note:"Входные токены включают кеш, выходные — рассуждения. Оценка использует сохранённую версию стандартного тарифа API, а не оплату подписки. Неизвестные тарифы исключены; * означает неполную или неточную оценку. Время отсчитывается от создания запуска до конечного перехода, а не измеряет активную работу. Попытки — записанные ходы или одна попытка на сессию без их метаданных, плюс попытки без потока.",
    stages:{implementation:"Реализация",review:"Ревью",fix_review:"Исправление ревью",fix_ci:"Исправление CI",unknown:"Этап неизвестен"}}
};
const number=(value:number|null,lang:Language)=>value===null?"—":new Intl.NumberFormat(lang).format(value);
const money=(value:number|null)=>value===null?"—":`$${value.toFixed(4)}`;
function amount(usage:RunUsage):string {return money(usage.usd)+(usage.usd!==null&&(usage.state!=="complete"||usage.unpriced>0||usage.uncertain>0)?" *":"");}

export function renderUsageSummary(usage:RunUsage|undefined,lang:Language):string {
  if(!usage?.terminal)return "";
  const w=words[lang];
  return `<small class="projects-usage-summary">${escapeHtml(w[usage.state])} · ${number(usage.input===null?null:usage.input+usage.output!,lang)} ${w.tokens} · ${escapeHtml(w.estimate)} ${amount(usage)}</small>`;
}

export function renderRunUsage(usage:RunUsage|undefined,lang:Language):string {
  if(!usage)return "";
  const w=words[lang],tip="projects-usage-note";
  const cell=(label:string,value:string)=>`<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
  const models=usage.models.length?renderTable({columns:[w.model,w.input,w.cached,w.output,w.estimate],rowHeaders:true,stack:true,
    rows:usage.models.map(row=>[row.model??w.unknown,number(row.input,lang),number(row.cached,lang),number(row.output,lang),money(row.usd)+(row.unpriced||row.uncertain?" *":"")])}):"";
  const stages=([...new Set(usage.sessions.map(row=>row.stage))] as UsageStage[]).map(stage=>{
    const rows=usage.sessions.filter(row=>row.stage===stage),models=rows.flatMap(row=>row.models);
    const sum=(key:"input"|"cached"|"output")=>models.length?models.reduce((total,row)=>total+row[key],0):null;
    return [w.stages[stage],String(rows.length),number(sum("input"),lang),number(sum("cached"),lang),number(sum("output"),lang),
      rows.some(row=>row.shared)?w.shared:rows.every(row=>row.state==="complete")?w.complete:w.partial];
  });
  const sessions=usage.sessions.length?renderTable({columns:[w.stage,w.attempts,w.elapsed,w.outcome],rowHeaders:true,stack:true,
    rows:usage.sessions.map(row=>[w.stages[row.stage],number(row.attempts,lang),row.elapsedMs===null?"—":`${number(Math.round(row.elapsedMs/60_000),lang)} ${lang==="ru"?"мин":"min"}`,
      row.shared?w.shared:row.outcome==="completed"?(lang==="ru"?"Завершено":"Completed"):row.outcome==="failed"?(lang==="ru"?"Ошибка":"Failed"):row.outcome==="cancelled"?(lang==="ru"?"Отменено":"Cancelled"):w.unknown])}):"";
  const pricingCoverage=usage.unpriced||usage.uncertain?`<p class="projects-update">${w.unpriced}: ${number(usage.unpriced,lang)} · ${w.uncertain}: ${number(usage.uncertain,lang)}</p>`:"";
  const detail=pricingCoverage+models+(stages.length?renderTable({columns:[w.stage,w.sessions,w.input,w.cached,w.output,w.title],rows:stages,rowHeaders:true,stack:true}):"")+sessions+
    (usage.rateSource?`<p class="projects-update">${w.rates}: <a href="${escapeHtml(usage.rateSource)}">${escapeHtml(usage.rateDate??"")}</a></p>`:"");
  return `<section class="projects-detail-section projects-usage" data-run-usage><h3>${w.title}${renderInfoButton({id:tip,label:w.title})}</h3>${renderInfoNote({id:tip,text:w.note})}<p class="projects-update" role="status">${w[usage.state]}</p><dl class="projects-usage-values">${cell(w.input,number(usage.input,lang))}${cell(w.cached,number(usage.cached,lang))}${cell(w.output,number(usage.output,lang))}${cell(w.estimate,amount(usage))}${cell(w.elapsed,usage.elapsedMs===null?"—":`${number(Math.round(usage.elapsedMs/60_000),lang)} ${lang==="ru"?"мин":"min"}`)}${cell(w.attempts,number(usage.attempts,lang))}</dl>${detail?renderDisclosure({summary:w.details,body:detail,variant:"inline",key:"run-usage-models"}):""}</section>`;
}
