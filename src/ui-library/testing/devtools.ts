// Minimal Chrome DevTools Protocol client for local headless browser checks. No npm dependency.
import {spawn,type ChildProcess} from "node:child_process";
import {existsSync,mkdtempSync,readdirSync,rmSync} from "node:fs";
import {homedir,tmpdir} from "node:os";
import {join} from "node:path";
import {setTimeout as delay} from "node:timers/promises";

export class Devtools {
  private id=0;
  private pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
  private socket:WebSocket;
  constructor(socket:WebSocket){
    this.socket=socket;
    socket.addEventListener("message",event=>{
      const message=JSON.parse(String(event.data)) as {id?:number;result?:unknown;error?:{message:string}};
      if(!message.id)return;
      const pending=this.pending.get(message.id);
      if(!pending)return;
      this.pending.delete(message.id);
      if(message.error)pending.reject(new Error(message.error.message));else pending.resolve(message.result);
    });
  }
  call<T=any>(method:string,params:Record<string,unknown>={}):Promise<T>{
    const id=++this.id;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.socket.send(JSON.stringify({id,method,params}));});
  }
  async evaluate<T>(expression:string):Promise<T>{
    const result=await this.call<{result:{value:T}}>("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
    return result.result.value;
  }
  close(){this.socket.close();}
}

/** An explicit absolute path wins; otherwise use a Playwright-managed headless shell if one is installed. */
export function findBrowser(explicit?:string):string {
  if(explicit)return explicit;
  const cache=join(homedir(),".cache/ms-playwright");
  const shell=existsSync(cache)?readdirSync(cache).filter(name=>name.startsWith("chromium_headless_shell-")).sort().at(-1):undefined;
  const candidate=shell&&join(cache,shell,"chrome-headless-shell-linux64/chrome-headless-shell");
  if(!candidate||!existsSync(candidate))throw new Error("No headless browser found; pass /absolute/path/to/chromium");
  return candidate;
}

export async function launchBrowser(path:string):Promise<{devtools:Devtools;close:()=>void}> {
  const profile=mkdtempSync(join(tmpdir(),"kurami-ui-browser-"));
  const browser:ChildProcess=spawn(path,["--headless","--no-sandbox","--disable-gpu","--disable-background-networking","--disable-dev-shm-usage","--hide-scrollbars","--font-render-hinting=none","--remote-debugging-address=127.0.0.1","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:["ignore","ignore","pipe"]});
  let port=0;
  browser.stderr?.on("data",chunk=>{const match=String(chunk).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);if(match)port=Number(match[1]);});
  for(let attempt=0;attempt<100&&!port;attempt++)await delay(100);
  if(!port){browser.kill();throw new Error("Local headless browser did not start DevTools");}
  let target:string|undefined;
  for(let attempt=0;attempt<100&&!target;attempt++){
    try{
      const list=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{type:string;webSocketDebuggerUrl?:string}>;
      target=list.find(item=>item.type==="page"&&item.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
    }catch{}
    if(!target)await delay(100);
  }
  if(!target){browser.kill();throw new Error("Local headless browser did not expose a page target");}
  const socket=new WebSocket(target);
  await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  const devtools=new Devtools(socket);
  return {devtools,close:()=>{devtools.close();browser.kill();rmSync(profile,{recursive:true,force:true});}};
}
