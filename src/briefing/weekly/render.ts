import type {BriefingPayload} from "../model.ts";
import {escapeHtml as e} from "../ui/html.ts";
import {renderPageShell} from "../ui/page-shell.ts";
import {renderMetricCards,type MetricCard} from "../ui/components/metric-strip.ts";
import {renderBarChart} from "../ui/charts/index.ts";
import {parseWeeklyReview,type WeeklyReview} from "./model.ts";
import {digestLanguage,digestText as t} from "../i18n.ts";

const dateLabel=(date:string)=>new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));
const duration=(minutes:number|null)=>minutes===null?"—":Math.floor(minutes/60)+t(" ч"," h")+(minutes%60?" "+minutes%60+t(" мин"," min"):"");
const value=(n:number|null)=>n===null?"—":String(n);

function englishInsights(review:WeeklyReview):string[] {
  const d=review.data,days=d.days;
  const label=(date:string)=>new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));
  const insights:string[]=[];
  const busiest=days.filter(day=>day.calendar).sort((a,b)=>b.calendar!.busyMinutes-a.calendar!.busyMinutes||a.date.localeCompare(b.date))[0];
  if(busiest?.calendar?.busyMinutes)insights.push(`Busiest observed day: ${label(busiest.date)} — ${busiest.calendar.busyMinutes} calendar minutes. This is scheduled time, not measured work.`);
  const overlap=days.reduce((sum,day)=>sum+(day.calendar?.overlapMinutes??0),0);
  if(overlap)insights.push(`${overlap} minutes of calendar events overlapped. Each overlapping minute is counted once.`);
  const inbox=days.filter(day=>day.inbox);
  if(inbox.length>=2){
    const first=inbox[0]!,last=inbox.at(-1)!,delta=last.inbox!.last-first.inbox!.first;
    insights.push(`Unread Primary mail: ${first.inbox!.first} → ${last.inbox!.last} between ${label(first.date)} and ${label(last.date)} (${delta>0?"+":""}${delta}). This is the change in remaining mail, not the number processed.`);
  }
  if(d.totals.more+d.totals.less<3)insights.push("Too few reactions to infer changing interests; only recorded signals are shown.");
  else if(d.topics[0])insights.push(`Most common topic among reacted-to stories: ${d.topics[0].label} — 🔔 ${d.topics[0].more}, 🔕 ${d.topics[0].less}. A story may have several topics.`);
  return insights.slice(0,3);
}

export function renderWeeklyTeaser(payload:BriefingPayload):string {
  const raw=payload.addons.weekly?.data.review;if(!raw)return "";
  const review=parseWeeklyReview(raw),d=review.data;
  return `<section class="weekly-teaser" aria-labelledby="weekly-teaser-heading">
    <div><p class="hero__eyebrow">${t("Воскресный обзор","Sunday review")} · ${e(dateLabel(d.start))} — ${e(dateLabel(d.end))}</p>
    <h2 id="weekly-teaser-heading">${t("Неделя в нескольких цифрах","The week in numbers")}</h2>
    <p>${e(duration(d.totals.calendarMinutes))} ${t("в календаре","on the calendar")} · ${d.totals.more+d.totals.less} ${t("реакций на сюжеты","story reactions")} · ${t("данные календаря за","calendar data for")} ${d.coverage.calendar}/7 ${t("дней","days")}</p></div>
    <a class="button button--secondary" href="/weekly">${t("Открыть обзор","Open review")} →</a></section>`;
}

export function renderWeeklyPage(raw:WeeklyReview|null,preview=false):string {
  if(!raw) return renderPageShell({title:t("Неделя","Weekly"),brand:"Kurami Weekly",section:"weekly",date:new Date().toISOString().slice(0,10),dateLabel:t("По воскресеньям","Sundays"),generated:"—",timezone:"Europe/Vilnius",
    content:`<section class="hero"><div><p class="hero__eyebrow">Weekly Review</p><h1>${t("Здесь будет ваша неделя","Your week will appear here")}</h1><p class="hero__subtitle">${t("Обзор появится вместе с воскресным Daily в 09:00. Сейчас накапливаются наблюдения.","The review appears with Sunday's 09:00 Daily edition. Observations are still accumulating.")}</p><a href="/">${t("Вернуться к Daily","Back to Daily")} →</a></div></section>`});
  const review=parseWeeklyReview(raw),d=review.data,period=dateLabel(d.start)+" — "+dateLabel(d.end);
  const cards:MetricCard[]=[
    {key:"weekly-time",label:t("Занято в календаре","Calendar time"),value:duration(d.totals.calendarMinutes),chip:d.coverage.calendar+t("/7 дней","/7 days"),context:t("Без двойного счёта пересечений; не фактически отработанное время","Overlaps counted once; not actual work time")},
    {key:"weekly-stories",label:t("Сюжеты в выпусках","Stories in editions"),value:value(d.totals.stories),chip:d.coverage.news+t("/7 дней","/7 days"),context:t("Сумма сюжетов в сохранённых дневных срезах","Sum of stories in saved Daily snapshots")},
    {key:"weekly-archive",label:t("Архивировано через Daily","Archived through Daily"),value:String(d.totals.archived),chip:t("Подтверждённые действия","Confirmed actions"),context:t("Не включает действия напрямую в Gmail","Excludes actions taken directly in Gmail")},
    {key:"weekly-reactions",label:t("Предпочтения","Preferences"),value:d.totals.more+" / "+d.totals.less,segments:[{icon:"bell",value:d.totals.more,label:t("Больше","More")},{icon:"bellOff",value:d.totals.less,label:t("Меньше","Less")}],chip:t("По уникальным сюжетам","Unique stories"),context:t("Последняя реакция за период; отменённые не учитываются","Latest reaction in the period; cleared reactions excluded")},
  ];
  const categories=d.days.map(day=>({key:day.date,label:dateLabel(day.date),shortLabel:dateLabel(day.date)}));
  const calendar=renderBarChart({id:"weekly-calendar",title:t("Календарная нагрузка","Calendar load"),description:t("Минуты, занятые событиями в календаре. Неизвестные дни — пропуски, а не нули.","Minutes occupied by calendar events. Unknown days are gaps, not zeroes."),
    xLabel:t("День","Day"),yLabel:t("Минуты","Minutes"),unit:{kind:"number",suffix:t("мин","min")},categories,series:[{id:"busy",label:t("Занято","Busy"),values:d.days.map(day=>day.calendar?.busyMinutes??null)}]});
  const mail=renderBarChart({id:"weekly-mail",title:"Unread Primary",description:t("Последнее доступное наблюдение каждого дня. Это остаток писем, не количество новых за сутки.","The last available observation each day. This is remaining mail, not new arrivals."),
    xLabel:t("День","Day"),yLabel:t("Письма","Mail"),unit:{kind:"number"},categories,series:[{id:"unread",label:t("Непрочитанные","Unread"),values:d.days.map(day=>day.inbox?.last??null)}]});
  const topicRows=d.topics.map(topic=>`<tr><th scope="row">${e(topic.label)}</th><td>${topic.more}</td><td>${topic.less}</td><td>${topic.net>0?"+":""}${topic.net}</td><td>${topic.previousNet>0?"+":""}${topic.previousNet}</td></tr>`).join("");
  const content=`<section class="hero"><div><p class="hero__eyebrow">${preview?t("Предпросмотр · не опубликованный недельный выпуск","Preview · unpublished weekly edition"):"Weekly Review"}</p>
    <h1>${t("Неделя, без лишнего шума.","The week, without the noise.")}</h1><p class="hero__subtitle">${e(period)} · ${t("семь завершённых дней","seven completed days")}</p><a href="/">← ${t("К Daily","Daily")}</a></div></section>
    ${review.state!=="ready"?`<aside class="weekly-caveat"><strong>${t("Пока неполная история.","History is incomplete.")}</strong> ${t("Календарь","Calendar")}: ${d.coverage.calendar}/7 ${t("дней","days")}, ${t("почта","mail")}: ${d.coverage.mail}/7, ${t("новости","news")}: ${d.coverage.news}/7. ${t("Уже удалённые данные не восстанавливались; неполные недели не сравниваю как полные.","Deleted data was not restored; incomplete weeks are not compared as full weeks.")}</aside>`:""}
    <div class="weekly-metrics">${renderMetricCards(cards,d.timezone)}</div>
    <section class="weekly-observations" aria-labelledby="weekly-notes"><p class="hero__eyebrow">${t("По вашим данным","From your data")}</p><h2 id="weekly-notes">${t("Что заметила Курами","What Kurami noticed")}</h2>
      ${(digestLanguage()==="en"?englishInsights(review):d.insights).length?`<ol>${(digestLanguage()==="en"?englishInsights(review):d.insights).map(text=>`<li>${e(text)}</li>`).join("")}</ol>`:`<p>${t("Пока недостаточно наблюдений для содержательных выводов.","Not enough observations for meaningful conclusions yet.")}</p>`}
      ${d.calendarDeltaMinutes!==null?`<p>${t("Относительно прошлой полной недели","Compared with the previous full week")}: ${d.calendarDeltaMinutes>0?"+":""}${d.calendarDeltaMinutes} ${t("минут в календаре","calendar minutes")}.</p>`:""}
    </section>
    <div class="weekly-charts">${calendar}${mail}</div>
    <section class="weekly-topics" aria-labelledby="weekly-topics"><h2 id="weekly-topics">${t("На что вы реагировали","What you reacted to")}</h2>
      <p>${t("Сигналы интереса, не оценка самих событий. Тема может встречаться в нескольких сюжетах; баланс — 🔔 минус 🔕, а не вес Interest Profile.","These are interest signals, not judgments about events. A topic may appear in several stories; balance is 🔔 minus 🔕, not an Interest Profile weight.")}</p>
      ${topicRows?`<div class="table table--numeric weekly-table"><table><thead><tr><th>${t("Тема","Topic")}</th><th>${t("Больше","More")}</th><th>${t("Меньше","Less")}</th><th>${t("Баланс","Balance")}</th><th>${t("Прошлая неделя","Previous week")}</th></tr></thead><tbody>${topicRows}</tbody></table></div>`:`<p>${t("За этот период реакций на сюжеты нет.","No story reactions in this period.")}</p>`}
    </section>
    <details class="disclosure weekly-method"><summary>${t("Как посчитано","How it is calculated")}</summary><p>${t("Календарь отражает запланированные события, без отменённых, отклонённых и демонстрационных. События на весь день не превращаются в рабочие часы. Почтовые наблюдения привязаны к дню получения, а не к дате страницы. Действия вне Daily не выдаются за архивирование через дайджест. Все выводы рассчитаны по фиксированным правилам, без дополнительных запросов к AI.","Calendar time covers scheduled events, excluding cancelled, declined and demo events. All-day events are not converted into work hours. Mail observations follow the day they were received, not the page date. Actions outside Daily are not counted as archiving through the digest. Every conclusion follows fixed rules, without additional AI requests.")}</p></details>`;
  return renderPageShell({title:t("Недельный обзор","Weekly review"),brand:"Kurami Weekly",section:"weekly",date:d.publicationDate,dateLabel:period,
    generated:new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU",{timeZone:d.timezone,hour:"2-digit",minute:"2-digit"}).format(new Date(review.capturedAt)),updatedAt:review.capturedAt,timezone:d.timezone,content});
}
