import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {THEME_CSS} from "../../ui-library/themes/index.ts";

type Locale="en"|"ru";
type Theme="light"|"dark";
const root=resolve(import.meta.dirname,"../../..");

// All content is invented and fixed in source. Never capture a logged-in page.
export function syntheticDailyHtml(locale:Locale,theme:Theme):string {
  const ru=locale==="ru";
  const copy=ru?{
    title:"Пример Daily",label:"Синтетический пример · не реальные данные",date:"Пример дня",news:"Новости · зафиксированы",story:"Сюжет A · образец",storyDetail:"Краткое описание без настоящего источника.",live:"Может обновляться отдельно",mail:"Почта · 2 условных сообщения",weather:"Погода · 18° · время проверки показано отдельно",stale:"Если обновление не удалось, останется последний достоверный результат с пометкой.",
  }:{
    title:"Sample Daily",label:"Synthetic example · not real data",date:"Example day",news:"News · fixed edition",story:"Story A · placeholder",storyDetail:"Short description with no real source.",live:"May refresh separately",mail:"Mail · 2 fictional items",weather:"Weather · 18° · check time shown separately",stale:"If a refresh fails, the last good value remains with a visible status.",
  };
  return `<!doctype html><html lang="${locale}" data-theme="${theme}" data-synthetic="true"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'"><title>${copy.title}</title><style>${THEME_CSS}*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--surface-page);color:var(--text-primary);font:16px/1.45 var(--font-sans)}main{max-width:360px;margin:auto}.label{color:var(--accent-primary);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}h1{font-size:28px;line-height:1.1;margin:14px 0 4px}small{color:var(--text-muted)}section{padding:18px;margin-top:18px;border:1px solid var(--border-default);background:var(--surface-raised)}h2{font-size:16px;margin:0 0 14px}article{border-top:1px solid var(--border-default);padding-top:12px}article p{color:var(--text-muted);margin:6px 0 0}.status{color:var(--text-muted);font-size:13px;margin:12px 0 0}</style></head><body><main><div class="label">${copy.label}</div><h1>${copy.title}</h1><small>${copy.date}</small><section><h2>${copy.news}</h2><article><strong>${copy.story}</strong><p>${copy.storyDetail}</p></article></section><section><h2>${copy.live}</h2><p>${copy.mail}</p><p>${copy.weather}</p><p class="status">${copy.stale}</p></section></main></body></html>`;
}

export function assertSyntheticFixture(html:string):void {
  if(!html.includes('data-synthetic="true"')||!html.includes("default-src 'none'")||!html.includes("connect-src 'none'")||/<script\b|<form\b|<iframe\b|https?:\/\/|file:\/\//i.test(html))throw new Error("Screenshot fixture must be static, synthetic and network-isolated");
}

export function captureSyntheticDaily(locale:Locale,theme:Theme,browser:string):string {
  const html=syntheticDailyHtml(locale,theme);
  assertSyntheticFixture(html);
  const temp=mkdtempSync(join(tmpdir(),"kurami-docs-synthetic-"));
  const output=resolve(root,"dist/human-docs-synthetic",`daily-${locale}-${theme}.png`);
  try {
    const fixture=join(temp,"fixture.html");
    writeFileSync(fixture,html);
    mkdirSync(resolve(root,"dist/human-docs-synthetic"),{recursive:true});
    execFileSync(browser,["--headless","--no-sandbox","--disable-gpu","--disable-background-networking","--disable-dev-shm-usage","--host-resolver-rules=MAP * ~NOTFOUND","--window-size=390,844",`--user-data-dir=${join(temp,"profile")}`,`--screenshot=${output}`,pathToFileURL(fixture).href],{stdio:"pipe",timeout:20000});
    return output;
  }finally{rmSync(temp,{recursive:true,force:true});}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const locale=process.argv[2],theme=process.argv[3],browser=process.argv[4];
  if((locale!=="en"&&locale!=="ru")||(theme!=="light"&&theme!=="dark")||!browser?.startsWith("/"))throw new Error("Usage: node synthetic-daily.ts en|ru light|dark /absolute/path/to/chromium");
  console.log(captureSyntheticDaily(locale,theme,browser));
}
