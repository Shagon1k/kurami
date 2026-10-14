import {formatSiteDate} from "../ui-library/foundations/date.ts";
import {escapeHtml} from "../ui-library/foundations/html.ts";
import {renderDocument} from "../ui-library/patterns/page-shell.ts";
import {renderSiteHeader} from "../ui-library/patterns/site-header.ts";
import {renderSiteFooter} from "../ui-library/patterns/site-footer.ts";
import {kuramiSites,kuramiEntryHref} from "../ui-library/patterns/kurami-sites.ts";
import {renderThemeSwitch} from "../ui-library/components/theme-switch.ts";
import {renderButton,renderLinkButton} from "../ui-library/components/button.ts";
import {renderTable} from "../ui-library/components/table.ts";
import {renderDisclosure} from "../ui-library/components/disclosure.ts";
import {surfaceAttributes} from "../ui-library/components/surface.ts";
import {HUB_CSS_URL,HUB_CLIENT_URL} from "./assets.ts";
import {resourceAuditPending,type ResourceAudit} from "../system/maintenance/resource-audit.ts";

export function renderResourceAuditPage(audit:ResourceAudit|null,home:string,lang:"ru"|"en",token:string):string {
  const t=(ru:string,en:string)=>lang==="ru"?ru:en;
  const gib=(bytes:number)=>`${(bytes/1024**3).toLocaleString(lang,{maximumFractionDigits:2})} ${t("ГиБ","GiB")}`;
  const paragraphs=(text:string)=>text.split(/\n\s*\n/).map(p=>`<p class="resource-audit__text">${escapeHtml(p)}</p>`).join("");
  const title=t("Аудит ресурсов сервера","Server resource audit");
  const decisions=new Map(audit?.decisions.map(row=>[row.id,row])??[]);
  const body=audit?`<p>${escapeHtml(formatSiteDate(audit.checkedAt,lang,true))}</p>${paragraphs(audit.summary[lang])}
    <section class="hub-panel"${surfaceAttributes("panel")}><h2>${t("Диск и ОЗУ","Disk and RAM")}</h2>${renderTable({columns:[t("Ресурс","Resource"),t("Занято","Used"),t("Доступно","Available")],rows:[[t("Диск","Disk"),`${gib(audit.disk.usedBytes)} · ${audit.disk.usedPercent}%`,gib(audit.disk.availableBytes)],[t("ОЗУ","RAM"),gib(audit.memory.usedBytes),gib(audit.memory.MemAvailable)]],stack:true})}</section>
    <section class="hub-panel"${surfaceAttributes("panel")}><h2>${t("Выводы агента","Agent findings")}</h2>${paragraphs(audit.analysis[lang])}</section>
    <section class="hub-panel"${surfaceAttributes("panel")}><h2>${t("Кандидаты на очистку","Cleanup candidates")}</h2><p>${t("Ничего не удалено. Размеры могут пересекаться; их сумма не равна освобождаемому месту.","Nothing was deleted. Sizes can overlap; their sum is not the space cleanup would free.")}</p>${renderTable({columns:[t("Каталог","Directory"),t("Размер","Size"),t("Рекомендация","Recommendation")],rows:audit.candidates.map(c=>[c.path,gib(c.bytes),c.protected?t("Сохранить: используется или требует проверки","Keep: in use or needs verification"):decisions.get(c.id)?.[lang]??t("Требуется проверка перед удалением","Verify before deleting")]),stack:true})}</section>
    ${renderDisclosure({summary:t("Размеры каталогов и ограничения аудита","Directory sizes and audit limitations"),body:renderTable({columns:[t("Каталог","Directory"),t("Размер","Size")],rows:audit.locations.map(x=>[x.path,gib(x.bytes)]),stack:true})+paragraphs(audit.limitations.map(x=>x[lang]).join("\n\n"))})}
    ${renderDisclosure({summary:t("ОЗУ по процессам и расположение баз","Process memory and database locations"),body:`<p>${t("Учтены только доступные PSS-данные процессов. Базы и тома сохраняются.","Only accessible process PSS is included. Databases and volumes are preserved.")}</p>`+renderTable({columns:[t("Процесс","Process"),"PSS"],rows:audit.memory.processGroups.map(x=>[`${x.name} · ${x.processes}`,gib(x.pssBytes)]),stack:true})+paragraphs(audit.databaseMounts.join("\n"))})}
    <div class="control-actions">${resourceAuditPending(home,audit)?renderButton({label:t("Отметить рассмотренным","Mark as reviewed"),variant:"subtle",attributes:{"data-resource-audit-ack":audit.id}}):`<p>${t("Аудит рассмотрен","Audit reviewed")}</p>`}${renderLinkButton({label:t("Вернуться в Hub","Back to Hub"),href:kuramiEntryHref("hub",lang),variant:"quiet"})}</div><p id="resource-audit-result" role="status"></p>`:`<p>${t("Первый аудит ещё не выполнен.","The first audit has not run yet.")}</p>`;
  return renderDocument({lang,title,favicon:"/assets/favicon.svg",styles:{href:HUB_CSS_URL},themeScript:true,skipLabel:t("К содержимому","Skip to content"),
    head:`<meta name="hub-control-token" content="${escapeHtml(token)}"><script src="${escapeHtml(HUB_CLIENT_URL)}" defer></script>`,
    header:renderSiteHeader({mobile:{app:"hub",lang},brand:{href:kuramiEntryHref("hub",lang),ariaLabel:"Kurami Hub",foxSrc:"/assets/fox.webp",suffix:"Hub"},nav:{label:"Hub",links:[{href:kuramiEntryHref("hub",lang),label:"Hub"}]},sites:kuramiSites("hub",lang),actions:renderLinkButton({label:lang==="ru"?"EN":"RU",href:`/${lang==="ru"?"en":"ru"}/resource-audit`,variant:"quiet",size:"compact"})+renderThemeSwitch(lang)}),
    mainClass:"hub resource-audit",main:`<h1>${title}</h1><p>${t("Аудит только предлагает очистку. Отметка «Рассмотрено» убирает уведомление и не разрешает удаление.","The audit only proposes cleanup. Marking it reviewed clears the notice and does not authorize deletion.")}</p>${body}`,footer:renderSiteFooter({lang,app:"Hub"})});
}
