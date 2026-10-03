import {createHash} from "node:crypto";
import {readFile,writeFile} from "node:fs/promises";
import {setTimeout as pause} from "node:timers/promises";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import {dateOnly} from "./model.ts";
import type {ResearchTarget} from "./collect.ts";

type Filing={date:string;accession:string;document:string;form:string;items:string};
type Submissions={cik:string;name:string;tickers:string[];filings:{recent:Record<string,string[]>}};
export type PrimaryDocument={id:string;symbol:string;title:string;url:string;filedAt:string;retrievedAt:string;
  contentDigest:string;text:string;truncated:boolean};
export type PrimaryCollection={version:1;asOfDate:string;documents:PrimaryDocument[];requests:number;
  coverage:Array<{symbol:string;state:"collected"|"unavailable";reason:string}>};
export function htmlText(html:string):string{
  return html.replace(/<!--[^]*?-->/g," ").replace(/<(script|style|noscript|ix:hidden)\b[^>]*>[^]*?<\/\1\s*>/gi," ")
    .replace(/<\/?(?:p|div|tr|h[1-6]|li|br|section|article)\b[^>]*>/gi,"\n")
    .replace(/<\/?t[dh]\b[^>]*>/gi," | ").replace(/<[^>]*>/g," ")
    .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,code:string)=>{const n=code[0]!.toLowerCase()==="x"?parseInt(code.slice(1),16):Number(code);return n>0&&n<=0x10ffff?String.fromCodePoint(n):" ";})
    .replace(/&(nbsp|amp|quot|apos|lt|gt|ndash|mdash);/gi,(_,name:string)=>({nbsp:" ",amp:"&",quot:'"',apos:"'",lt:"<",gt:">",ndash:"–",mdash:"—"}[name.toLowerCase()]??" "))
    .replace(/[\t \u00a0]+/g," ").replace(/ *\n */g,"\n").replace(/\n{3,}/g,"\n\n").trim();
}
export function selectFilings(data:Submissions,target:ResearchTarget,asOfDate:string):Filing[]{
  if(!data.tickers?.includes(target.symbol)||!data.name?.toLowerCase().includes(target.namePattern.toLowerCase())
    ||!/^\d{1,10}$/.test(String(data.cik)))throw Error("Issuer identity mismatch");
  const r=data.filings?.recent;if(!r||!Array.isArray(r.form))throw Error("Missing filing metadata");
  return r.form.map((form,i)=>({form,date:r.filingDate?.[i]??"",accession:r.accessionNumber?.[i]??"",
    document:r.primaryDocument?.[i]??"",items:r.items?.[i]??""}))
    .filter(f=>dateOnly(f.date)&&f.date<=asOfDate&&(Date.parse(asOfDate)-Date.parse(f.date))/86400000<=150
      &&/^\d{10}-\d{2}-\d{6}$/.test(f.accession)&&/^[a-z0-9_.-]+\.html?$/i.test(f.document)
      &&(f.form==="6-K"||f.form==="8-K"&&f.items.split(",").map(x=>x.trim()).includes("2.02")))
    .sort((a,b)=>b.date.localeCompare(a.date)||a.accession.localeCompare(b.accession)).slice(0,8);
}
export function exhibitLinks(html:string,base:string):string[]{
  const root=new URL(".",base),links:string[]=[];
  for(const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([^]*?)<\/a>/gi)){
    if(!/(?:ex(?:hibit)?[-_]?99|99[._-]?1|earnings|press.?release)/i.test(m[1]!+" "+htmlText(m[2]!)))continue;
    try{const u=new URL(m[1]!.replaceAll("&amp;","&"),base);u.hash="";
      if(u.protocol==="https:"&&u.host===root.host&&u.pathname.startsWith(root.pathname)&&!u.username&&!u.password&&!u.search
        &&/\.html?$/i.test(u.pathname)&&u.href!==base&&!links.includes(u.href))links.push(u.href);
    }catch{/* malformed link is not a fetch target */}
  }
  return links.slice(0,2);
}
export function financialRelease(text:string,target:ResearchTarget):boolean{
  return text.toLowerCase().includes(target.namePattern.toLowerCase())&&/revenue|net sales/i.test(text)
    &&/quarter|half.year|six.month|interim/i.test(text)&&/million|billion|\bUSD\b|\bEUR\b/i.test(text);
}

/** Discover from live SEC submissions, never a manually dated quarterly URL. */
export async function collectPrimaryDocuments(targets:ResearchTarget[],asOfDate:string,fetcher:typeof fetch=nodeHttpFetch):Promise<PrimaryCollection>{
  if(!dateOnly(asOfDate)||!targets.length||targets.length>8||new Set(targets.map(t=>t.symbol)).size!==targets.length
    ||targets.some(t=>!/^[A-Z][A-Z0-9.-]{0,15}$/.test(t.symbol)||typeof t.namePattern!=="string"||t.namePattern.length<3||t.namePattern.length>100))throw Error("Invalid primary-source targets");
  const result:PrimaryCollection={version:1,asOfDate,documents:[],coverage:[],requests:0};
  const read=async(url:string)=>{
    if(result.requests>=64)throw Error("Request budget exhausted");
    if(result.requests)await pause(150);
    const u=new URL(url);
    if(!["www.sec.gov","data.sec.gov"].includes(u.hostname)||u.protocol!=="https:"||u.username||u.password||u.search)throw Error("Unapproved source");
    result.requests++;
    const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(15000),
      headers:{"user-agent":"KuramiResearch/0.1 (+https://kurami.shagon1k.win; personal research)","accept":"application/json,text/html"}});
    if(!response.ok)throw Error("Source unavailable");
    const body=await response.text();if(body.length>3_000_000)throw Error("Source too large");return body;
  };
  const index=JSON.parse(await read("https://www.sec.gov/files/company_tickers.json")) as Record<string,{cik_str:number;ticker:string;title:string}>;
  for(const target of targets){
    let found=false,reason="Подходящий свежий первичный отчёт не найден в пределах лимита";
    try{
      const matches=Object.values(index).filter(row=>row.ticker===target.symbol);
      if(matches.length!==1||!matches[0]!.title.toLowerCase().includes(target.namePattern.toLowerCase()))throw Error("Registry unavailable");
      const cik=matches[0]!.cik_str;if(!Number.isSafeInteger(cik)||cik<=0)throw Error("Bad issuer");
      const data=JSON.parse(await read("https://data.sec.gov/submissions/CIK"+String(cik).padStart(10,"0")+".json")) as Submissions;
      if(Number(data.cik)!==cik)throw Error("Bad issuer");
      for(const f of selectFilings(data,target,asOfDate)){
        const url=`https://www.sec.gov/Archives/edgar/data/${cik}/${f.accession.replaceAll("-","")}/${f.document}`;
        let cover:string;try{cover=await read(url);}catch{continue;}
        const candidates=exhibitLinks(cover,url);
        // Some foreign issuers put the release directly inside the 6-K.
        const docs:Array<{url:string;html:string}>=[];
        for(const link of candidates){try{docs.push({url:link,html:await read(link)});}catch{/* a different accessible primary source may still work */}}
        docs.push({url,html:cover});
        const valid=docs.find(d=>financialRelease(htmlText(d.html),target));
        if(!valid)continue;
        const plain=htmlText(valid.html),retrievedAt=new Date().toISOString();
        result.documents.push({id:"primary-"+target.symbol.toLowerCase()+"-"+f.accession.replaceAll("-",""),
          symbol:target.symbol,title:data.name+" · "+f.form,filedAt:f.date,url:valid.url,retrievedAt,
          contentDigest:createHash("sha256").update(plain).digest("hex"),text:plain.slice(0,50000),truncated:plain.length>50000});
        found=true;break;
      }
    }catch{reason="Первичный источник недоступен; сохранённые факты не отменяются";}
    result.coverage.push({symbol:target.symbol,state:found?"collected":"unavailable",reason:found?"Найден и получен первичный документ; факты ещё требуют извлечения и проверки":reason});
  }
  return result;
}
if(import.meta.main){
  const [targetsPath,date,output]=process.argv.slice(2);if(!targetsPath||!date||!output)throw Error("Usage: primary <public-targets.json> <as-of-date> <new-output.json>");
  const result=await collectPrimaryDocuments(JSON.parse(await readFile(targetsPath,"utf8")),date);
  await writeFile(output,JSON.stringify(result,null,2)+"\n",{mode:0o600,flag:"wx"});
  console.log(JSON.stringify({requests:result.requests,coverage:result.coverage,documents:result.documents.map(({text,...d})=>({...d,textLength:text.length}))}));
}
