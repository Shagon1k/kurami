function initializeStocks():void {
  const root=document.querySelector<HTMLElement>("[data-stock-list]");if(!root)return;
  const english=document.documentElement.lang==="en";
  const t=(ru:string,en:string)=>english?en:ru;
  const rows=[...root.querySelectorAll<HTMLDetailsElement>("[data-stock-row]")];
  let period=root.dataset.stockPeriod??"1m";
  const cache=new Map<string,string>(),versions=new Map<string,number>();
  const mount=()=>document.dispatchEvent(new Event("kurami:charts-mount"));
  const updateURL=(id:string)=>{
    const url=new URL(location.href);url.searchParams.set("symbols",id);url.searchParams.set("period",period);url.hash="stock-"+id;
    history.replaceState(null,"",url);
  };
  async function load(row:HTMLDetailsElement):Promise<void> {
    const id=row.dataset.stockRow!,panel=row.querySelector<HTMLElement>("[data-stock-details]")!,status=row.querySelector<HTMLElement>("[data-stock-load-status]")!;
    const version=(versions.get(id)??0)+1;versions.set(id,version);
    if(panel.dataset.stockLoaded===period){panel.removeAttribute("aria-busy");status.textContent="";mount();return;}
    const requestedPeriod=period,key=id+":"+requestedPeriod;
    panel.setAttribute("aria-busy","true");status.textContent=t("Загружаю график…","Loading chart…");
    try {
      let html=cache.get(key);
      if(!html){
        const response=await fetch("/api/stocks/details?"+new URLSearchParams({symbols:id,period:requestedPeriod,lang:english?"en":"ru"}),{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error("Chart unavailable");
        html=await response.text();if(html.length>300000)throw new Error("Chart too large");
      }
      const parsed=new DOMParser().parseFromString(html,"text/html"),content=parsed.querySelector<HTMLElement>("[data-stock-detail-content]");
      if(!content||content.dataset.period!==requestedPeriod||parsed.querySelector("script,iframe,object"))throw new Error("Invalid chart");
      cache.set(key,html);
      if(versions.get(id)!==version)return;
      const restoreFocus=panel.contains(document.activeElement);
      panel.replaceChildren(document.importNode(content,true));panel.dataset.stockLoaded=requestedPeriod;
      status.textContent="";mount();
      if(restoreFocus)panel.querySelector<HTMLElement>('[data-stock-period="'+requestedPeriod+'"]')?.focus({preventScroll:true});
      if(row.open)updateURL(id);
    }catch{
      if(versions.get(id)!==version)return;
      status.replaceChildren(document.createTextNode(t("Не удалось загрузить новый период. ","Could not load the new period. ")));
      const retry=document.createElement("button");retry.type="button";retry.className="button button--secondary";retry.textContent=t("Повторить","Retry");retry.addEventListener("click",()=>void load(row));status.append(retry);
    }finally{if(versions.get(id)===version)panel.removeAttribute("aria-busy");}
  }
  for(const row of rows){
    row.addEventListener("toggle",()=>{
      if(!row.open)return;
      for(const other of rows)if(other!==row)other.open=false;
      updateURL(row.dataset.stockRow!);void load(row);
    });
  }
  root.addEventListener("click",event=>{
    const link=event.target instanceof Element?event.target.closest<HTMLAnchorElement>("a[data-stock-period]"):null;
    if(!link||!link.dataset.stockPeriod)return;
    event.preventDefault();period=link.dataset.stockPeriod;
    const row=link.closest<HTMLDetailsElement>("[data-stock-row]");if(row)void load(row);
  });
  document.querySelectorAll<HTMLAnchorElement>("[data-stock-open]").forEach(link=>link.addEventListener("click",event=>{
    const row=rows.find(r=>r.dataset.stockRow===link.dataset.stockOpen);if(!row)return;
    event.preventDefault();
    if(row.open)void load(row);else row.open=true;
    updateURL(row.dataset.stockRow!);
    row.querySelector<HTMLElement>("summary")?.focus();row.scrollIntoView({block:"start",behavior:"instant"});
  }));
  const sort=root.querySelector<HTMLSelectElement>("[data-stock-sort]")!,container=root.querySelector<HTMLElement>("[data-stock-rows]")!;
  sort.addEventListener("change",()=>{
    const ordered=[...rows].sort((a,b)=>sort.value==="moves"?Number(b.dataset.stockMove)-Number(a.dataset.stockMove)||Number(a.dataset.stockIndex)-Number(b.dataset.stockIndex):Number(a.dataset.stockIndex)-Number(b.dataset.stockIndex));
    container.append(...ordered);
  });
}
export const STOCKS_CLIENT_SCRIPT=`(${initializeStocks.toString()})();`;
