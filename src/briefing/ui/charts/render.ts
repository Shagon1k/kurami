import { escapeHtml as escape } from "../html.ts";
import { renderButton } from "../components/button.ts";
import { createChartEngine } from "./engine.ts";
import type { ChartInput, ChartSpec } from "./model.ts";

const engine=createChartEngine();
function svgPlot(spec:ChartSpec):string {
  const layout=engine.layout(spec);
  const {plot}=layout;
  let first=true;
  const series=layout.series.map(series=>{
    const paths=spec.kind==="trend" ? series.segments.filter(segment=>segment.length>1)
      .map(segment=>`<polyline points="${segment.map(point=>point.x+","+point.y).join(" ")}"/>`).join("") : "";
    const points=series.points.map(point=>{
      const attributes=`data-chart-point data-chart-series="${series.index}" data-chart-index="${point.index}" data-chart-value="${escape(point.text)}" tabindex="${first?"0":"-1"}" role="img" aria-label="${escape(point.text)}"`;
      first=false;
      const shape=spec.kind==="trend" ? `<circle cx="${point.x}" cy="${point.y}" r="3"/>`
        : `<rect x="${point.x-layout.barWidth/2}" y="${Math.min(point.y,layout.baseline)}" width="${layout.barWidth}" height="${Math.max(.6,Math.abs(point.y-layout.baseline))}"/>`;
      const valueLabel=spec.kind==="bar" ? `<text class="chart__bar-value" x="${point.x}" y="${point.value<0?point.y+16:point.y-10}" text-anchor="middle">${escape(point.valueLabel)}</text>` : "";
      return `<g class="chart__point${point.partial?" chart__point--partial":""}" ${attributes}>${shape}<title>${escape(point.text)}</title>${valueLabel}</g>`;
    }).join("");
    return `<g class="chart__series chart__series--${series.index}">${paths}${points}</g>`;
  }).join("");
  return `<svg viewBox="0 0 ${plot.width} ${plot.height}" role="group" aria-label="${escape(spec.title)}" aria-describedby="${spec.id}-help">
    <g class="chart__grid">${layout.ticks.map(tick=>`<line x1="${plot.left}" y1="${tick.y}" x2="${plot.right}" y2="${tick.y}"/>`).join("")}</g>
    <g class="chart__labels">${layout.ticks.map(tick=>`<text x="${plot.left-10}" y="${tick.y+4}" text-anchor="end">${escape(tick.label)}</text>`).join("")}</g>
    ${series}
    <g class="chart__labels">${layout.labels.map(label=>`<text x="${label.x}" y="255" text-anchor="middle">${escape(label.label)}</text>`).join("")}<text x="${(plot.left+plot.right)/2}" y="281" text-anchor="middle">${escape(spec.xLabel)}</text></g>
  </svg>`;
}

export function renderChart(value:ChartSpec):string {
  const spec=engine.parse(value),layout=engine.layout(spec);
  const encoded=Buffer.from(JSON.stringify(spec),"utf8").toString("base64url");
  const legend=spec.series.map((series,index)=>spec.series.length>1
    ? renderButton({label:series.label,variant:"quiet",className:`chart__key chart__key--${index}`,attributes:{"data-chart-key":index,"aria-pressed":"true"}})
    : `<span class="chart__key chart__key--${index}">${escape(series.label)}</span>`).join("");
  const emptyText=spec.state==="unavailable" ? spec.message ?? "Данные временно недоступны" : "Нет данных за выбранные периоды";
  return `<article class="chart chart--${spec.kind}" data-chart data-chart-spec="${encoded}" aria-labelledby="${spec.id}-title">
    <header class="chart__header"><div>${spec.description?`<p class="chart__subtitle">${escape(spec.description)}</p>`:""}<h3 id="${spec.id}-title">${escape(spec.title)}</h3></div><div class="chart__legend" role="group" aria-label="Ряды графика">${legend}</div></header>
    <div class="chart__toolbar"><span>${escape(spec.yLabel)}</span><div class="chart__zoom" aria-label="Масштаб по периодам">
      ${renderButton({label:"Показать больше периодов",variant:"quiet",icon:"−",ariaLabel:"Показать больше периодов",disabled:layout.windowSize===layout.total,attributes:{"data-chart-zoom-out":true}})}
      <output data-chart-window aria-label="Показано периодов">${layout.windowSize} / ${layout.total}</output>
      ${renderButton({label:"Показать меньше периодов",variant:"quiet",icon:"+",ariaLabel:"Показать меньше периодов",disabled:layout.windowSize<=Math.min(3,layout.total),attributes:{"data-chart-zoom-in":true}})}
    </div></div>
    <p class="chart__status" data-chart-status role="status" aria-live="polite">${spec.state==="partial"?escape(spec.message ?? "Данные неполные"):""}</p>
    <p class="chart__empty" data-chart-empty${layout.empty?"":" hidden"}>${escape(emptyText)}</p>
    <div class="chart__plot" data-chart-plot${layout.empty?" hidden":""}>${svgPlot(spec)}</div>
    <div class="chart__tooltip" id="${spec.id}-tooltip" data-chart-tooltip role="tooltip" hidden></div>
    <p class="sr-only" id="${spec.id}-help">Стрелки влево и вправо — точки, вверх и вниз — ряды. Escape закрывает подсказку. Все значения доступны в таблице.</p>
    ${spec.categories.some(category=>category.partial)?'<p class="chart__footnote">* Неполный период — значение ещё может измениться.</p>':""}
    <details class="chart__table"><summary>Данные таблицей</summary><div><table><caption>${escape(spec.title)} · ${escape(spec.yLabel)}</caption>
      <thead><tr><th scope="col">${escape(spec.xLabel)}</th>${spec.series.map(series=>`<th scope="col">${escape(series.label)}</th>`).join("")}</tr></thead>
      <tbody>${spec.categories.map((category,index)=>`<tr><th scope="row">${escape(category.label)}${category.partial?"*":""}</th>${spec.series.map(series=>`<td>${series.values[index]===null?"—":escape(engine.format(series.values[index]!,spec.unit))}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div></details>
  </article>`;
}
export const renderTrendChart=(input:ChartInput):string=>renderChart({...input,version:1,kind:"trend"});
export const renderBarChart=(input:ChartInput):string=>renderChart({...input,version:1,kind:"bar"});
