import {readFile,writeFile,mkdir,lstat} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {briefingPaths,loadAddonSnapshot} from "../store.ts";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import {dayShift,parseStocksSnapshot,type StocksSnapshot} from "../stocks/model.ts";
import {calculateReview,parseReviewInput,validateReviewDraft,dateOnly,type ReviewInput} from "./model.ts";
import {renderInvestmentReview} from "./render.ts";
import {acceptReview} from "./store.ts";
import {buildReviewPacket} from "./packet.ts";
import {mergeCollectedEvidence} from "./collect.ts";

/** The report is a standalone private file: brand assets and fonts travel inside it. */
export async function standaloneReportHtml(html:string):Promise<string> {
  const assets=new URL("../../../src/ui-library/assets/brand/",import.meta.url);
  const [fox,favicon]=await Promise.all([readFile(new URL("kurami-fox-header.webp",assets)),readFile(new URL("kurami-favicon.svg",assets))]);
  const fontDirectory=new URL("../../../src/ui-library/assets/fonts/",import.meta.url);
  const fonts=new Map<string,string>(await Promise.all(fontFiles.map(async font=>[font.file,(await readFile(new URL(font.file,fontDirectory))).toString("base64")] as const)));
  return html
    .replace('src="/assets/kurami-fox.webp"','src="data:image/webp;base64,'+fox.toString("base64")+'"')
    .replace('href="/favicon.svg"','href="data:image/svg+xml;base64,'+favicon.toString("base64")+'"')
    .replace(/href="\/(?!\/)([^"]*)"/g,(_match,path:string)=>`href="https://digest.shagon1k.win/${path}"`)
    .replace(/url\("\/assets\/([a-z0-9-]+\.woff2)"\)/g,(_match,file:string)=>{
      const font=fonts.get(file);
      if(!font)throw new Error(`Unknown report font: ${file}`);
      return `url("data:font/woff2;base64,${font}")`;
    });
}
import {fontFiles} from "../../ui-library/foundations/fonts.ts";

export function parseEcbUSD(xml:string,date:string):number {
  if(!dateOnly(date)||xml.length>300000)throw Error("Invalid ECB input");
  const block=[...xml.matchAll(/<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g)].filter(m=>m[1]===date);
  if(block.length!==1)throw Error("ECB date not available");
  const rates=[...block[0]![2]!.matchAll(/<Cube\s+currency=["']USD["']\s+rate=["']([0-9.]+)["']\s*\/>/g)];
  const rate=Number(rates[0]?.[1]);if(rates.length!==1||!Number.isFinite(rate)||rate<=0||rate>100)throw Error("Invalid ECB USD rate");return rate;
}
const readJson=async(path:string)=>{const text=await readFile(path,"utf8");if(text.length>2_000_000)throw Error("Review file too large");return JSON.parse(text);};
async function privateWrite(path:string,value:string){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,value,{mode:0o600,flag:"wx"});}
export async function snapshotReview(baselinePath:string,evidence:Pick<ReviewInput,"sources"|"facts"|"fundHoldings"|"candidates"|"researchCoverage">,date:string,paths=briefingPaths(),fetcher:typeof fetch=nodeHttpFetch):Promise<ReviewInput>{
  const info=await lstat(baselinePath);
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error("Baseline must be a private regular file");
  if(!dateOnly(date))throw Error("Invalid review date");
  const baseline=await readJson(baselinePath),db=new DatabaseSync(paths.databasePath,{readOnly:true});let market;
  try{market=parseStocksSnapshot(loadAddonSnapshot(db,"stocks")?.envelope);}finally{db.close();}
  const dates=[...new Set(market.data.series.flatMap(s=>s.points.at(-1)?.date??[]))];
  // Weekly Sunday publication uses the most recent completed market session
  // (normally Friday). A weekend must not make otherwise fresh quotes unusable.
  if(dates.length!==1||dates[0]!>date||dates[0]!<dayShift(date,-4))throw Error("Trial requires a recent aligned completed quote session");
  const url="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
  const response=await fetcher(url,{redirect:"error",signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error("ECB unavailable");
  const usdPerEUR=parseEcbUSD(await response.text(),dates[0]!);
  return parseReviewInput({version:1,asOfDate:date,mode:"trial",baseline,market,fx:{date:dates[0],usdPerEUR,sourceId:"ecb-fx"},
    ...evidence,sources:[{id:"ecb-fx",title:"ECB — EUR reference rates",url,asOfDate:dates[0],retrievedAt:new Date().toISOString()},...evidence.sources]});
}
if(import.meta.main){
  const [command,...args]=process.argv.slice(2),flags=new Map<string,string>();
  for(let n=0;n<args.length;n+=2){if(!args[n]?.startsWith("--")||!args[n+1]||flags.has(args[n]!))throw Error("Invalid review arguments");flags.set(args[n]!,args[n+1]!);}
  const flag=(key:string)=>{const v=flags.get("--"+key);if(!v)throw Error("Missing review argument: "+key);return v;};
  if(command==="snapshot"){
    if([...flags.keys()].some(k=>!["--baseline","--evidence","--date","--output"].includes(k)))throw Error("Unknown snapshot argument");
    const raw=await readJson(flag("evidence"));
    const input=await snapshotReview(resolve(flag("baseline")),{sources:raw.sources,facts:raw.facts,fundHoldings:raw.fundHoldings,candidates:raw.candidates,researchCoverage:raw.researchCoverage},flag("date"));
    const calculated=calculateReview(input);await privateWrite(resolve(flag("output")),JSON.stringify(input,null,2)+"\n");
    console.log(JSON.stringify({snapshot:flag("output"),inputDigest:calculated.inputDigest,complete:calculated.complete,positions:calculated.rows.length,financialApiRequests:0,ecbRequests:1}));
  }else if(command==="render"){
    if([...flags.keys()].some(k=>!["--input","--draft","--output"].includes(k)))throw Error("Unknown render argument");
    const input=parseReviewInput(await readJson(flag("input"))),draft=validateReviewDraft(input,await readJson(flag("draft")));
    const html=await standaloneReportHtml(renderInvestmentReview(input,draft));
    await privateWrite(resolve(flag("output")),html);
    console.log(JSON.stringify({report:flag("output"),mode:input.mode,publicRoute:false,scheduleEnabled:false}));
  }else if(command==="merge-evidence"){
    if(flags.size!==3||![...flags.keys()].every(k=>["--input","--collected","--output"].includes(k)))throw Error("Invalid evidence merge arguments");
    const merged=mergeCollectedEvidence(parseReviewInput(await readJson(flag("input"))),await readJson(flag("collected")));
    await privateWrite(resolve(flag("output")),JSON.stringify(merged,null,2)+"\n");
    console.log(JSON.stringify({evidence:flag("output"),facts:merged.facts.length}));
  }else if(command==="draft-packet"){
    if(flags.size!==2||![...flags.keys()].every(k=>["--input","--output"].includes(k)))throw Error("Invalid packet arguments");
    const packet=await buildReviewPacket(parseReviewInput(await readJson(flag("input"))));
    await privateWrite(resolve(flag("output")),JSON.stringify(packet)+"\n");
    console.log(JSON.stringify({packet:flag("output"),tools:0}));
  }else if(command==="accept"){
    if([...flags.keys()].some(k=>!["--input","--draft","--store"].includes(k)))throw Error("Unknown acceptance argument");
    const input=parseReviewInput(await readJson(flag("input"))),draft=validateReviewDraft(input,await readJson(flag("draft")));
    const saved=await acceptReview(resolve(flag("store")),input,draft);
    console.log(JSON.stringify({accepted:saved.id,slot:input.mode,scheduleEnabled:false}));
  }else if(command==="calculate"){
    if(flags.size!==1)throw Error("Unexpected calculate argument");console.log(JSON.stringify(calculateReview(parseReviewInput(await readJson(flag("input")))),null,2));
  }else throw Error("Use snapshot, calculate, render or explicit accept; no trade/schedule command exists");
}
