import {escapeHtml} from "./html.ts";
import {renderSiteHeader,type SiteSection} from "./components/site-header.ts";
import {BRIEFING_STYLES} from "./styles.ts";

/** Only trusted component-rendered HTML enters content; metadata is escaped. */
export function renderPageShell(input:{title:string;brand:string;section?:SiteSection;date:string;dateLabel:string;generated:string;timezone:string;content:string;footerLink?:{label:string;href:string}}):string {
  if(input.footerLink&&new URL(input.footerLink.href).protocol!=="https:")throw new Error("Invalid footer link");
  const credit=input.footerLink?`<a class="page-footer__credit" href="${escapeHtml(input.footerLink.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(input.footerLink.label)}</a>`:"";
  return `<!doctype html>
<html lang="ru" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#fbfbf8">
  <title>${escapeHtml(input.title)} · Kurami</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <style>${BRIEFING_STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#main">К содержанию</a>
  ${renderSiteHeader({section:input.section??"daily",label:input.brand,date:input.date,dateLabel:input.dateLabel})}
  <main id="main" class="container">${input.content}</main>
  <footer class="page-footer container"><span>Kurami · ${escapeHtml(input.date)}</span>${credit}<span>Собрано в ${escapeHtml(input.generated)} · ${escapeHtml(input.timezone)}</span></footer>
  <dialog class="media-lightbox" data-media-dialog aria-label="Просмотр изображения"><button class="media-lightbox__close" type="button" data-media-close aria-label="Закрыть">×</button><img data-media-dialog-image alt=""></dialog>
</body>
</html>`;
}
