import type { ChartSpec, ChartUnit } from "./model.ts";

/** Self-contained shared engine: the same function is embedded in the browser bundle.
 * Keep runtime helpers inside this closure; there are no DOM, Node or provider dependencies.
 */
export function createChartEngine(language?:"ru"|"en") {
  const english=(language??(typeof document!=="undefined"&&document.documentElement.lang==="en"?"en":"ru"))==="en";
  const canvas = { width: 720, height: 290, left: 88, right: 694, top: 26, bottom: 220 };
  const key = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
  const text = (value: unknown, name: string, maximum = 160): string => {
    if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("Invalid chart " + name);
    return value.trim();
  };
  function parse(value: unknown): ChartSpec {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid chart");
    const raw = value as Record<string, unknown>;
    if (raw.version !== 1 || (raw.kind !== "trend" && raw.kind !== "bar")) throw new Error("Unsupported chart");
    const id = text(raw.id,"id",160);
    if (!key.test(id)) throw new Error("Invalid chart id");
    const unit = raw.unit as ChartUnit;
    if (!unit || !["number","currency","percent"].includes(unit.kind)) throw new Error("Invalid chart unit");
    const normalizedUnit: ChartUnit = unit.kind === "currency"
      ? { kind: "currency", currency: text(unit.currency,"currency",3) }
      : unit.kind === "percent" ? { kind: "percent" }
      : { kind: "number", ...(unit.suffix === undefined ? {} : { suffix: text(unit.suffix,"suffix",24) }) };
    if (normalizedUnit.kind === "currency" && !/^[A-Z]{3}$/.test(normalizedUnit.currency)) throw new Error("Invalid currency");
    if (!Array.isArray(raw.categories) || raw.categories.length > 120 || !Array.isArray(raw.series) || raw.series.length > 5) throw new Error("Chart collection limit");
    const categories = Array.from(raw.categories,entry => {
      if (!entry || typeof entry !== "object") throw new Error("Invalid chart category");
      const categoryKey = text(entry.key,"category key",160);
      if (!key.test(categoryKey) || (entry.partial !== undefined && typeof entry.partial !== "boolean")) throw new Error("Invalid category key or state");
      return { key: categoryKey, label: text(entry.label,"category label"),
        ...(entry.shortLabel === undefined ? {} : {shortLabel:text(entry.shortLabel,"short label",64)}),
        ...(entry.partial === undefined ? {} : {partial:entry.partial}) };
    });
    const series = Array.from(raw.series,entry => {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.values) || entry.values.length !== categories.length) throw new Error("Chart values must align with categories");
      const seriesId = text(entry.id,"series id",160);
      if (!key.test(seriesId)) throw new Error("Invalid series id");
      const values = Array.from(entry.values,(point: unknown) => {
        if (point === null) return null;
        if (typeof point !== "number" || !Number.isFinite(point) || Math.abs(point) > 1e15) throw new Error("Chart values must be finite or null");
        return point === 0 ? 0 : point;
      });
      return {id:seriesId,label:text(entry.label,"series label"),values};
    });
    if (new Set(categories.map(item=>item.key)).size !== categories.length || new Set(series.map(item=>item.id)).size !== series.length) throw new Error("Duplicate chart key");
    const baseline = raw.baseline ?? "zero";
    if ((baseline !== "zero" && baseline !== "auto") || (raw.kind === "bar" && (baseline !== "zero" || series.length > 1))) throw new Error("Bar charts require one series and a zero baseline");
    const initialWindow = raw.initialWindow ?? categories.length;
    if (!Number.isSafeInteger(initialWindow) || Number(initialWindow) < Math.min(3,categories.length) || Number(initialWindow)>categories.length) throw new Error("Invalid chart window");
    const state = raw.state ?? "ready";
    if (state !== "ready" && state !== "partial" && state !== "unavailable") throw new Error("Invalid chart state");
    return { version:1, id, kind:raw.kind as ChartSpec["kind"], title:text(raw.title,"title"),
      xLabel:text(raw.xLabel,"x label",80),yLabel:text(raw.yLabel,"y label",80),unit:normalizedUnit,
      categories,series,baseline:baseline as ChartSpec["baseline"],initialWindow:Number(initialWindow),state:state as ChartSpec["state"],
      ...(raw.description===undefined?{}:{description:text(raw.description,"description",300)}),
      ...(raw.message===undefined?{}:{message:text(raw.message,"message",300)}) };
  }
  function format(value: number, unit: ChartUnit, compact = false): string {
    const scientific = value !== 0 && Math.abs(value) < .001;
    const options: Intl.NumberFormatOptions = {
      notation: scientific ? "scientific" : compact ? "compact" : "standard",
      ...(compact ? {maximumFractionDigits:3} : {maximumSignificantDigits:17}),
      ...(unit.kind === "currency" ? {style:"currency",currency:unit.currency,minimumFractionDigits:0} : {}),
    };
    return new Intl.NumberFormat(english?"en-US":"ru-RU", options).format(value)
      + (unit.kind==="percent" ? "%" : unit.kind==="number" && unit.suffix ? " "+unit.suffix : "");
  }
  function layout(spec: ChartSpec, options: { visible?: number[]; windowSize?: number } = {}) {
    const plot={...canvas};
    if(options.windowSize!==undefined && !Number.isSafeInteger(options.windowSize)) throw new Error("Invalid chart view window");
    if(options.visible?.some(index=>!Number.isSafeInteger(index) || index<0 || index>=spec.series.length)) throw new Error("Invalid visible series");
    const total = spec.categories.length;
    const windowSize = Math.max(Math.min(3,total),Math.min(total,options.windowSize ?? spec.initialWindow ?? total));
    const start = total-windowSize;
    const visible = new Set(options.visible ?? spec.series.map((_,index)=>index));
    const values = spec.state === "unavailable" ? [] : spec.series.flatMap((series,index)=>visible.has(index)
      ? series.values.slice(start).filter((value):value is number=>value!==null) : []);
    let low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values) : 1;
    if (spec.baseline !== "auto") { low=Math.min(0,low);high=Math.max(0,high); }
    if (high===low) {
      if (spec.baseline!=="auto" && high===0) high=1;
      else {const pad=Math.abs(high)*.05 || 1;low-=pad;high+=pad;}
    }
    const rough=Math.max(Number.MIN_VALUE,(high-low)/4), magnitude=Math.max(Number.MIN_VALUE,Math.pow(10,Math.floor(Math.log10(rough))));
    const step=([1,2,2.5,5,10].find(value=>value*magnitude>=rough) ?? 10)*magnitude;
    const minimum=Math.floor(low/step)*step,maximum=Math.ceil(high/step)*step;
    const y=(value:number)=>plot.bottom-(value-minimum)/(maximum-minimum)*(plot.bottom-plot.top);
    const ticks=Array.from({length:Math.round((maximum-minimum)/step)+1},(_,index)=>{
      const raw=minimum+index*step;
      const value=Math.abs(raw)<step*1e-10 ? 0 : raw;
      return {value,y:y(value),label:format(value,spec.unit,true)};
    });
    if(new Set(ticks.map(tick=>tick.label)).size!==ticks.length) {
      ticks.forEach(tick=>{tick.label=format(tick.value,spec.unit);});
    }
    plot.left=Math.max(plot.left,Math.min(190,Math.max(...ticks.map(tick=>tick.label.length))*6+16));
    const x=(index:number)=>spec.kind==="bar" ? plot.left+(index+.5)*(plot.right-plot.left)/Math.max(1,windowSize)
      : windowSize===1 ? (plot.left+plot.right)/2 : plot.left+index*(plot.right-plot.left)/Math.max(1,windowSize-1);
    const stride=Math.max(1,Math.ceil((windowSize-1)/6));
    const labels=spec.categories.slice(start).flatMap((category,index)=>
      index%stride===0 || index===windowSize-1 ? [{index:start+index,x:x(index),label:(category.shortLabel ?? category.label)+(category.partial?"*":"")}] : []);
    const series=spec.series.flatMap((item,seriesIndex)=>{
      if(!visible.has(seriesIndex) || spec.state==="unavailable")return [];
      const points=item.values.slice(start).map((value,index)=>value===null ? null : {
        index:start+index,seriesIndex,value,x:x(index),y:y(value),
        label:spec.categories[start+index]!.label,partial:spec.categories[start+index]!.partial===true,
        text:item.label+" · "+spec.categories[start+index]!.label+" · "+format(value,spec.unit)
          +(spec.categories[start+index]!.partial?english?" · incomplete period":" · неполный период":""),
        valueLabel:format(value,spec.unit,true)+(spec.categories[start+index]!.partial?"*":""),
      });
      const segments:Array<Array<NonNullable<typeof points[number]>>>=[];
      let segment:Array<NonNullable<typeof points[number]>>=[];
      for(const point of points) {
        if(point)segment.push(point);
        else if(segment.length){segments.push(segment);segment=[];}
      }
      if(segment.length)segments.push(segment);
      return [{index:seriesIndex,points:points.filter((point):point is NonNullable<typeof point>=>point!==null),segments}];
    });
    return {plot,minimum,maximum,ticks,labels,series,start,windowSize,total,baseline:y(0),
      barWidth:Math.min(56,(plot.right-plot.left)/Math.max(1,windowSize)*.68),empty:values.length===0};
  }
  return {parse,format,layout};
}
