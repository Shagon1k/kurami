import {escapeHtml as e} from "../html.ts";

export type KuramiComment={context?:string;headline?:string;paragraphs?:Array<{label?:string;text:string}>;items?:string[];ordered?:boolean};
/** Caller classifies commentary. Never infer it from keywords or wrap source data automatically. */
export function renderKuramiComment(input:KuramiComment):string {
  if(!input.headline&&!input.paragraphs?.length&&!input.items?.length)return "";
  const list=input.ordered?"ol":"ul";
  return `<aside class="kurami-comment" data-kurami-comment aria-label="${e(input.context?"Комментарий AI — Курами: "+input.context:"Комментарий AI — Курами")}">
    <p class="kurami-comment__byline"><span aria-hidden="true">🦊</span> Курами:</p>
    ${input.headline?`<h3 class="kurami-comment__headline">${e(input.headline)}</h3>`:""}
    ${input.paragraphs?.map(p=>`<p>${p.label?`<strong>${e(p.label)}:</strong> `:""}${e(p.text)}</p>`).join("")??""}
    ${input.items?.length?`<${list}>${input.items.map(item=>`<li>${e(item)}</li>`).join("")}</${list}>`:""}
  </aside>`;
}
export const KURAMI_COMMENT_STYLES=`
.kurami-comment { margin:16px 0; padding:16px 20px; background:var(--panel); color:var(--ink); border-left:2px solid var(--line); border-radius:2px; font-family:var(--font-sans); }
.kurami-comment .kurami-comment__byline { display:flex; align-items:center; gap:7px; margin:0 0 10px; font-size:.8125rem; font-weight:600; line-height:1.4; }
.kurami-comment__byline>span { font-size:1.125rem; line-height:1; }
.kurami-comment .kurami-comment__headline { margin:0 0 12px; font-size:1.125rem; font-weight:600; line-height:1.4; }
.kurami-comment p,.kurami-comment li { font-size:1rem; line-height:1.65; }
.kurami-comment p { margin:10px 0; }
.kurami-comment ul,.kurami-comment ol { margin:0; padding-left:20px; }
.kurami-comment li+li { margin-top:8px; }
.kurami-comment>:last-child { margin-bottom:0; }
@media(max-width:600px){.kurami-comment{padding:14px 16px;}}
`;
