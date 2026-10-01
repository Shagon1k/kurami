import {escapeHtml} from "./html.ts";
import {renderSiteHeader,type SiteSection} from "./components/site-header.ts";
import {BRIEFING_STYLES} from "./styles.ts";
import {renderDocument} from "../../ui-library/patterns/page-shell.ts";
import {digestLanguage,digestText} from "../i18n.ts";

/** Only trusted component-rendered HTML enters content; metadata is escaped. */
export function renderPageShell(input:{title:string;brand:string;section?:SiteSection;date:string;dateLabel:string;generated:string;timezone:string;content:string;footerLink?:{label:string;href:string}}):string {
  if(input.footerLink&&new URL(input.footerLink.href).protocol!=="https:")throw new Error("Invalid footer link");
  const credit=input.footerLink?`<a class="page-footer__credit" href="${escapeHtml(input.footerLink.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(input.footerLink.label)}</a>`:"";
  return renderDocument({
    lang:digestLanguage(),title:`${input.title} · Kurami`,favicon:"/favicon.svg",styles:{inline:BRIEFING_STYLES},themeScript:false,skipLabel:digestText("К содержанию","Skip to content"),
    header:renderSiteHeader({section:input.section??"daily",label:input.brand,date:input.date,dateLabel:input.dateLabel}),
    main:input.content,
    footer:`<footer class="page-footer container"><span>Kurami · ${escapeHtml(input.date)}</span>${credit}<span>${digestText("Собрано в","Compiled at")} ${escapeHtml(input.generated)} · ${escapeHtml(input.timezone)}</span></footer>`,
    after:`<dialog class="media-lightbox" data-media-dialog aria-label="${digestText("Просмотр изображения","Image preview")}"><button class="media-lightbox__close" type="button" data-media-close aria-label="${digestText("Закрыть","Close")}">×</button><img data-media-dialog-image alt=""></dialog>`,
  });
}
