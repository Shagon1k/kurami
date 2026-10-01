import { createChartEngine } from "./engine.ts";

/** Serialized as static application code, never eval'd from chart data. */
function initializeCharts(factory: typeof createChartEngine): void {
  const engine=factory(), ns="http://www.w3.org/2000/svg";
  const english=document.documentElement.lang==="en",t=(ru:string,en:string)=>english?en:ru;
  const node=(name:string,attributes:Record<string,string|number>={})=>{
    const element=document.createElementNS(ns,name);
    for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));
    return element;
  };
  document.querySelectorAll<HTMLElement>("[data-chart]").forEach(root=>{
    if(root.dataset.chartMounted)return;
    const disclosure=root.closest<HTMLDetailsElement>("details");
    if(disclosure&&!disclosure.open)return;
    root.dataset.chartMounted="true";
    const status=root.querySelector<HTMLElement>("[data-chart-status]");
    try {
      const encoded=root.dataset.chartSpec ?? "";
      if(encoded.length>256_000)throw new Error("Chart payload too large");
      const binary=atob(encoded.replace(/-/g,"+").replace(/_/g,"/"));
      let spec=engine.parse(JSON.parse(new TextDecoder().decode(Uint8Array.from(binary,char=>char.charCodeAt(0)))));
      const plotNode=root.querySelector<HTMLElement>("[data-chart-plot]")!;
      const empty=root.querySelector<HTMLElement>("[data-chart-empty]")!;
      const tooltip=root.querySelector<HTMLElement>("[data-chart-tooltip]")!;
      const visible=new Set(spec.series.map((_,index)=>index));
      let windowSize=spec.initialWindow ?? spec.categories.length;
      let tipRevision=0;
      const hideTip=()=>{tipRevision++;tooltip.hidden=true;};
      const showTip=(point:Element)=>{
        tooltip.textContent=point.getAttribute("data-chart-value") ?? "";
        tooltip.hidden=false;
        const bounds=root.getBoundingClientRect(),target=point.getBoundingClientRect();
        const width=tooltip.getBoundingClientRect().width;
        tooltip.style.left=Math.max(8,Math.min(bounds.width-width-8,target.x-bounds.x+target.width/2-width/2))+"px";
        tooltip.style.top=Math.max(8,target.y-bounds.y-tooltip.getBoundingClientRect().height-10)+"px";
      };
      const pointFrom=(target:EventTarget|null)=>target instanceof Element?target.closest("[data-chart-point]"):null;
      let lastWidth=0;
      const draw=()=>{
        const active=document.activeElement?.closest("[data-chart-point]");
        const focused=active&&root.contains(active)?{series:active.getAttribute("data-chart-series"),index:active.getAttribute("data-chart-index")}:null;
        hideTip();
        const measured=plotNode.clientWidth;
        const width=spec.display?.variant==="embedded"&&measured>=200?Math.min(3200,measured):undefined;
        lastWidth=measured;
        const layout=engine.layout(spec,{visible:[...visible],windowSize,width}),p=layout.plot;
        plotNode.hidden=layout.empty;empty.hidden=!layout.empty;
        empty.textContent=visible.size===0 && spec.series.length ? t("Выберите ряд в легенде.","Select a series in the legend.")
          : spec.state==="unavailable" ? spec.message ?? t("Данные временно недоступны","Data temporarily unavailable") : t("Нет данных за выбранные периоды","No data for the selected periods");
        const svg=node("svg",{viewBox:"0 0 "+p.width+" "+p.height,role:"group","aria-label":spec.title,"aria-describedby":spec.id+"-help"});
        const grid=node("g",{class:"chart__grid"}),yLabels=node("g",{class:"chart__labels"});
        for(const tick of layout.ticks) {
          grid.append(node("line",{x1:p.left,y1:tick.y,x2:p.right,y2:tick.y}));
          const label=node("text",{x:p.left-10,y:tick.y+4,"text-anchor":"end"});label.textContent=tick.label;yLabels.append(label);
        }
        svg.append(grid,yLabels);
        let first=true;
        for(const series of layout.series) {
          const group=node("g",{class:"chart__series chart__series--"+series.color});
          if(spec.kind==="trend")for(const segment of series.segments)if(segment.length>1)
            group.append(node("polyline",{points:segment.map(point=>point.x+","+point.y).join(" ")}));
          for(const point of series.points) {
            const target=node("g",{class:"chart__point"+(point.partial?" chart__point--partial":""),
              "data-chart-point":"","data-chart-series":series.index,"data-chart-index":point.index,"data-chart-value":point.text,
              tabindex:first?0:-1,role:"img","aria-label":point.text});
            first=false;
            target.append(spec.kind==="trend" ? node("circle",{cx:point.x,cy:point.y,r:3.5})
              : node("rect",{x:point.x-layout.barWidth/2,y:Math.min(point.y,layout.baseline),width:layout.barWidth,height:Math.max(.6,Math.abs(point.y-layout.baseline))}));
            if(spec.kind==="bar" && layout.showValues) {
              const label=node("text",{class:"chart__bar-value",x:point.x,y:point.value<0?point.y+16:point.y-10,"text-anchor":"middle"});
              label.textContent=point.valueLabel;target.append(label);
            }
            group.append(target);
          }
          svg.append(group);
        }
        const xLabels=node("g",{class:"chart__labels"});
        for(const label of layout.labels) {
          const text=node("text",{x:label.x,y:layout.labelY,"text-anchor":"middle"});text.textContent=label.label;xLabels.append(text);
        }
        const xTitle=node("text",{x:(p.left+p.right)/2,y:p.height-9,"text-anchor":"middle"});xTitle.textContent=spec.xLabel;xLabels.append(xTitle);svg.append(xLabels);
        plotNode.replaceChildren(svg);
        if(focused) {
          const target=Array.from(svg.querySelectorAll<SVGElement>("[data-chart-point]")).find(point=>point.getAttribute("data-chart-series")===focused.series&&point.getAttribute("data-chart-index")===focused.index);
          if(target){svg.querySelector('[tabindex="0"]')?.setAttribute("tabindex","-1");target.setAttribute("tabindex","0");target.focus({preventScroll:true});}
        }
        const output=root.querySelector("[data-chart-window]");if(output)output.textContent=windowSize+" / "+layout.total;
        const zoomIn=root.querySelector<HTMLButtonElement>("[data-chart-zoom-in]");if(zoomIn)zoomIn.disabled=windowSize<=Math.min(3,layout.total);
        const zoomOut=root.querySelector<HTMLButtonElement>("[data-chart-zoom-out]");if(zoomOut)zoomOut.disabled=windowSize>=layout.total;
      };
      root.addEventListener("kurami:chart-update",event=>{
        try {
          const detail=(event as CustomEvent).detail;
          if(!detail||!Array.isArray(detail.values)||detail.values.length!==spec.series.length)throw new Error("Invalid chart update");
          const next=engine.parse({...spec,series:spec.series.map((series,index)=>({...series,values:detail.values[index]})),
            state:detail.state??spec.state,message:detail.message??spec.message});
          spec=next;
          root.querySelectorAll(".chart__values tbody tr").forEach((row,index)=>{
            row.querySelectorAll("td").forEach((cell,seriesIndex)=>{
              const series=spec.series[seriesIndex]!,amount=series.values[index];
              cell.textContent=amount===null?"—":engine.format(amount!,spec.unit)+(series.partial?.[index]?"*":"");
            });
          });
          if(status)status.textContent=spec.state==="partial"?spec.message??t("Данные неполные","Data incomplete"):"";
          draw();
        } catch {if(status)status.textContent=t("Не удалось обновить график.","Unable to update chart.");}
      });
      root.querySelectorAll<HTMLButtonElement>("[data-chart-key]").forEach(button=>button.addEventListener("click",()=>{
        const index=Number(button.dataset.chartKey);
        if(visible.has(index)) {
          visible.delete(index);
        } else visible.add(index);
        button.setAttribute("aria-pressed",String(visible.has(index)));
        draw();
        if(status)status.textContent=t("Показано рядов: ","Series shown: ")+visible.size+t(" из "," of ")+spec.series.length+".";
      }));
      const zoom=(direction:number)=>{
        windowSize=Math.max(Math.min(3,spec.categories.length),Math.min(spec.categories.length,windowSize+direction));
        draw();if(status)status.textContent=t("Показаны последние ","Showing latest ")+windowSize+t(" периодов из "," periods of ")+spec.categories.length+".";
      };
      root.querySelector("[data-chart-zoom-in]")?.addEventListener("click",()=>zoom(-1));
      root.querySelector("[data-chart-zoom-out]")?.addEventListener("click",()=>zoom(1));
      root.addEventListener("pointerover",event=>{const point=pointFrom(event.target);if(point)showTip(point);});
      root.addEventListener("pointerout",event=>{
        const point=pointFrom(event.target);
        if(point && pointFrom(event.relatedTarget)!==point && document.activeElement!==point)hideTip();
      });
      root.addEventListener("focusin",event=>{const point=pointFrom(event.target);if(point)showTip(point);});
      root.addEventListener("focusout",hideTip);
      root.addEventListener("click",event=>{const point=pointFrom(event.target);if(point)showTip(point);});
      plotNode.addEventListener("scroll",hideTip);
      root.addEventListener("keydown",event=>{
        const point=pointFrom(event.target);if(!point)return;
        if(event.key==="Escape"){hideTip();return;}
        if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key))return;
        event.preventDefault();
        const all=Array.from(root.querySelectorAll<SVGElement>("[data-chart-point]"));
        const currentSeries=point.getAttribute("data-chart-series"),currentIndex=Number(point.getAttribute("data-chart-index"));
        const same=all.filter(item=>item.getAttribute("data-chart-series")===currentSeries);
        let target:SVGElement|undefined;
        if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)) {
          const index=same.indexOf(point as SVGElement);
          target=event.key==="Home"?same[0]:event.key==="End"?same.at(-1)
            : same[Math.max(0,Math.min(same.length-1,index+(event.key==="ArrowRight"?1:-1)))];
        } else {
          const groups=[...new Set(all.map(item=>item.getAttribute("data-chart-series")))];
          const index=groups.indexOf(currentSeries),next=groups[(index+(event.key==="ArrowDown"?1:-1)+groups.length)%groups.length];
          target=all.filter(item=>item.getAttribute("data-chart-series")===next)
            .sort((a,b)=>Math.abs(Number(a.getAttribute("data-chart-index"))-currentIndex)-Math.abs(Number(b.getAttribute("data-chart-index"))-currentIndex))[0];
        }
        if(target){
          all.forEach(item=>item.setAttribute("tabindex",item===target?"0":"-1"));
          target.focus();target.scrollIntoView({block:"nearest",inline:"nearest"});
          const revision=tipRevision;
          requestAnimationFrame(()=>{if(target?.isConnected&&revision===tipRevision&&document.activeElement===target)showTip(target);});
        }
      });
      draw();
      if(spec.display?.variant==="embedded"&&typeof ResizeObserver!=="undefined") {
        const observer=new ResizeObserver(()=>{
          if(!root.isConnected){observer.disconnect();return;}
          if(plotNode.clientWidth>=200&&Math.abs(plotNode.clientWidth-lastWidth)>.5)draw();
        });
        observer.observe(plotNode);
      }
    } catch {if(status)status.textContent=t("Не удалось включить интерактивный график. Значения доступны в таблице.","Could not enable the interactive chart. Values remain available in the table.");}
  });
}

export const CHART_CLIENT_SCRIPT=`(()=>{
  const mount=()=>(${initializeCharts.toString()})(${createChartEngine.toString()});
  mount();document.addEventListener("kurami:charts-mount",mount);
  document.addEventListener("pointerdown",event=>{
    document.querySelectorAll("[data-chart]").forEach(root=>{
      if(!root.contains(event.target)){const tip=root.querySelector("[data-chart-tooltip]");if(tip)tip.hidden=true;}
    });
  });
})();`;
