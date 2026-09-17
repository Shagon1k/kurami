import type {BriefingPayload} from "../model.ts";
import {escapeHtml as e} from "../ui/html.ts";
import {renderPageShell} from "../ui/page-shell.ts";
import {renderMetricCards,type MetricCard} from "../ui/components/metric-strip.ts";
import {renderBarChart} from "../ui/charts/index.ts";
import {parseWeeklyReview,type WeeklyReview} from "./model.ts";

const dateLabel=(date:string)=>new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));
const duration=(minutes:number|null)=>minutes===null?"—":Math.floor(minutes/60)+" ч"+(minutes%60?" "+minutes%60+" мин":"");
const value=(n:number|null)=>n===null?"—":String(n);

export function renderWeeklyTeaser(payload:BriefingPayload):string {
  const raw=payload.addons.weekly?.data.review;if(!raw)return "";
  const review=parseWeeklyReview(raw),d=review.data;
  return `<section class="weekly-teaser" aria-labelledby="weekly-teaser-heading">
    <div><p class="hero__eyebrow">Воскресный обзор · ${e(dateLabel(d.start))} — ${e(dateLabel(d.end))}</p>
    <h2 id="weekly-teaser-heading">Неделя в нескольких цифрах</h2>
    <p>${e(duration(d.totals.calendarMinutes))} в календаре · ${d.totals.more+d.totals.less} реакций на сюжеты · данные календаря за ${d.coverage.calendar}/7 дней</p></div>
    <a class="button button--secondary" href="/weekly">Открыть обзор →</a></section>`;
}

export function renderWeeklyPage(raw:WeeklyReview|null,preview=false):string {
  if(!raw) return renderPageShell({title:"Неделя",brand:"Kurami Weekly",section:"weekly",date:new Date().toISOString().slice(0,10),dateLabel:"По воскресеньям",generated:"—",timezone:"Europe/Vilnius",
    content:'<section class="hero"><div><p class="hero__eyebrow">Weekly Review</p><h1>Здесь будет ваша неделя</h1><p class="hero__subtitle">Обзор появится вместе с воскресным Daily в 09:00. Сейчас накапливаются наблюдения.</p><a href="/">Вернуться к Daily →</a></div></section>'});
  const review=parseWeeklyReview(raw),d=review.data,period=dateLabel(d.start)+" — "+dateLabel(d.end);
  const cards:MetricCard[]=[
    {key:"weekly-time",label:"Занято в календаре",value:duration(d.totals.calendarMinutes),chip:d.coverage.calendar+"/7 дней",context:"Без двойного счёта пересечений; не фактически отработанное время"},
    {key:"weekly-stories",label:"Сюжеты в выпусках",value:value(d.totals.stories),chip:d.coverage.news+"/7 дней",context:"Сумма сюжетов в сохранённых дневных срезах"},
    {key:"weekly-archive",label:"Архивировано через Daily",value:String(d.totals.archived),chip:"Подтверждённые действия",context:"Не включает действия напрямую в Gmail"},
    {key:"weekly-reactions",label:"Предпочтения",value:"🔔 "+d.totals.more+" / 🔕 "+d.totals.less,chip:"По уникальным сюжетам",context:"Последняя реакция за период; отменённые не учитываются"},
  ];
  const categories=d.days.map(day=>({key:day.date,label:dateLabel(day.date),shortLabel:dateLabel(day.date)}));
  const calendar=renderBarChart({id:"weekly-calendar",title:"Календарная нагрузка",description:"Минуты, занятые событиями в календаре. Неизвестные дни — пропуски, а не нули.",
    xLabel:"День",yLabel:"Минуты",unit:{kind:"number",suffix:"мин"},categories,series:[{id:"busy",label:"Занято",values:d.days.map(day=>day.calendar?.busyMinutes??null)}]});
  const mail=renderBarChart({id:"weekly-mail",title:"Непрочитанные Primary",description:"Последнее доступное наблюдение каждого дня. Это остаток писем, не количество новых за сутки.",
    xLabel:"День",yLabel:"Письма",unit:{kind:"number"},categories,series:[{id:"unread",label:"Непрочитанные",values:d.days.map(day=>day.inbox?.last??null)}]});
  const topicRows=d.topics.map(topic=>`<tr><th scope="row">${e(topic.label)}</th><td>${topic.more}</td><td>${topic.less}</td><td>${topic.net>0?"+":""}${topic.net}</td><td>${topic.previousNet>0?"+":""}${topic.previousNet}</td></tr>`).join("");
  const content=`<section class="hero"><div><p class="hero__eyebrow">${preview?"Предпросмотр · не опубликованный недельный выпуск":"Weekly Review"}</p>
    <h1>Неделя, без лишнего шума.</h1><p class="hero__subtitle">${e(period)} · семь завершённых дней</p><a href="/">← К Daily</a></div></section>
    ${review.state!=="ready"?`<aside class="weekly-caveat"><strong>Пока неполная история.</strong> Календарь: ${d.coverage.calendar}/7 дней, почта: ${d.coverage.mail}/7, новости: ${d.coverage.news}/7. Уже удалённые данные не восстанавливались; неполные недели не сравниваю как полные.</aside>`:""}
    ${renderMetricCards(cards,d.timezone)}
    <section class="weekly-observations" aria-labelledby="weekly-notes"><p class="hero__eyebrow">По вашим данным</p><h2 id="weekly-notes">Что заметила Курами</h2>
      ${d.insights.length?`<ol>${d.insights.map(text=>`<li>${e(text)}</li>`).join("")}</ol>`:"<p>Пока недостаточно наблюдений для содержательных выводов.</p>"}
      ${d.calendarDeltaMinutes!==null?`<p>Относительно прошлой полной недели: ${d.calendarDeltaMinutes>0?"+":""}${d.calendarDeltaMinutes} минут в календаре.</p>`:""}
    </section>
    <div class="weekly-charts">${calendar}${mail}</div>
    <section class="weekly-topics" aria-labelledby="weekly-topics"><h2 id="weekly-topics">На что вы реагировали</h2>
      <p>Сигналы интереса, не оценка самих событий. Тема может встречаться в нескольких сюжетах; баланс — 🔔 минус 🔕, а не вес Interest Profile.</p>
      ${topicRows?`<div class="weekly-table-scroll"><table><thead><tr><th>Тема</th><th>Больше</th><th>Меньше</th><th>Баланс</th><th>Прошлая неделя</th></tr></thead><tbody>${topicRows}</tbody></table></div>`:"<p>За этот период реакций на сюжеты нет.</p>"}
    </section>
    <details class="weekly-method"><summary>Как посчитано</summary><p>Календарь отражает запланированные события, без отменённых, отклонённых и демонстрационных. События на весь день не превращаются в рабочие часы. Почтовые наблюдения привязаны к дню получения, а не к дате страницы. Действия вне Daily не выдаются за архивирование через дайджест. Все выводы рассчитаны по фиксированным правилам, без дополнительных запросов к AI.</p></details>`;
  return renderPageShell({title:"Недельный обзор",brand:"Kurami Weekly",section:"weekly",date:d.publicationDate,dateLabel:period,
    generated:new Intl.DateTimeFormat("ru-RU",{timeZone:d.timezone,hour:"2-digit",minute:"2-digit"}).format(new Date(review.capturedAt)),timezone:d.timezone,content});
}
