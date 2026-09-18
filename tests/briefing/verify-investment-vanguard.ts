import assert from "node:assert/strict";
import {buildFundSnapshot,collectVuaa,verifyVuaaPage,fundFresh} from "../../src/briefing/investment-review/vanguard.ts";
const html='<meta name="isin" content="IE00BFMXXD54"><meta name="ticker" content="VUAA"><meta name="share-class" content="Accumulating"><meta name="product-type" content="ETF">';
verifyVuaaPage(html);assert.throws(()=>verifyVuaaPage(html.replace("IE00BFMXXD54","IE0000000000")));
const makePage=(date="2026-08-31")=>{
  const row={issuerName:"Example",securityLongDescription:"Example",marketValuePercentage:0,ticker:"X",securityType:"EQ.STOCK",effectiveDate:date,sedol1:"0000000"};
  const items=[{...row,issuerName:"NVIDIA Corp",ticker:"NVDA",sedol1:"0000001",marketValuePercentage:8},
    {...row,issuerName:"Merck & Co Inc",ticker:"MRK",sedol1:"0000002",marketValuePercentage:.5},
    ...Array.from({length:500},(_,n)=>({...row,ticker:"X"+n,sedol1:"S"+n,marketValuePercentage:91.4/500})),
    {...row,ticker:"FUTURE",securityType:"DE.IND",marketValuePercentage:.1}];
  return {data:{funds:[{profile:{fundFullName:"Vanguard S&P 500 UCITS ETF (USD) Accumulating",fundCurrency:"USD"}}],borHoldings:[{holdings:{items,totalHoldings:items.length,lastItemKey:null as string|null}}]}};
};
const page=makePage(),snapshot=buildFundSnapshot([page],"2026-09-18","2026-09-18T06:00:00Z");
assert.equal(snapshot.rows.length,502);assert.equal(snapshot.excludedRows,1);assert(!snapshot.rows.some(r=>r.ticker==="FUTURE"));
assert(fundFresh("2026-08-31","2026-09-18"));assert(!fundFresh("2026-08-01","2026-09-18"));assert(!fundFresh("2026-09-30","2026-09-18"));
assert.throws(()=>buildFundSnapshot([makePage("2026-08-01")],"2026-09-18"));
const missing=structuredClone(page);missing.data.borHoldings[0]!.holdings.items.pop();assert.throws(()=>buildFundSnapshot([missing],"2026-09-18"));
const mixed=structuredClone(page);mixed.data.borHoldings[0]!.holdings.items[0]!.effectiveDate="2026-08-30";assert.throws(()=>buildFundSnapshot([mixed],"2026-09-18"));
const wrong=structuredClone(page);wrong.data.funds[0]!.profile.fundFullName="Other fund";assert.throws(()=>buildFundSnapshot([wrong],"2026-09-18"));
const corrupt=structuredClone(page);corrupt.data.borHoldings[0]!.holdings.items[0]!.marketValuePercentage=80;assert.throws(()=>buildFundSnapshot([corrupt],"2026-09-18"));
const pending=structuredClone(page);pending.data.borHoldings[0]!.holdings.lastItemKey="again";assert.throws(()=>buildFundSnapshot([pending],"2026-09-18"));
let calls=0;
const fake=(async(url:unknown,options:RequestInit)=>{
  calls++;assert.equal(options.redirect,"error");
  if(options.method==="POST"){const b=JSON.parse(String(options.body));assert(!b.query.includes("mutation"));assert.deepEqual(b.variables.portIds,["9694"]);return Response.json(page);}
  return new Response(html);
}) as typeof fetch;
const ready=await collectVuaa("2026-09-18",undefined,fake);assert.equal(ready.state,"ready");assert.equal(calls,2);
const failed=(async()=>new Response("",{status:503})) as typeof fetch;
const retained=await collectVuaa("2026-09-18",snapshot,failed);assert.equal(retained.state,"retained");assert.equal(retained.snapshot,snapshot);
assert.equal(retained.snapshot!.asOfDate,"2026-08-31");assert.equal((await collectVuaa("2026-09-18",undefined,failed)).state,"unavailable");
console.log("Vanguard: share-class identity, complete pagination, date/weight checks, derivative exclusion and unchanged last-success fallback verified.");
