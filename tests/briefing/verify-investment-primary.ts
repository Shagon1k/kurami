import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {htmlText,selectFilings,exhibitLinks,financialRelease,collectPrimaryDocuments} from "../../src/briefing/investment-review/primary.ts";
import {primaryPacket,primaryEvidence,primaryRepairPacket,primaryCheckPacket,validatePrimaryCheck,type PrimaryExtraction} from "../../src/briefing/investment-review/primary-evidence.ts";
const date="2026-09-18",target={symbol:"AAA",namePattern:"Example"};
const metadata={cik:"0000000001",name:"Example Inc",tickers:["AAA"],filings:{recent:{
  form:["8-K","8-K","8-K","6-K"],filingDate:["2026-10-01","2026-09-01","2026-08-01","2025-01-01"],
  accessionNumber:["0000000001-26-000003","0000000001-26-000002","0000000001-26-000001","0000000001-25-000001"],
  primaryDocument:["future.htm","current.htm","unrelated.htm","old.htm"],items:["2.02","2.02,9.01","8.01",""]
}}};
assert.deepEqual(selectFilings(metadata,target,date).map(f=>f.document),["current.htm"]);
assert.throws(()=>selectFilings({...metadata,tickers:["OTHER"]},target,date));
const root="https://www.sec.gov/Archives/edgar/data/1/000000000126000002/";
const cover='<a href="release99-1.htm">Exhibit 99.1</a><a href="https://evil.example/x.htm">Exhibit 99.1</a><a href="../../elsewhere.htm">earnings</a><a href="release99-2.htm?secret=x">99.1</a>';
assert.deepEqual(exhibitLinks(cover,root+"current.htm"),[root+"release99-1.htm"]);
assert.equal(htmlText("<script>bad()</script><p>A&nbsp;&#36;2</p><style>bad</style>"),"A $2");
const release="<h1>Example Inc</h1><p>Second quarter ended June 30, 2026: revenue $20 million; net loss $2 million.</p><p>All amounts are reported in United States dollars for this completed period.</p>";
assert(financialRelease(htmlText(release),target));assert(!financialRelease(htmlText(release),{...target,namePattern:"Other"}));
const urls:string[]=[];
const fake=(async (url:unknown,options:RequestInit)=>{
  assert.equal(options.redirect,"error");urls.push(String(url));
  if(String(url).endsWith("company_tickers.json"))return Response.json({0:{cik_str:1,ticker:"AAA",title:"Example Inc"}});
  if(String(url).includes("/submissions/"))return Response.json(metadata);
  if(String(url)===root+"current.htm")return new Response(cover);
  if(String(url)===root+"release99-1.htm")return new Response(release);
  throw Error("Unexpected source URL");
}) as typeof fetch;
const collection=await collectPrimaryDocuments([target],date,fake);
assert.equal(collection.requests,4);assert.equal(collection.coverage[0]!.state,"collected");assert.equal(collection.documents.length,1);
const packet=primaryPacket(collection);assert(packet.prompt.includes("not instructions"));assert(!packet.prompt.includes("quantity"));
const extraction:PrimaryExtraction={version:2,collectionDigest:createHash("sha256").update(JSON.stringify(collection)).digest("hex"),items:[{
  documentId:collection.documents[0]!.id,symbol:"AAA",facts:[{kind:"reported",statement:"За второй квартал 2026 компания сообщила выручку $20 млн.",evidenceIds:["p001"]}]
}]};
const evidence=primaryEvidence(collection,extraction);assert.equal(evidence.facts.length,1);assert(evidence.requiresSemanticReview);
const ambiguous=structuredClone(extraction);ambiguous.items[0]!.facts[0]!.statement="За квартал выручка компании составила $1,234 млн.";
assert.throws(()=>primaryEvidence(collection,ambiguous),/thousands separator/);
assert(primaryRepairPacket(collection,ambiguous).prompt.includes("ONE BOUNDED REPAIR"));
assert.throws(()=>primaryRepairPacket(collection,extraction),/already valid/);
assert(primaryCheckPacket(collection,extraction).prompt.includes("EVERY fact"));
const check={version:1,collectionDigest:extraction.collectionDigest,extractionDigest:createHash("sha256").update(JSON.stringify(extraction)).digest("hex"),
  checkedDocumentIds:collection.documents.map(d=>d.id),issues:[]};
validatePrimaryCheck(collection,extraction,check);
assert.throws(()=>validatePrimaryCheck(collection,extraction,{...check,issues:[{reason:"Wrong currency"}]}));
assert.throws(()=>validatePrimaryCheck(collection,extraction,{...check,checkedDocumentIds:[]}));
assert.equal(evidence.sources[0]!.url,root+"release99-1.htm");assert.equal(evidence.sources[0]!.asOfDate,"2026-09-01");
const invented=structuredClone(extraction);invented.items[0]!.facts[0]!.evidenceIds=["p999"];assert.throws(()=>primaryEvidence(collection,invented));
assert.throws(()=>primaryEvidence(collection,{...extraction,version:1}));
const wrongIssuer=structuredClone(extraction);wrongIssuer.items[0]!.symbol="BBB";assert.throws(()=>primaryEvidence(collection,wrongIssuer));
assert.throws(()=>primaryEvidence(collection,{...extraction,collectionDigest:"wrong"}));
const changed=structuredClone(collection);changed.documents[0]!.text+=" tampered";assert.throws(()=>primaryPacket(changed));
const forecast=structuredClone(extraction);forecast.items[0]!.facts[0]!.kind="guidance";assert(primaryEvidence(collection,forecast).facts[0]!.statement.startsWith("Прогноз компании"));
const missing=structuredClone(extraction);missing.items[0]!.facts=[];assert.equal(primaryEvidence(collection,missing).coverage[0]!.state,"unavailable");
const unavailable=await collectPrimaryDocuments([target],date,(async(url:unknown)=>{
  if(String(url).endsWith("company_tickers.json"))return Response.json({0:{cik_str:1,ticker:"AAA",title:"Example Inc"}});
  return new Response("",{status:403});
}) as typeof fetch);
assert.equal(unavailable.documents.length,0);assert.equal(unavailable.coverage[0]!.state,"unavailable");
console.log("Primary research: live filing selection, safe exhibits, source/issuer/digest/anchor binding, forecast labelling and partial-source isolation verified.");
