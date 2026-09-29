import {escapeHtml as e} from "../html.ts";
export function validLogoDomain(value:unknown):value is string {
  return typeof value==="string"&&value.length<=253&&/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(value)
    &&!/(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(value);
}
/** Presentation only: domain must have been independently matched to the company. */
export function renderCompanyAvatar(symbol:string,domain?:string):string {
  const letters=symbol.replace(/[^A-Za-z0-9]/g,"").slice(0,2).toUpperCase()||"?";
  return `<span class="company-avatar" aria-hidden="true"><span class="company-avatar__letters">${e(letters)}</span>${validLogoDomain(domain)?`<img data-company-logo src="https://cdn.tickerlogos.com/${domain}" alt="" width="40" height="40" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:""}</span>`;
}
export const COMPANY_AVATAR_STYLES=`
.company-avatar { position:relative; display:inline-grid; place-items:center; width:40px; height:40px; flex:0 0 40px; overflow:hidden; border:1px solid var(--border-default); border-radius:4px; background:var(--surface-panel); color:var(--text-muted); font:600 .8125rem var(--font-sans); }
.company-avatar img { position:absolute; inset:0; width:100%; height:100%; padding:4px; object-fit:contain; background:#fff; opacity:0; }
.company-avatar.is-loaded img { opacity:1; }
.company-avatar img[hidden] { display:none; }
.company-avatar.is-loaded .company-avatar__letters { visibility:hidden; }
`;
function initializeCompanyAvatars():void {
  document.querySelectorAll<HTMLImageElement>("[data-company-logo]").forEach(img=>{
    const show=()=>{if(img.naturalWidth>0){img.hidden=false;img.parentElement?.classList.add("is-loaded");}};
    img.addEventListener("load",show);img.addEventListener("error",()=>{img.hidden=true;img.parentElement?.classList.remove("is-loaded");});
    if(img.complete)show();
  });
}
export const COMPANY_AVATAR_CLIENT_SCRIPT=`(${initializeCompanyAvatars.toString()})();`;
