import {escapeHtml} from "./html.ts";
import {renderSiteHeader,type SiteSection} from "./components/site-header.ts";
import {BRIEFING_STYLES} from "./styles.ts";
import {renderDocument} from "../../ui-library/patterns/page-shell.ts";
import {renderSiteFooter} from "../../ui-library/patterns/site-footer.ts";
import {digestLanguage,digestText} from "../i18n.ts";
import {renderButton} from "../../ui-library/components/button.ts";
import {iconPath} from "../../ui-library/components/icon.ts";
import {formatSiteDate} from "../../ui-library/foundations/date.ts";

export function renderMediaClose():string {
  return renderButton({label:digestText("Закрыть","Close"),variant:"icon",iconPath:iconPath("close"),className:"media-lightbox__close",attributes:{"data-media-close":true}});
}

/** Only trusted component-rendered HTML enters content; metadata is escaped. */
export function renderPageShell(input:{title:string;brand:string;section?:SiteSection;date:string;dateLabel:string;generated:string;updatedAt?:string;timezone:string;content:string;footerLink?:{label:string;href:string}}):string {
  if(input.footerLink&&new URL(input.footerLink.href).protocol!=="https:")throw new Error("Invalid footer link");
  return renderDocument({
    lang:digestLanguage(),title:`${input.title} · Kurami`,favicon:"/favicon.svg",styles:{inline:BRIEFING_STYLES},themeScript:false,skipLabel:digestText("К содержанию","Skip to content"),
    header:renderSiteHeader({section:input.section??"daily",label:input.brand,date:input.date,dateLabel:input.dateLabel}),
    main:input.content.replace(/<h1>/g,'<h1 class="page-title">').replace(/class="hero__eyebrow"/g,'class="hero__eyebrow page-eyebrow"').replace(/class="hero__subtitle"/g,'class="hero__subtitle page-subtitle"'),
    footer:renderSiteFooter({lang:digestLanguage(),app:"Digest",updated:input.updatedAt?formatSiteDate(input.updatedAt,digestLanguage(),true):undefined,credit:input.footerLink}),
    after:`<dialog class="media-lightbox" data-media-dialog aria-label="${digestText("Просмотр изображения","Image preview")}">${renderMediaClose()}<img data-media-dialog-image alt=""></dialog>`,
  });
}
