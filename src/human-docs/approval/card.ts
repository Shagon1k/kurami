// The #updates card for one docs proposal. Pure: proposal row in, Components V2 payload out.
import {actionRow,button,componentMessage,container,separator,textDisplay,type DiscordObject} from "../../discord/ui.ts";
import {acceptsAction,controlId,type PageChange} from "./policy.ts";
import {pagesOf,type ProposalRow} from "./store.ts";

const PRIMARY=1,SECONDARY=2,SUCCESS=3,DANGER=4,LINK=5;
const MAX_PAGES=12;

const accent:Record<ProposalRow["state"],number>={
  drafting:0xfee75c,ready:0x5865f2,revising:0xfee75c,publishing:0xfee75c,
  published:0x57f287,rejected:0x99aab5,empty:0x99aab5,failed:0xed4245,
};

function ownerTime(value:string):string {
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Vilnius",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})
    .formatToParts(new Date(value)).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  return `${parts.day}.${parts.month} ${parts.hour}:${parts.minute}`;
}

function ownerDay(value:string):string {
  return ownerTime(value).slice(0,5);
}

function pageLines(pages:PageChange[]):string {
  if(!pages.length)return "Страницы не менялись: только журнал изменений или служебные записи.";
  const verb={added:"новая",changed:"изменена",removed:"удалена"};
  const lines=pages.slice(0,MAX_PAGES).map(page=>`• ${page.titleRu} — ${verb[page.change]}`);
  if(pages.length>MAX_PAGES)lines.push(`• и ещё ${pages.length-MAX_PAGES}`);
  return lines.join("\n");
}

function statusText(row:ProposalRow):string {
  switch(row.state){
    case "drafting":return "Проверка ещё пишет черновик.";
    case "ready":return [
      row.last_error?`Прошлая попытка публикации не удалась: ${row.last_error}.`:"",
      row.thread_id
        ?"Готово к решению. Замечания пиши в обсуждении, затем жми «Применить правки»."
        :"Готово к решению. Сайт изменится только после «Опубликовать».",
    ].filter(Boolean).join(" ");
    case "revising":return "Применяю замечания из обсуждения. Карточка обновится, когда правки пройдут проверки.";
    case "publishing":return "Публикую: сливаю PR и выпускаю документацию. Это займёт до пары минут.";
    case "published":return `Опубликовано. Документация собрана из \`${(row.published_docs_sha??"").slice(0,7)}\`, предыдущая версия сохранена для отката.`;
    case "rejected":return "Отклонено. PR закрыт, ветка осталась на GitHub.";
    case "empty":return "Менять нечего.";
    case "failed":return row.merged_sha
      ?`PR уже слит, но выпуск не удался, сайт не изменён: ${row.last_error??"причина не записана"}. «Опубликовать» повторит только выпуск.`
      :`Не прошло проверку: ${row.last_error??"причина не записана"}`;
  }
}

function buttons(row:ProposalRow):DiscordObject[] {
  const merged=Boolean(row.merged_sha);
  const items:DiscordObject[]=[];
  if(acceptsAction(row.state,"publish",merged))items.push(button(merged?"Повторить выпуск":"Опубликовать",SUCCESS,controlId("publish",row.proposal_id)));
  if(row.thread_id){
    if(acceptsAction(row.state,"revise",merged))items.push(button("Применить правки",PRIMARY,controlId("revise",row.proposal_id)));
  } else if(acceptsAction(row.state,"discuss",merged))items.push(button("Обсудить",SECONDARY,controlId("discuss",row.proposal_id)));
  if(acceptsAction(row.state,"reject",merged))items.push(button("Отклонить",DANGER,controlId("reject",row.proposal_id)));
  if(row.pr_url)items.push(button(row.pr_number?`PR #${row.pr_number}`:"PR",LINK,undefined,row.pr_url));
  return items;
}

export function cardPayload(row:ProposalRow):DiscordObject {
  const body:DiscordObject[]=[
    textDisplay(`## Документация · предложение от ${ownerDay(row.created_at)}`),
  ];
  if(row.summary_ru)body.push(textDisplay(row.summary_ru));
  body.push(textDisplay(pageLines(pagesOf(row))));
  body.push(separator());
  body.push(textDisplay(statusText(row)));
  if(row.thread_id&&!["published","rejected"].includes(row.state))body.push(textDisplay(`Обсуждение: <#${row.thread_id}>`));
  const actions=buttons(row);
  if(actions.length)body.push(actionRow(actions));
  const revisions=row.revision_count?` · правок из обсуждения: ${row.revision_count}`:"";
  body.push(textDisplay(`-# ${row.proposal_id}${revisions} · обновлено ${ownerTime(row.updated_at)}`));
  return componentMessage([container(body,accent[row.state])]);
}

/** First message of a discussion thread: how to use it, with the same guarded button as the card. */
export function threadIntroPayload(row:ProposalRow):DiscordObject {
  return componentMessage([
    textDisplay("Пиши сюда, что поправить в предложении: страницу, фразу или факт. Когда закончишь, жми «Применить правки». Агент изменит ту же ветку, прогонит проверки и обновит карточку. Учитываются только твои сообщения."),
    actionRow([button("Применить правки",PRIMARY,controlId("revise",row.proposal_id))]),
  ]);
}
