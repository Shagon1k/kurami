import type {IncomingMessage,ServerResponse} from "node:http";
import {publicAppUrl,WEB_ORIGIN,type WebApp,type WebLanguage} from "./routes.ts";
import {escapeHtml} from "../ui-library/foundations/html.ts";
import {withEdgeToEdgeViewport} from "../ui-library/patterns/page-shell.ts";
import {HAPTICS_RUNTIME_JS} from "../ui-library/runtime/haptics.ts";

export function projectCss(css:string,app:WebApp,language:WebLanguage):string {
  return css.replace(/url\(\s*(["']?)(\/assets\/[^\s)"']+)\1\s*\)/gi,(_,quote,path)=>`url(${quote}${publicAppUrl(path,app,language)}${quote})`);
}

/** Product-owned URL projection. The reverse proxy never edits response bodies. */
export function projectHtml(html:string,app:WebApp,language:WebLanguage):string {
  // Skip raw-text blocks: source code, editorial text and JSON payloads are not markup.
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<[^>]+>/gi,tag=>{
    if(/^<style\b/i.test(tag))return projectCss(tag,app,language);
    const opening=tag.match(/^<script\b[^>]*>/i)?.[0];
    const target=opening??tag;
    const projected=target.replace(/(\s)(href|src|action|poster)=("[^"]*"|'[^']*')/gi,(_,space,attribute,quoted)=>{
      const quote=quoted[0],value=quoted.slice(1,-1).replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[0-9a-f]+|[0-9]+);/gi,(entity:string)=>{
        const named:Record<string,string>={"&amp;":"&","&quot;":'"',"&apos;":"'","&lt;":"<","&gt;":">"};
        if(named[entity.toLowerCase()])return named[entity.toLowerCase()]!;
        const code=entity.toLowerCase().startsWith("&#x")?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);
        return code>0&&code<=0x10ffff?String.fromCodePoint(code):"�";
      });
      return `${space}${attribute}=${quote}${escapeHtml(publicAppUrl(value,app,language))}${quote}`;
    });
    const redirect=/^<meta\b/i.test(projected)&&/http-equiv=["']refresh["']/i.test(projected)
      ?projected.replace(/\bcontent=(["'])(\d+;\s*url=)([^"']+)\1/i,(_,quote,prefix,url)=>`content=${quote}${prefix}${escapeHtml(publicAppUrl(url,app,language))}${quote}`)
      :projected;
    return opening?redirect+tag.slice(opening.length):redirect;
  });
}

export function projectDocument(html:string,app:WebApp,language:WebLanguage):string {
  const projected=html.includes('id="kurami-web-context"')?html:projectHtml(html,app,language);
  if(!/<head\b/i.test(projected))return projected;
  const context=`<script type="application/json" id="kurami-web-context">${JSON.stringify({app,language})}</script>`;
  const manifest='<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">';
  // Normalize native and prebuilt documents alike; Access requires the browser cookie.
  return withEdgeToEdgeViewport(projected.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i,head=>{
    const clean=head.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<link\b[^>]*>/gi,tag=>/^<link\b/i.test(tag)&&/\brel\s*=\s*(["'])[^"']*\bmanifest\b[^"']*\1/i.test(tag)?"":tag);
    return clean.replace(/<head\b[^>]*>/i,opening=>opening+manifest+(projected.includes('id="kurami-web-context"')?"":context));
  }));
}

export const WEB_CLIENT_JS=`function kuramiAppUrl(path) {
  const state=document.getElementById('kurami-web-context');
  if(!state||!path.startsWith('/')||path.startsWith('//'))return path;
  const context=JSON.parse(state.textContent);
  if(/^\\/(api|assets|media)\\//.test(path))return '/_apps/'+context.app+path;
  return path;
}
function kuramiAppLanguage(){const state=document.getElementById('kurami-web-context');return state?JSON.parse(state.textContent).language:document.documentElement.lang;}
if(document.getElementById('kurami-web-context')&&'serviceWorker' in navigator){
  addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
`+HAPTICS_RUNTIME_JS;

export function isMountedRequest(request:IncomingMessage,app:WebApp):boolean {
  if(request.headers["x-kurami-web-app"]!==app)return false;
  try {const host=new URL("http://"+request.headers.host).hostname;return host===new URL(WEB_ORIGIN).hostname||host==="127.0.0.1";}
  catch{return false;}
}

export function mountedLanguage(request:IncomingMessage):WebLanguage {
  return request.headers["x-kurami-web-lang"]==="ru"?"ru":"en";
}

/** Apply projection in the application, including retained Digest HTML and API fragments. */
export function mountResponse(request:IncomingMessage,response:ServerResponse,app:WebApp):void {
  if(!isMountedRequest(request,app))return;
  const language=mountedLanguage(request);
  const end=response.end.bind(response);
  response.end=((body?:any,...args:any[])=>{
    if(typeof body==="string"&&String(response.getHeader("Content-Type")??"").startsWith("text/html")){
      body=projectDocument(body,app,language);
      if(!response.headersSent&&response.hasHeader("Content-Length"))response.setHeader("Content-Length",Buffer.byteLength(body));
    }
    if(typeof body==="string"&&String(response.getHeader("Content-Type")??"").startsWith("text/css"))body=projectCss(body,app,language);
    return end(body,...args);
  }) as typeof response.end;
  const writeHead=response.writeHead.bind(response);
  response.writeHead=((status:number,...args:any[])=>{
    const location=response.getHeader("Location");
    if(typeof location==="string")response.setHeader("Location",publicAppUrl(location,app,language));
    // Node permits Location and length in writeHead's headers object as well.
    const headers=args.find(value=>value&&typeof value==="object"&&!Array.isArray(value));
    if(headers)for(const [key,value] of Object.entries(headers))response.setHeader(key,key.toLowerCase()==="location"&&typeof value==="string"?publicAppUrl(value,app,language):value as any);
    // Projection happens before end, so don't send the native HTML byte count.
    if(/^(text\/html|text\/css)/.test(String(response.getHeader("Content-Type")??"")))response.removeHeader("Content-Length");
    return writeHead(status,...args.filter(value=>value!==headers));
  }) as typeof response.writeHead;
}
