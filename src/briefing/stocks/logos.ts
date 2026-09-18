import type {DatabaseSync} from "node:sqlite";
import {openBriefingDatabase,loadAddonSnapshot,upsertAddonSnapshot,type BriefingPaths} from "../store.ts";
import type {FetchLike} from "../providers/common.ts";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import type {StocksConfig} from "./config.ts";
import {loadDiscovery} from "./discovery.ts";
import {companyLogoDomain,knownCompanyLogoDomains,logoKey,matchCompanyDomain,type LogoIdentity} from "./logo-registry.ts";
import {validLogoDomain} from "../ui/components/company-avatar.ts";
type Entry={key:string;domain:string|null;checkedAt:string};
function entries(db:DatabaseSync):Entry[]{
  try{
    const rows=(loadAddonSnapshot(db,"stock-logos")?.envelope.data as {entries?:Entry[]}|undefined)?.entries;
    return Array.isArray(rows)?rows.filter(r=>typeof r.key==="string"&&/^[A-Z0-9.-]+:[A-Z0-9]{12}$/.test(r.key)&&(r.domain===null||validLogoDomain(r.domain))&&Number.isFinite(Date.parse(r.checkedAt))).slice(-100):[];
  }catch{return [];}
}
export function loadCompanyLogoDomains(db:DatabaseSync,at=new Date()):Map<string,string>{
  const domains=new Map(entries(db).filter(r=>r.domain&&Date.parse(r.checkedAt)<=at.getTime()&&at.getTime()-Date.parse(r.checkedAt)<30*86400000).map(r=>[r.key,r.domain!]));
  for(const[key,domain]of knownCompanyLogoDomains())domains.set(key,domain);
  return domains;
}
/** Metadata only, no logo bulk-download, financial API, or request-time discovery. */
export async function refreshCompanyLogos(config:StocksConfig,enabled:boolean,paths:BriefingPaths,options:{at?:Date;fetchImpl?:FetchLike;includeDiscovery?:boolean}={}){
  if(!enabled||!config.enabled)return {requests:0};
  const db=openBriefingDatabase(paths),at=options.at??new Date();let requests=0;
  try{
    const targets:LogoIdentity[]=[...config.assets.map(a=>({symbol:a.id,isin:a.isin,name:a.name})),...(options.includeDiscovery?loadDiscovery(db)?.data.cards??[]:[])];
    const done=new Set<string>();
    const save=(entry:Entry)=>{
      const rows=entries(db).filter(r=>r.key!==entry.key&&at.getTime()-Date.parse(r.checkedAt)<90*86400000);
      rows.push(entry);upsertAddonSnapshot(db,"stock-logos",{version:1,state:"ready",capturedAt:at.toISOString(),data:{entries:rows.slice(-100)}});
    };
    for(const identity of targets){
      const key=logoKey(identity);if(done.has(key)||companyLogoDomain(identity))continue;done.add(key);
      const previous=entries(db).find(r=>r.key===key),age=previous?at.getTime()-Date.parse(previous.checkedAt):Infinity;
      if(age>=0&&age<(previous?.domain?30:7)*86400000)continue;
      if(requests>=3)break;
      // Reserve the attempt before awaiting so restarts do not repeatedly search missing names.
      save({key,domain:null,checkedAt:at.toISOString()});requests++;
      try{
        const url=new URL("https://www.allinvestview.com/api/logo-search/");url.searchParams.set("q",identity.symbol);
        const response=await (options.fetchImpl??nodeHttpFetch)(url,{redirect:"error",signal:AbortSignal.timeout(6000)});
        if(!response.ok)continue;
        const text=await response.text();if(text.length>100000)continue;
        const domain=matchCompanyDomain(identity,JSON.parse(text));
        if(domain)save({key,domain,checkedAt:at.toISOString()});
      }catch{/* Optional decoration: leave the letter fallback. */}
    }
    return {requests};
  }finally{db.close();}
}
export async function refreshCompanyLogosSafely(...args:Parameters<typeof refreshCompanyLogos>){try{return await refreshCompanyLogos(...args);}catch{return {requests:0};}}
