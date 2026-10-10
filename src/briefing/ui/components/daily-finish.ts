// At the end of Daily, Kurami shows the completion stamp in her handwriting. When the block comes into
// view, the client marks the edition as read (once per device); Hub's pulse then shows "Дайджест ✓ 08:05".
import type { BriefingPayload } from "../../model.ts";
import { section } from "../../addons/envelopes.ts";
import { renderKuramiPresence } from "../../../ui-library/components/kurami-mood.ts";
import { portalVoice } from "../../../portal-presence/voice.ts";
import { digestLanguage, digestText } from "../../i18n.ts";
import { escapeHtml } from "../html.ts";

const WORDS_PER_MINUTE = 200;

export function readingMinutes(payload: BriefingPayload): number {
  const text = section(payload, "news").items.map(story => [story.headline, story.summary, ...(story.details ?? [])].join(" ")).join(" ");
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE));
}

export function renderDailyFinish(payload: BriefingPayload): string {
  if (payload.edition.type !== "daily") return "";
  const stories = section(payload, "news").items.length;
  const voice=portalVoice({portal:"digest",mood:"done",reason:"reading-finish",facts:{edition:payload.edition.id,stories}},digestLanguage());
  return `<section class="daily-finish" data-daily-finish data-edition-id="${escapeHtml(payload.edition.id)}" aria-labelledby="daily-finish-heading">
    <div class="daily-finish__copy">
      <h2 id="daily-finish-heading">${digestText("Всё. Ты в курсе.", "That's all. You're up to date.")}</h2>
    </div>${renderKuramiPresence({...voice,mood:"done",meta:`<div class="daily-finish__meta"><p class="daily-finish__stamp" data-read-stamp data-label="${digestText("дочитано", "finished")}" data-label-at="${digestText("дочитано в", "finished at")}" hidden></p></div>`})}
  </section>`;
}

/** Marks the edition read when the finish is half visible; the server keeps the first read time. */
export const DAILY_FINISH_SCRIPT = String.raw`
(()=>{
  const finish=document.querySelector('[data-daily-finish]');if(!finish||!('IntersectionObserver' in window))return;
  const id=finish.dataset.editionId,key='kurami-read:'+id,stamp=finish.querySelector('[data-read-stamp]');
  // "✓ finished at 08:15": the time this device reached the end (older marks without a time show the word only).
  const show=at=>{const time=at&&Number.isFinite(Date.parse(at))?new Date(at).toLocaleTimeString(document.documentElement.lang==='en'?'en-GB':'ru-RU',{hour:'2-digit',minute:'2-digit'}):'';stamp.textContent='✓ '+(time?stamp.dataset.labelAt+' '+time:stamp.dataset.label);stamp.hidden=false;};
  let seen=null;try{seen=localStorage.getItem(key);}catch{}
  if(seen){show(seen==='1'?null:seen);return;}
  const observer=new IntersectionObserver(entries=>{
    if(!entries.some(entry=>entry.isIntersecting))return;
    observer.disconnect();const at=new Date().toISOString();show(at);finish.classList.add('is-read');
    try{localStorage.setItem(key,at);}catch{}
    fetch(kuramiAppUrl('/api/editions/read'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({editionId:id})}).catch(()=>{});
  },{threshold:.5});
  observer.observe(finish);
})();
`;

export const DAILY_FINISH_STYLES = `
.daily-finish { --kurami-presence-max-width: none; display: grid; gap: var(--space-4); margin-top: var(--space-8); padding: var(--space-5) 0 var(--space-2); border-top: 1px solid var(--border-default); }
.daily-finish__copy { position: relative; display: grid; gap: 6px; }
.daily-finish__copy h2 { margin: 0; font-size: clamp(1.5rem, 3vw, 2rem); }
.daily-finish__copy p { margin: 0; color: var(--text-muted); }
.daily-finish__meta { display: flex; justify-content: flex-end; width: 100%; text-align: right; }
.daily-finish__meta p { white-space: nowrap; }
.daily-finish__stamp { margin: 0; color: var(--text-accent); font: 600 1.25rem/1.1 var(--font-note); rotate: -2deg; text-shadow: var(--display-glow); }
.daily-finish.is-read .daily-finish__stamp { animation: daily-stamp .5s cubic-bezier(.2,.9,.3,1.4); }
@keyframes daily-stamp { from { scale: 1.8; opacity: 0; } to { scale: 1; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .daily-finish.is-read .daily-finish__stamp { animation: none; } }
`;
