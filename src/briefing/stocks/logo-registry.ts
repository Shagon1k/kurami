import {validLogoDomain} from "../ui/components/company-avatar.ts";
export type LogoIdentity={symbol:string;isin:string;name:string};
export type CompanyLogoDomains=ReadonlyMap<string,string>;
// AllInvestView metadata verified 2026-09-18. Key by symbol AND ISIN: ticker reuse must not inherit branding.
const pinned:Record<string,string>={
  "VUAA:IE00BFMXXD54":"vanguard.com", // Issuer mark, not a fund-specific brand.
  "SPCX:US84615Q1031":"spacex.com",
  "NVDA:US67066G1040":"nvidia.com",
  "TSM:US8740391003":"tsmc.com",
  "AMZN:US0231351067":"aboutamazon.com",
  "MSFT:US5949181045":"microsoft.com",
  "MRK:US58933Y1055":"merck.com",
  "NOK:US6549022043":"nokia.com",
  "SOFI:US83406F1021":"sofi.com",
  "MX:US55933J2033":"magnachip.com",
  "SPCE:US92766K4031":"virgingalactic.com",
  "INTC:US4581401001":"intel.com",
  "CRWV:US21873S1087":"coreweave.com",
};
export const knownCompanyLogoDomains=()=>new Map(Object.entries(pinned));
export const logoKey=(identity:LogoIdentity)=>identity.symbol+":"+identity.isin;
export function companyLogoDomain(identity:LogoIdentity,domains?:CompanyLogoDomains):string|undefined {
  const key=logoKey(identity),domain=pinned[key]??domains?.get(key);
  return validLogoDomain(domain)?domain:undefined;
}
const normalizedName=(name:string)=>name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g," ")
  .replace(/\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings|group|class|common|ordinary|shares|stock|adr|a)\b/g,"").replace(/\s/g,"");
export function matchCompanyDomain(identity:LogoIdentity,value:unknown):string|undefined {
  const rows=(value as {results?:unknown})?.results;if(!Array.isArray(rows)||rows.length>20)return;
  const name=normalizedName(identity.name);if(name.length<3)return;
  const matches=rows.filter(r=>r?.symbol===identity.symbol&&typeof r.name==="string"&&normalizedName(r.name)===name
    &&["NASDAQ","NMS","NGM","NCM","NYSE","NYQ","ASE","AMEX","PCX"].includes(r.exchange));
  if(matches.length!==1||typeof matches[0].website!=="string")return;
  try{
    const raw=matches[0].website,url=new URL(raw.includes("://")?raw:"https://"+raw);
    const domain=url.hostname.toLowerCase().replace(/^www\./,"");
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.port||!validLogoDomain(domain))return;
    return domain;
  }catch{return;}
}
