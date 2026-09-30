// PR declaration for UI changes, checked next to Docs-Impact. It makes the author say whether a
// change used the library, extended it, or needed a product-specific exception, and why.

/** Paths that render HTML or CSS for a Kurami site. */
export function touchesUi(path:string):boolean {
  return path.startsWith("src/ui-library/")
    ||path.startsWith("src/projects-site/")
    ||path.startsWith("src/briefing/ui/")
    ||path.startsWith("integrations/hermes/skills/kurami-ui-preview-language/")
    ||path==="tests/ui-library/guard-baseline.json"
    ||/^src\/(?:briefing|human-docs)\/(?:.*\/)?(?:render|styles|components|panel|page-shell|discovery-render)[^/]*\.ts$/.test(path);
}

function field(body:string,name:string):string[] {
  return [...body.matchAll(new RegExp(`^${name}:\\s*(.+)$`,"gim"))].map(match=>match[1].trim());
}

/** `baselineGrew`: the frozen UI-guard exceptions increased in this PR. */
export function evaluateUiImpact(paths:readonly string[],body:string,baselineGrew:boolean):string[] {
  if(!paths.some(touchesUi))return [];
  const value=field(body,"UI-Library");
  if(value.length!==1||!["used","extended","exception"].includes(value[0].toLowerCase()))
    return ["This PR changes UI. Add exactly one `UI-Library: used`, `UI-Library: extended` or `UI-Library: exception` line."];
  const kind=value[0].toLowerCase();
  if(kind==="extended"&&!paths.some(path=>path.startsWith("src/ui-library/")))return ["`UI-Library: extended` needs a change under src/ui-library/."];
  if(baselineGrew&&kind!=="exception")return ["The UI guard baseline grew. Use `UI-Library: exception` and explain it with `UI-Reason:`, or use the library instead."];
  if(kind==="exception"){
    const reason=field(body,"UI-Reason");
    if(reason.length!==1||reason[0].length<25)return ["`UI-Library: exception` needs one specific `UI-Reason:` (at least 25 characters): why no library part fits, and whether it should be promoted later."];
  }
  return [];
}

/** True when any frozen count or duplicate in the head baseline exceeds the base baseline.
 *  The PR that first introduces the baseline freezes the existing state; that is not growth. */
export function baselineGrew(before:string|null,after:string|null):boolean {
  if(!after||!before)return false;
  type Baseline={counts:Record<string,Record<string,number>>;duplicates:Record<string,string>};
  const base:Baseline=JSON.parse(before),head:Baseline=JSON.parse(after);
  for(const [rule,files] of Object.entries(head.counts))for(const [file,count] of Object.entries(files))if(count>(base.counts[rule]?.[file]??0))return true;
  return Object.keys(head.duplicates).some(key=>!(key in base.duplicates));
}
