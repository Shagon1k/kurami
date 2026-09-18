import {escapeHtml} from "../html.ts";

/** Small, non-interactive overview. Nulls break lines; each row has its own scale. */
export function renderSparkline(values:readonly (number|null)[],label:string):string {
  if(values.length>120||values.some(v=>v!==null&&!Number.isFinite(v)))throw new Error("Invalid sparkline values");
  const known=values.filter((v):v is number=>v!==null);
  if(known.length<2)return `<span class="sparkline-empty">Недостаточно истории</span>`;
  const low=Math.min(...known),high=Math.max(...known),range=high-low;
  const segments:string[][]=[];let current:string[]=[];
  values.forEach((value,index)=>{
    if(value===null){if(current.length)segments.push(current);current=[];return;}
    const x=3+index/Math.max(1,values.length-1)*134,y=range?39-(value-low)/range*34:22;
    current.push(x.toFixed(2)+","+y.toFixed(2));
  });
  if(current.length)segments.push(current);
  return `<svg class="sparkline" viewBox="0 0 140 44" role="img" aria-label="${escapeHtml(label)}"><title>${escapeHtml(label)}</title>${segments.map(points=>points.length>1?`<polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" points="${points.join(" ")}"/>`:"").join("")}</svg>`;
}
