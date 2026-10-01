import {THEME_CSS} from "../themes/index.ts";
import {FOUNDATION_CSS} from "../foundations/index.ts";
import {BUTTON_CSS} from "../components/button.ts";
import {TABLE_CSS} from "../components/table.ts";
import {DISCLOSURE_CSS} from "../components/disclosure.ts";
import {THEME_SWITCH_CSS,renderThemeSwitch} from "../components/theme-switch.ts";
import {SITE_HEADER_CSS,renderSiteHeader} from "../patterns/site-header.ts";
import {renderDocument} from "../patterns/page-shell.ts";
import {CHART_STYLES,CHART_CLIENT_SCRIPT,renderBarChart,renderTrendChart,renderSparkline,type ChartInput} from "../components/charts/index.ts";

export function syntheticCharts(language:"ru"|"en"="ru"):string {
  const t=(ru:string,en:string)=>language==="en"?en:ru;
  const categories=Array.from({length:7},(_,index)=>({key:`day-${index}`,label:`${index+1} ${t("сентября","September")}`,shortLabel:`0${index+1}.09`,partial:index===6}));
  const trend:ChartInput={id:"showcase-trend",title:t("Динамика показателей","Trends"),description:t("Синтетические данные для проверки компонента","Synthetic data for component testing"),
    xLabel:t("Дата","Date"),yLabel:t("Значение","Value"),unit:{kind:"number"},categories,
    series:[{id:"blue",label:t("Первая серия","First series"),values:[20,29,43,52,61,65,71]},
      {id:"orange",label:t("Вторая серия","Second series"),values:[38,46,58,65,66,67,65]},
      {id:"sage",label:t("Третья серия","Third series"),values:[null,3,4,4,null,7,10]},
      {id:"ochre",label:t("Четвёртая серия","Fourth series"),values:[8,14,21,26,29,33,38]},
      {id:"gray",label:t("Пятая серия","Fifth series"),values:[12,18,23,28,30,36,41]}]};
  const bars:ChartInput={...trend,id:"showcase-bars",title:t("По периодам","By period"),description:undefined,
    series:[{id:"weekly",label:t("За период","Per period"),color:4,values:[0,2,8,23,37,52,47]}]};
  const compact:ChartInput={...trend,id:"showcase-compact",title:t("История лимитов","Limit history"),unit:{kind:"percent"},minimumMaximum:100,
    series:[{id:"short",label:"5h",color:4,values:[0,18,null,32,45,28,36],partial:[false,false,false,true,false,false,false]},
      {id:"long",label:"7d",color:3,values:[12,21,18,26,null,35,42]}],
    display:{variant:"embedded",density:"compact",zoom:false,values:false,table:"screen-reader",legend:"static"}};
  const content=`<h1>${t("Графики Kurami","Kurami charts")}</h1><p>${t("Все значения демонстрационные.","All values are synthetic.")}</p>${renderTrendChart(trend,language)}${renderBarChart(bars,language)}<section class="charts-sample">${renderBarChart(compact,language)}</section>${renderBarChart({...bars,id:"showcase-signed",title:t("Изменение","Change"),categories:categories.slice(0,3),series:[{id:"change",label:t("Изменение","Change"),values:[-5,0,8]}]},language)}${renderTrendChart({...trend,id:"showcase-empty",title:t("Нет данных","No data"),categories:[],series:[]},language)}${renderSparkline([20,29,null,52,61,65,71],t("Миниатюра динамики","Trend miniature"),language)}`;
  const styles=[THEME_CSS,FOUNDATION_CSS,BUTTON_CSS,TABLE_CSS,DISCLOSURE_CSS,THEME_SWITCH_CSS,SITE_HEADER_CSS,CHART_STYLES,
    ".charts-sample { max-width: 400px; padding: var(--space-4); border: 1px solid var(--border-default); background: var(--surface-raised); border-radius: var(--radius-md); } main { padding-block: var(--space-6); }"].join("\n");
  const html=renderDocument({lang:language,title:t("Графики Kurami","Kurami charts"),favicon:"/favicon.svg",styles:{inline:styles},themeScript:true,
    skipLabel:t("К содержимому","Skip to content"),header:renderSiteHeader({brand:{href:"/",ariaLabel:"Kurami",foxSrc:"/assets/kurami-fox-header.webp",suffix:"charts"},nav:{label:t("Разделы","Sections"),links:[],hideWhenEmpty:true},actions:renderThemeSwitch(language)}),main:content,footer:""});
  return html.replace("</body>",`<script>${CHART_CLIENT_SCRIPT}</script></body>`);
}
