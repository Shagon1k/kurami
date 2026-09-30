import {AsyncLocalStorage} from "node:async_hooks";

export type DigestLanguage = "en" | "ru";

const languageStore = new AsyncLocalStorage<DigestLanguage>();

/** Publication still renders Russian by default; HTTP routes set a language explicitly. */
export function digestLanguage():DigestLanguage {
  return languageStore.getStore() ?? "ru";
}

export function withDigestLanguage<T>(language:DigestLanguage,render:()=>T):T {
  return languageStore.run(language,render);
}

export function digestText(ru:string,en:string):string {
  return digestLanguage()==="en"?en:ru;
}

export function digestPath(path:string,language:DigestLanguage=digestLanguage()):string {
  if(!path.startsWith("/")||path.startsWith("//"))throw new Error("Digest path must be absolute and local");
  return `/${language}${path}`;
}

/** Retained HTML can contain pre-locale page links; never touch source or API URLs. */
export function localizeDigestLinks(html:string):string {
  return html.replace(/(<a\b[^>]*\bhref=")(\/[^\"]*)(")/gi,(match,open:string,path:string,close:string)=>{
    if(!/^\/(?:$|[?#]|(?:cinema|weekly|stocks)(?:$|[?#])|daily\/\d{4}-\d{2}-\d{2}(?:$|[?#])|preview\/(?:weekly|(?:daily|cinema)\/\d{4}-\d{2}-\d{2})(?:$|[?#]))/.test(path))return match;
    return `${open}${digestPath(path)}${close}`;
  });
}
