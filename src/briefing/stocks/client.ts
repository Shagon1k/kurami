function initializeStocks():void {
  document.querySelectorAll<HTMLElement>("[data-stock-picker]").forEach(root=>{
    const inputs=[...root.querySelectorAll<HTMLInputElement>("[data-stock-select]")];
    const button=root.querySelector<HTMLButtonElement>("[data-stock-compare]")!;
    const status=root.querySelector<HTMLElement>("[data-stock-selection-status]")!;
    const update=()=>{
      const selected=inputs.filter(input=>input.checked);
      for(const input of inputs) {
        if(input.dataset.stockUnavailable==="true")continue;
        input.disabled=!input.checked&&selected.length>=5;
      }
      button.disabled=selected.length<2||selected.length>5;
      status.textContent="Выбрано "+selected.length+" из 5";
    };
    for(const input of inputs) {
      if(input.disabled)input.dataset.stockUnavailable="true";
      input.addEventListener("change",update);
    }
    button.addEventListener("click",()=>{
      const values=inputs.filter(input=>input.checked).map(input=>input.value);
      if(values.length<2||values.length>5)return;
      const params=new URLSearchParams({symbols:values.join(","),period:root.dataset.stockPeriod??"1m"});
      location.assign("/stocks?"+params.toString()+"#stocks-chart");
    });
    update();
  });
}
export const STOCKS_CLIENT_SCRIPT=`(${initializeStocks.toString()})();`;
