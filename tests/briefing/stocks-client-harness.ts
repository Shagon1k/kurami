import assert from "node:assert/strict";
import {runInNewContext} from "node:vm";
import {STOCKS_CLIENT_SCRIPT} from "../../src/briefing/stocks/client.ts";

/** Small event/transport unit harness, not a substitute for browser visual QA. */
export async function verifyStockClient():Promise<void>{
  class Node {
    dataset:Record<string,string>={};listeners=new Map<string,Function>();children:Node[]=[];
    open=false;value="original";textContent="";className="";type="";
    kind="";owner:Node|null=null;
    addEventListener(type:string,callback:Function){this.listeners.set(type,callback);}
    querySelector(selector:string):Node|null{
      if(selector==="[data-stock-details]")return this.children[0]??null;
      if(selector==="[data-stock-load-status]")return this.children[1]??null;
      if(selector==="[data-stock-sort]")return sort;
      if(selector==="[data-stock-rows]")return container;
      return null;
    }
    querySelectorAll(){return rows;}
    closest(selector:string){
      if(selector==='a[data-stock-period]')return this.kind==="period"?this:null;
      if(selector==="[data-stock-row]")return this.owner;
      return null;
    }
    setAttribute(){}removeAttribute(){}contains(){return false;}
    replaceChildren(...children:Node[]){this.children=children;}
    append(...children:Node[]){this.children.push(...children);}
    focus(){}scrollIntoView(){}
    emit(type:string,event:unknown={}){this.listeners.get(type)?.(event);}
  }
  const root=new Node(),sort=new Node(),container=new Node();root.dataset.stockPeriod="1m";
  const rows=["VUAA","NVDA"].map((id,index)=>{
    const row=new Node();row.dataset={stockRow:id,stockIndex:String(index),stockMove:String(index)};
    row.children=[new Node(),new Node()];row.children[0]!.dataset.stockLoaded="";return row;
  });
  let fail=false,requests=0;const urls:string[]=[];
  const doc={querySelector:()=>root,querySelectorAll:()=>[],dispatchEvent:()=>{},activeElement:null,
    importNode:(n:Node)=>n,createTextNode:(text:string)=>{const n=new Node();n.textContent=text;return n;},createElement:()=>new Node()};
  class Parser {parseFromString(html:string){const content=new Node();content.dataset.period=JSON.parse(html).period;return {querySelector:(selector:string)=>selector==="[data-stock-detail-content]"?content:null};}}
  runInNewContext(STOCKS_CLIENT_SCRIPT,{document:doc,Element:Node,DOMParser:Parser,Event,URL,URLSearchParams,AbortSignal,
    location:{href:"https://example.test/stocks"},history:{replaceState:(_a:unknown,_b:unknown,url:URL)=>urls.push(url.toString())},
    fetch:async(url:string)=>{requests++;return fail?new Response("fail",{status:503}):new Response(JSON.stringify({period:new URL(url,"https://example.test").searchParams.get("period")}));}});
  const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
  let prevented=false;
  root.emit("click",{target:new Node(),preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,false,"Summary clicks must keep native disclosure behavior");
  rows[0]!.open=true;rows[0]!.emit("toggle");await settle();
  assert.equal(rows[0]!.children[0]!.dataset.stockLoaded,"1m");assert.equal(requests,1);
  const link=new Node();link.kind="period";link.owner=rows[0]!;link.dataset.stockPeriod="3m";
  root.emit("click",{target:link,preventDefault(){}});await settle();
  assert.equal(rows[0]!.children[0]!.dataset.stockLoaded,"3m");
  rows[1]!.open=true;rows[1]!.emit("toggle");await settle();
  assert.equal(rows[0]!.open,false);assert.equal(rows[1]!.children[0]!.dataset.stockLoaded,"3m","Period follows the next row");
  const before=requests;rows[0]!.open=true;rows[0]!.emit("toggle");await settle();assert.equal(requests,before);
  fail=true;link.dataset.stockPeriod="1y";root.emit("click",{target:link,preventDefault(){}});await settle();
  assert.equal(rows[0]!.children[0]!.dataset.stockLoaded,"3m","Failed replacement keeps prior chart");
  const retry=rows[0]!.children[1]!.children.at(-1)!;assert.equal(retry.textContent,"Повторить");
  fail=false;retry.emit("click");await settle();assert.equal(rows[0]!.children[0]!.dataset.stockLoaded,"1y");
  assert(urls.at(-1)!.includes("period=1y"));
  sort.value="moves";sort.emit("change");assert.equal(container.children[0]!.dataset.stockRow,"NVDA");
}
