import type {DatabaseSync} from "node:sqlite";
import {loadEdition} from "./store.ts";
import {loadWeeklyReview} from "./weekly/lifecycle.ts";
import {loadStocksCache} from "./stocks/collector.ts";
import type {SiteLink} from "./ui/components/site-header.ts";
export function publishedSiteLinks(database:DatabaseSync,weeklyEnabled:boolean,at=new Date().toISOString(),stocksEnabled=false):SiteLink[] {
  const links:SiteLink[]=[];
  for(const type of ["daily","cinema"] as const) {
    const edition=loadEdition(database,{type,current:true});
    if(edition && ["complete","partial"].includes(edition.state) && (type==="cinema"||edition.retention_until>at))
      links.push({section:type,date:edition.local_date});
  }
  if(weeklyEnabled) {
    try {
      const weekly=loadWeeklyReview(database);
      if(weekly&&["ready","partial"].includes(weekly.state))links.push({section:"weekly",date:weekly.data.publicationDate});
    } catch { /* Optional snapshot corruption must not break the page header. */ }
  }
  if(stocksEnabled) {
    const stocks=loadStocksCache(database);
    if(stocks?.data.series.some(series=>series.points.length))links.push({section:"stocks",date:stocks.capturedAt.slice(0,10)});
  }
  return links;
}
