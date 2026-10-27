/** A presentation-only final-answer contract, never authority or review evidence. */
export type OwnerDecisionSummary = {title:string;problem:string;request:string};
export function parseOwnerDecisionSummary(value:unknown):OwnerDecisionSummary|null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v=value as Record<string,unknown>;
  if (Object.keys(v).sort().join(",") !== "problem,request,title") return null;
  for (const [key,limit] of [["title",100],["problem",600],["request",700]] as const) {
    const text=v[key];
    if (typeof text !== "string" || !text.trim() || text.length>limit || /[\r\n\u0000-\u001f]/u.test(text)) return null;
  }
  if ([v.title,v.problem,v.request].join(" ").trim().split(/\s+/u).length>160) return null;
  return {title:String(v.title).trim(),problem:String(v.problem).trim(),request:String(v.request).trim()};
}
export function completedOwnerDecisionSummary(items:unknown):string|null {
  if (!Array.isArray(items)) return null;
  const item=items.findLast(v=>v?.type === "agentMessage" && v.phase === "final_answer" && typeof v.text === "string");
  if (!item || item.text.length>2500) return null;
  try {
    const envelope=JSON.parse(item.text);
    if (Object.keys(envelope).join(",") !== "ownerDecision") return null;
    const summary=parseOwnerDecisionSummary(envelope.ownerDecision);
    return summary ? JSON.stringify(summary) : null;
  } catch { return null; }
}
