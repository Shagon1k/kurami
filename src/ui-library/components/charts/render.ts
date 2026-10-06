import { escapeHtml as escape } from "../../foundations/html.ts";
import { renderButton } from "../button.ts";
import { createChartEngine } from "./engine.ts";
import type { ChartInput, ChartSpec } from "./model.ts";
import {renderTable} from "../table.ts";
import {renderDisclosure} from "../disclosure.ts";

function svgPlot(spec:ChartSpec,language:"ru"|"en"):string {
  const engine=createChartEngine(language);
  const layout=engine.layout(spec);
  const {plot}=layout;
  let first=true;
  const series=layout.series.map(series=>{
    const paths=spec.kind==="trend" ? series.segments.filter(segment=>segment.length>1)
      .map(segment=>`<polygon class="chart__area" points="${segment.map(point=>point.x+","+point.y).join(" ")} ${segment.at(-1)!.x},${plot.bottom} ${segment[0]!.x},${plot.bottom}"/><polyline points="${segment.map(point=>point.x+","+point.y).join(" ")}"/>`).join("") : "";
    const points=series.points.map(point=>{
      const attributes=`data-chart-point data-chart-series="${series.index}" data-chart-index="${point.index}" data-chart-value="${escape(point.text)}" tabindex="${first?"0":"-1"}" role="img" aria-label="${escape(point.text)}"`;
      first=false;
      const shape=spec.kind==="trend" ? `<circle cx="${point.x}" cy="${point.y}" r="3.5"/>`
        : `<rect x="${point.x-layout.barWidth/2}" y="${Math.min(point.y,layout.baseline)}" width="${layout.barWidth}" height="${Math.max(.6,Math.abs(point.y-layout.baseline))}"/>`;
      const valueLabel=spec.kind==="bar" && layout.showValues ? `<text class="chart__bar-value" x="${point.x}" y="${point.value<0?point.y+16:point.y-10}" text-anchor="middle">${escape(point.valueLabel)}</text>` : "";
      return `<g class="chart__point${point.partial?" chart__point--partial":""}" ${attributes}>${shape}<title>${escape(point.text)}</title>${valueLabel}</g>`;
    }).join("");
    return `<g class="chart__series chart__series--${series.color}">${paths}${points}</g>`;
  }).join("");
  return `<svg viewBox="0 0 ${plot.width} ${plot.height}" role="group" aria-label="${escape(spec.title)}" aria-describedby="${spec.id}-help">
    <g class="chart__grid">${layout.ticks.map(tick=>`<line x1="${plot.left}" y1="${tick.y}" x2="${plot.right}" y2="${tick.y}"/>`).join("")}</g>
    <g class="chart__labels">${layout.ticks.map(tick=>`<text x="${plot.left-10}" y="${tick.y+4}" text-anchor="end">${escape(tick.label)}</text>`).join("")}</g>
    ${series}
    <g class="chart__labels">${layout.labels.map(label=>`<text x="${label.x}" y="${layout.labelY}" text-anchor="middle">${escape(label.label)}</text>`).join("")}<text x="${(plot.left+plot.right)/2}" y="${plot.height-9}" text-anchor="middle">${escape(spec.xLabel)}</text></g>
  </svg>`;
}

export function renderChart(value:ChartSpec,language:"ru"|"en"="ru"):string {
  const t=(ru:string,en:string)=>language==="en"?en:ru;
  const engine=createChartEngine(language);
  const spec=engine.parse(value),layout=engine.layout(spec);
  const encoded=Buffer.from(JSON.stringify(spec),"utf8").toString("base64url");
  const display=spec.display??{};
  const legend=display.legend==="hidden"?"":spec.series.map((series,index)=>spec.series.length>1 && display.legend!=="static"
    ? renderButton({label:series.label,variant:"quiet",className:`chart__key chart__key--${(series.color??index+1)-1}`,attributes:{"data-chart-key":index,"aria-pressed":"true"}})
    : `<span class="chart__key chart__key--${(series.color??index+1)-1}">${escape(series.label)}</span>`).join("");
  const emptyText=spec.state==="unavailable" ? spec.message ?? t("Данные временно недоступны","Data temporarily unavailable") : t("Нет данных за выбранные периоды","No data for the selected periods");
  const partial=spec.categories.some(category=>category.partial)||spec.series.some(series=>series.partial?.some(Boolean));
  const table=renderTable({caption:spec.title+" · "+spec.yLabel,columns:[spec.xLabel,...spec.series.map(series=>series.label)],
    rows:spec.categories.map((category,index)=>[category.label+(category.partial?"*":""),...spec.series.map(series=>series.values[index]===null?"—":engine.format(series.values[index]!,spec.unit)+(series.partial?.[index]?"*":""))]),
    numeric:true,rowHeaders:true,className:"chart__values"});
  const tableHtml=display.table==="screen-reader"?`<div class="sr-only">${table}</div>`:renderDisclosure({summary:t("Данные таблицей","Data table"),body:table,className:"chart__table"});
  return `<article class="chart chart--${spec.kind}${display.variant==="embedded"?" chart--embedded":""}${display.density==="compact"?" chart--compact":""}" data-chart data-chart-spec="${encoded}" aria-labelledby="${spec.id}-title">
    ${display.header===false?`<h3 class="sr-only" id="${spec.id}-title">${escape(spec.title)}</h3>${legend?`<div class="chart__legend" role="group" aria-label="${t("Ряды графика","Chart series")}">${legend}</div>`:""}`:`<header class="chart__header"><div>${spec.description?`<p class="chart__subtitle">${escape(spec.description)}</p>`:""}<h3 id="${spec.id}-title">${escape(spec.title)}</h3></div><div class="chart__legend" role="group" aria-label="${t("Ряды графика","Chart series")}">${legend}</div></header>`}
    ${display.zoom===false?"":`<div class="chart__toolbar"><span>${escape(spec.yLabel)}</span><div class="chart__zoom" aria-label="${t("Масштаб по периодам","Period zoom")}">
      ${renderButton({label:t("Показать больше периодов","Show more periods"),variant:"quiet",icon:"−",ariaLabel:t("Показать больше периодов","Show more periods"),disabled:layout.windowSize===layout.total,attributes:{"data-chart-zoom-out":true}})}
      <output data-chart-window aria-label="${t("Показано периодов","Periods shown")}">${layout.windowSize} / ${layout.total}</output>
      ${renderButton({label:t("Показать меньше периодов","Show fewer periods"),variant:"quiet",icon:"+",ariaLabel:t("Показать меньше периодов","Show fewer periods"),disabled:layout.windowSize<=Math.min(3,layout.total),attributes:{"data-chart-zoom-in":true}})}
    </div></div>`}
    <p class="chart__status" data-chart-status role="status" aria-live="polite">${spec.state==="partial"?escape(spec.message ?? t("Данные неполные","Data incomplete")):""}</p>
    <p class="chart__empty" data-chart-empty${layout.empty?"":" hidden"}>${escape(emptyText)}</p>
    <div class="chart__plot" data-chart-plot${layout.empty?" hidden":""}>${svgPlot(spec,language)}</div>
    <div class="chart__tooltip" id="${spec.id}-tooltip" data-chart-tooltip role="tooltip" hidden></div>
    <p class="sr-only" id="${spec.id}-help">${t("Стрелки влево и вправо — точки, вверх и вниз — ряды. Escape закрывает подсказку. Все значения доступны в таблице.","Left and right arrows move between points; up and down move between series. Escape closes the tooltip. All values are available in the table.")}</p>
    ${partial && display.table!=="screen-reader"?`<p class="chart__footnote">${t("* Неполный период — значение ещё может измениться.","* Incomplete period — this value may still change.")}</p>`:""}
    ${tableHtml}
  </article>`;
}
export const renderTrendChart=(input:ChartInput,language:"ru"|"en"="ru"):string=>renderChart({...input,version:1,kind:"trend"},language);
export const renderBarChart=(input:ChartInput,language:"ru"|"en"="ru"):string=>renderChart({...input,version:1,kind:"bar"},language);
