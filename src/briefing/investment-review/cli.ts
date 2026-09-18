import {readFile,writeFile,mkdir,lstat} from "node:fs/promises";
import {resolve,dirname} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {briefingPaths,loadAddonSnapshot} from "../store.ts";
import {nodeHttpFetch} from "../providers/node-http-fetch.ts";
import {parseStocksSnapshot} from "../stocks/model.ts";
import {calculateReview,parseReviewInput,validateReviewDraft,dateOnly,type ReviewInput} from "./model.ts";
import {renderInvestmentReview} from "./render.ts";

export function parseEcbUSD(xml:string,date:string):number {
  if(!dateOnly(date)||xml.length>300000)throw Error("Invalid ECB input");
  const block=[...xml.matchAll(/<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g)].filter(m=>m[1]===date);
  if(block.length!==1)throw Error("ECB date not available");
  const rates=[...block[0]![2]!.matchAll(/<Cube\s+currency=["']USD["']\s+rate=["']([0-9.]+)["']\s*\/>/g)];
  const rate=Number(rates[0]?.[1]);if(rates.length!==1||!Number.isFinite(rate)||rate<=0||rate>100)throw Error("Invalid ECB USD rate");return rate;
}
const readJson=async(path:string)=>{const text=await readFile(path,"utf8");if(text.length>2_000_000)throw Error("Review file too large");return JSON.parse(text);};
async function privateWrite(path:string,value:string){await mkdir(dirname(path),{recursive:true,mode:0o700});await writeFile(path,value,{mode:0o600,flag:"wx"});}
if(import.meta.main){
  const [command,...args]=process.argv.slice(2),flags=new Map<string,string>();
  for(let n=0;n<args.length;n+=2){if(!args[n]?.startsWith("--")||!args[n+1]||flags.has(args[n]!))throw Error("Invalid review arguments");flags.set(args[n]!,args[n+1]!);}
  const flag=(key:string)=>{const v=flags.get("--"+key);if(!v)throw Error("Missing review argument: "+key);return v;};
  if(command==="snapshot"){
    if([...flags.keys()].some(k=>!["--baseline","--evidence","--date","--output"].includes(k)))throw Error("Unknown snapshot argument");
    const path=resolve(flag("baseline")),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw Error("Baseline must be a private regular file");
    const baseline=await readJson(path),evidence=await readJson(flag("evidence")),paths=briefingPaths(),date=flag("date");
    if(!dateOnly(date))throw Error("Invalid review date");
    const db=new DatabaseSync(paths.databasePath,{readOnly:true});let market;
    try{market=parseStocksSnapshot(loadAddonSnapshot(db,"stocks")?.envelope);}finally{db.close();}
    const dates=[...new Set(market.data.series.flatMap(s=>s.points.at(-1)?.date??[]))];
    if(dates.length!==1||dates[0]!>=date)throw Error("Trial requires aligned completed quote sessions");
    const url="https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
    const response=await nodeHttpFetch(url,{redirect:"error",signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error("ECB unavailable");
    const xml=await response.text(),usdPerEUR=parseEcbUSD(xml,dates[0]!);
    const input=parseReviewInput({version:1,asOfDate:date,mode:"trial",baseline,market,fx:{date:dates[0],usdPerEUR,sourceId:"ecb-fx"},
      sources:[{id:"ecb-fx",title:"ECB — EUR reference rates",url,asOfDate:dates[0],retrievedAt:new Date().toISOString()},...evidence.sources],facts:evidence.facts,...(evidence.fundHoldings?{fundHoldings:evidence.fundHoldings}:{})});
    const calculated=calculateReview(input);await privateWrite(resolve(flag("output")),JSON.stringify(input,null,2)+"\n");
    console.log(JSON.stringify({snapshot:flag("output"),inputDigest:calculated.inputDigest,complete:calculated.complete,positions:calculated.rows.length,financialApiRequests:0,ecbRequests:1}));
  }else if(command==="render"){
    if([...flags.keys()].some(k=>!["--input","--draft","--output"].includes(k)))throw Error("Unknown render argument");
    const input=parseReviewInput(await readJson(flag("input"))),draft=validateReviewDraft(input,await readJson(flag("draft")));
    const assets=new URL("../../../integrations/hermes/skills/kurami-ui-preview-language/assets/",import.meta.url);
    const [fox,favicon]=await Promise.all([readFile(new URL("kurami-fox-transparent.png",assets)),readFile(new URL("kurami-favicon.svg",assets))]);
    const html=renderInvestmentReview(input,draft)
      .replace('src="/assets/kurami-fox.png"','src="data:image/png;base64,'+fox.toString("base64")+'"')
      .replace('href="/favicon.svg"','href="data:image/svg+xml;base64,'+favicon.toString("base64")+'"')
      .replace('href="/"','href="https://digest.shagon1k.win/"');
    await privateWrite(resolve(flag("output")),html);
    console.log(JSON.stringify({report:flag("output"),mode:input.mode,publicRoute:false,scheduleEnabled:false}));
  }else if(command==="calculate"){
    if(flags.size!==1)throw Error("Unexpected calculate argument");console.log(JSON.stringify(calculateReview(parseReviewInput(await readJson(flag("input")))),null,2));
  }else throw Error("Use snapshot, calculate or render; no publish/execute command exists");
}
