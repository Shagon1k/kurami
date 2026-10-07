// The end of a Daily edition: Kurami with the OK sign, "Всё. Ты в курсе.", how long the edition takes to read
// and a "read" stamp. When the block comes into view, the client marks the edition as read (once per device);
// Hub's pulse line then shows "Дайджест ✓ 08:05". Paper stamps it in handwriting, Neon lights it up.
import type { BriefingPayload } from "../../model.ts";
import { section } from "../../addons/envelopes.ts";
import { renderKuramiMood } from "../../../ui-library/components/kurami-mood.ts";
import { digestText } from "../../i18n.ts";
import { escapeHtml } from "../html.ts";

const WORDS_PER_MINUTE = 200;

export function readingMinutes(payload: BriefingPayload): number {
  const text = section(payload, "news").items.map(story => [story.headline, story.summary, ...(story.details ?? [])].join(" ")).join(" ");
  return Math.max(1, Math.round(text.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE));
}

export function renderDailyFinish(payload: BriefingPayload): string {
  if (payload.edition.type !== "daily") return "";
  const stories = section(payload, "news").items.length;
  return `<section class="daily-finish" data-daily-finish data-edition-id="${escapeHtml(payload.edition.id)}" aria-labelledby="daily-finish-heading">
    ${renderKuramiMood({ mood: "done" })}
    <div class="daily-finish__copy"><p class="daily-finish__stamp" data-read-stamp hidden>${digestText("прочитано", "read")}</p>
      <h2 id="daily-finish-heading">${digestText("Всё. Ты в курсе.", "That's all. You're up to date.")}</h2>
      <p>${digestText(`≈ ${readingMinutes(payload)} мин чтения · ${stories} ${stories % 10 === 1 && stories % 100 !== 11 ? "сюжет" : stories % 10 >= 2 && stories % 10 <= 4 && (stories % 100 < 12 || stories % 100 > 14) ? "сюжета" : "сюжетов"}`, `≈ ${readingMinutes(payload)} min read · ${stories} ${stories === 1 ? "story" : "stories"}`)}</p></div>
  </section>`;
}

/** Marks the edition read when the finish is half visible; the server keeps the first read time. */
export const DAILY_FINISH_SCRIPT = String.raw`
(()=>{
  const finish=document.querySelector('[data-daily-finish]');if(!finish||!('IntersectionObserver' in window))return;
  const id=finish.dataset.editionId,key='kurami-read:'+id,stamp=finish.querySelector('[data-read-stamp]');
  let seen=false;try{seen=localStorage.getItem(key)==='1';}catch{}
  if(seen){stamp.hidden=false;return;}
  const observer=new IntersectionObserver(entries=>{
    if(!entries.some(entry=>entry.isIntersecting))return;
    observer.disconnect();stamp.hidden=false;finish.classList.add('is-read');
    try{localStorage.setItem(key,'1');}catch{}
    fetch(kuramiAppUrl('/api/editions/read'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({editionId:id})}).catch(()=>{});
  },{threshold:.5});
  observer.observe(finish);
})();
`;

export const DAILY_FINISH_STYLES = `
.daily-finish { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 16px 32px; margin-top: 48px; padding: 24px 0 8px; border-top: 1px solid var(--border-default); }
.daily-finish__copy { position: relative; display: grid; gap: 6px; }
.daily-finish__copy h2 { margin: 0; font-size: clamp(1.5rem, 3vw, 2rem); }
.daily-finish__copy p { margin: 0; color: var(--text-muted); }
.daily-finish__stamp { position: absolute; inset: -34px auto auto 55%; color: var(--accent-primary) !important; font: 600 28px/1 var(--font-note); rotate: -8deg; text-shadow: var(--display-glow); pointer-events: none; }
.daily-finish.is-read .daily-finish__stamp { animation: daily-stamp .5s cubic-bezier(.2,.9,.3,1.4); }
@keyframes daily-stamp { from { scale: 1.8; opacity: 0; } to { scale: 1; opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .daily-finish.is-read .daily-finish__stamp { animation: none; } }
`;
