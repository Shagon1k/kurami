import {escapeHtml as e} from "../ui/html.ts";
import type {LearningNote} from "./model.ts";
import {renderDisclosure} from "../../ui-library/components/disclosure.ts";

/** Content is authored and validated; this component only supplies stable reading structure. */
export function renderLearningNotes(notes:LearningNote[],namespace=""):string {
  if(!notes.length)return "";
  return `<section class="review-section review-learning" aria-labelledby="${e(namespace)}review-learning-title"><h2 id="${e(namespace)}review-learning-title">Разобраться по ходу</h2><p>Короткие пояснения к этому выпуску. Можно открыть нужное и вернуться к отчёту.</p>${notes.map(n=>renderDisclosure({summary:n.term,variant:"inline",className:"review-learning-note",id:namespace+"learn-"+n.id,body:`<div><p><strong>Что означает:</strong> ${e(n.explanation)}</p><p><strong>Пример из отчёта:</strong> ${e(n.example)}</p><p><strong>Чего из этого не следует:</strong> ${e(n.limitation)}</p><a href="${e(n.reference.url)}" target="_blank" rel="noopener noreferrer">Подробнее: ${e(n.reference.title)} ↗</a></div>`})).join("")}</section>`;
}
export const REVIEW_LEARNING_STYLES=`
.review-learning-note { border:1px solid var(--border-default); border-left:3px solid var(--text-primary); background:var(--surface-panel); margin:12px 0; padding:0 18px; scroll-margin-top:calc(var(--header-offset,104px) + 16px); }
.review-learning-note>div { padding-bottom:16px; max-width:90ch; }
.review-learning-note p { margin:12px 0; }
.review-learning-note a,.review-learning-links a { display:inline-flex; align-items:center; min-height:44px; color:var(--text-primary); font-size:.875rem; text-underline-offset:3px; }
.review-learning-links { display:flex; flex-wrap:wrap; gap:4px 20px; margin-top:8px; }
`;
function initializeReviewLearning():void {
  document.querySelectorAll<HTMLAnchorElement>("[data-review-lesson-link]").forEach(link=>link.addEventListener("click",()=>{
    const note=document.getElementById(link.hash.slice(1));
    if(note instanceof HTMLDetailsElement){note.open=true;note.querySelector("summary")?.focus({preventScroll:true});}
  }));
}
export const REVIEW_LEARNING_SCRIPT=`(${initializeReviewLearning.toString()})();`;
