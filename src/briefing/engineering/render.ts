import {FIGURE_ATTRIBUTE,surfaceAttributes} from "../../ui-library/components/surface.ts";
import type {BriefingPayload} from "../model.ts";
import {escapeHtml as e} from "../ui/html.ts";
import {digestText as t} from "../i18n.ts";
import {parseEngineeringBrief} from "./model.ts";

const waited=(hours:number)=>hours<48?t(`${hours} ч`,`${hours} h`):t(`${Math.floor(hours/24)} дн.`,`${Math.floor(hours/24)} d`);
const tokens=(value:number)=>value>=1_000_000?`${(value/1_000_000).toFixed(1)}M`:value>=1_000?`${Math.round(value/1_000)}K`:String(value);

/** A quiet block after the metrics: waiting pull requests first, the week's totals on Sundays. Nothing when both are empty. */
export function renderEngineeringBlock(payload:BriefingPayload):string {
  const brief=parseEngineeringBrief(payload);
  if(!brief||brief.state!=="ready")return "";
  const {waiting,week}=brief.data;
  const list=waiting.length?`<ul class="engineering__waiting">${waiting.map(pr=>`<li><a href="${e(pr.url)}">${e(pr.project)}${pr.number?` #${pr.number}`:""}</a><span>${e(pr.title)}</span><strong${FIGURE_ATTRIBUTE}>${e(waited(pr.hours))}</strong></li>`).join("")}</ul>`:"";
  const weekLine=week&&week.completed?`<p class="engineering__week">${t("За неделю","This week")}: <strong${FIGURE_ATTRIBUTE}>${week.completed}</strong> ${t("задач завершено","tasks completed")}${week.medianTokens!==null?` · ${t("медиана","median")} <strong${FIGURE_ATTRIBUTE}>${tokens(week.medianTokens)}</strong> ${t("токенов на задачу","tokens per task")}`:""}${week.reworkPercent!==null?` · ${t("доработки","rework")} ${Math.round(week.reworkPercent)}%`:""}</p>`:"";
  const heading=waiting.length?t(`PR ждут тебя дольше суток: ${waiting.length}`,`Pull requests waiting over a day: ${waiting.length}`):t("Проекты","Projects");
  return `<section class="engineering"${surfaceAttributes("panel")} aria-labelledby="engineering-heading"><h2 id="engineering-heading">${e(heading)}</h2>${list}${weekLine}</section>`;
}

export const ENGINEERING_STYLES=`
  .engineering { display:grid; gap:var(--space-2); margin-top:24px; padding:var(--space-4) var(--space-5); border:1px solid var(--border-default); background:var(--surface-panel); border-radius:var(--radius); }
  .engineering h2 { margin:0; font-size:1rem; }
  .engineering__waiting { display:grid; gap:var(--space-1); margin:0; padding:0; list-style:none; }
  .engineering__waiting li { display:grid; grid-template-columns:auto minmax(0,1fr) auto; gap:var(--space-2); align-items:baseline; }
  .engineering__waiting span { min-width:0; overflow:hidden; color:var(--text-muted); text-overflow:ellipsis; white-space:nowrap; }
  .engineering__week { margin:0; color:var(--text-muted); }
  .engineering__week strong { color:var(--text-primary); }
`;
