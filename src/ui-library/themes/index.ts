import {colorRoles,scaleRoles,type Theme,type ThemeMode,type ThemeVariant} from "../tokens/index.ts";
import {kuramiTheme} from "./kurami.ts";
import {neonTheme,NEON_CSS} from "./neon.ts";

/** Paper is the default theme; `kuramiTheme` stays as its historical export name. */
export const paperTheme=kuramiTheme;
export {kuramiTheme,neonTheme};
/** Themes a viewer can pick besides Paper. Each is applied with `html[data-kurami-theme="<name>"]`. */
export const themeVariants:readonly ThemeVariant[]=[neonTheme];

function declarations(mode:ThemeMode):string {
  const missing=colorRoles.filter(role=>!mode.colors[role]?.trim());
  if(missing.length)throw new Error(`Theme mode is missing roles: ${missing.join(", ")}`);
  return [`color-scheme: ${mode.colorScheme};`,...colorRoles.map(role=>`--${role}: ${mode.colors[role]};`)].join(" ");
}

function scaleDeclarations(scale:Record<string,string>):string {
  const missing=scaleRoles.filter(role=>!scale[role]?.trim());
  if(missing.length)throw new Error(`Theme is missing scale roles: ${missing.join(", ")}`);
  return scaleRoles.map(role=>`--${role}: ${scale[role]};`).join(" ");
}

/** Light is the root mode; `html[data-theme="dark"]` switches every role at once. */
export function themeCss(theme:Theme=kuramiTheme):string {
  return `:root { ${declarations(theme.light)} ${scaleDeclarations(theme.scale)} }\nhtml[data-theme="dark"] { ${declarations(theme.dark)} }\n`;
}

/**
 * A variant overrides every role under `html[data-kurami-theme]`, after Paper so it wins at equal specificity.
 * A dark-only variant ignores `data-theme`; the runtime also sets `data-theme="dark"` for it.
 */
export function variantCss(variant:ThemeVariant):string {
  const scale=scaleDeclarations(variant.scale);
  const light=variant.modes.light,dark=variant.modes.dark;
  if(!light&&!dark)throw new Error(`Theme variant ${variant.name} has no modes`);
  const selector=`html[data-kurami-theme="${variant.name}"]`;
  if(light&&dark)return `${selector} { ${declarations(light)} ${scale} }\n${selector}[data-theme="dark"] { ${declarations(dark)} }\n`;
  return `${selector} { ${declarations((light??dark)!)} ${scale} }\n`;
}

/** Paper tokens, then each variant's tokens and its scoped dressing for library parts. */
export const THEME_CSS=themeCss()+themeVariants.map(variantCss).join("")+NEON_CSS;
