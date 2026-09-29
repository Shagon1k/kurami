import {colorRoles,scaleRoles,type Theme,type ThemeMode} from "../tokens/index.ts";
import {kuramiTheme} from "./kurami.ts";

export {kuramiTheme};

function declarations(mode:ThemeMode):string {
  const missing=colorRoles.filter(role=>!mode.colors[role]?.trim());
  if(missing.length)throw new Error(`Theme mode is missing roles: ${missing.join(", ")}`);
  return [`color-scheme: ${mode.colorScheme};`,...colorRoles.map(role=>`--${role}: ${mode.colors[role]};`)].join(" ");
}

/** Light is the root mode; `html[data-theme="dark"]` switches every role at once. */
export function themeCss(theme:Theme=kuramiTheme):string {
  const missing=scaleRoles.filter(role=>!theme.scale[role]?.trim());
  if(missing.length)throw new Error(`Theme is missing scale roles: ${missing.join(", ")}`);
  const scale=scaleRoles.map(role=>`--${role}: ${theme.scale[role]};`).join(" ");
  return `:root { ${declarations(theme.light)} ${scale} }\nhtml[data-theme="dark"] { ${declarations(theme.dark)} }\n`;
}

export const THEME_CSS=themeCss();
