// Portable bundle for targets outside this repository (the UI-language skill's previews).
// Generated from the library; `npm run ui:export` rewrites it and tests fail if it drifts.
import {writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {THEME_CSS} from "./themes/index.ts";
import {FOUNDATION_CSS} from "./foundations/index.ts";
import {DIAGRAM_CSS} from "./foundations/diagram.ts";
import {BUTTON_CSS} from "./components/button.ts";
import {THEME_SWITCH_CSS} from "./components/theme-switch.ts";
import {TABLE_CSS} from "./components/table.ts";
import {CALLOUT_CSS} from "./components/callout.ts";
import {DISCLOSURE_CSS} from "./components/disclosure.ts";
import {FORM_CSS} from "./components/form.ts";
import {DIALOG_CSS} from "./components/dialog.ts";
import {PERIOD_SWITCH_CSS} from "./components/period-switch.ts";
import {ICON_CSS} from "./components/icon.ts";
import {STAT_CARD_CSS} from "./components/stat-card.ts";
import {PILL_CSS} from "./components/pill.ts";
import {POPOVER_CSS} from "./components/popover.ts";
import {SITE_HEADER_CSS} from "./patterns/site-header.ts";
import {CHART_STYLES} from "./components/charts/styles.ts";
import {THEME_RUNTIME_JS} from "./runtime/theme.ts";

export const exportDirectory=resolve(import.meta.dirname,"../../integrations/hermes/skills/kurami-ui-preview-language/assets");
const banner="Generated from src/ui-library by `npm run ui:export`. Do not edit; change the library instead.";

export function exportBundle():Record<"kurami-ui.css"|"kurami-theme.js",string> {
  // Fonts are copied beside the stylesheet as ./fonts/ by the consuming project.
  const css=[THEME_CSS,FOUNDATION_CSS.replaceAll('url("/assets/','url("fonts/'),BUTTON_CSS,THEME_SWITCH_CSS,SITE_HEADER_CSS,TABLE_CSS,CALLOUT_CSS,DISCLOSURE_CSS,FORM_CSS,DIALOG_CSS,PERIOD_SWITCH_CSS,ICON_CSS,STAT_CARD_CSS,POPOVER_CSS,PILL_CSS,CHART_STYLES,DIAGRAM_CSS].join("\n");
  return {"kurami-ui.css":`/* ${banner} */\n${css}`,"kurami-theme.js":`// ${banner}\n${THEME_RUNTIME_JS}`};
}

if(process.argv[1]===import.meta.filename&&process.argv.includes("--write")){
  for(const [file,content] of Object.entries(exportBundle()))writeFileSync(resolve(exportDirectory,file),content);
  console.log(JSON.stringify({written:Object.keys(exportBundle()),directory:exportDirectory}));
}
