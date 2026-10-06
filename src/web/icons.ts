import {kuramiTheme} from '../ui-library/themes/kurami.ts';
import {neonTheme} from '../ui-library/themes/neon.ts';

/** One warm paper plate for the native splash and every launcher export. */
export const PWA_BACKGROUND=kuramiTheme.light.colors['surface-section'];
/** Versioned PWA exports; native headers and favicons retain their existing assets. */
export const PWA_ICON_ASSETS=[
  {src:"/assets/kurami-fox-any-512-v3.png",file:"kurami-fox-any-512-v3.png",size:512,purpose:"any"},
  {src:"/assets/kurami-fox-any-1024-v3.png",file:"kurami-fox-any-1024-v3.png",size:1024,purpose:"any"},
  {src:"/assets/kurami-fox-maskable-512-v3.png",file:"kurami-fox-maskable-512-v3.png",size:512,purpose:"maskable"},
  {src:"/assets/kurami-fox-maskable-1024-v3.png",file:"kurami-fox-maskable-1024-v3.png",size:1024,purpose:"maskable"},
] as const;

export const PWA_MANIFEST_ICONS=PWA_ICON_ASSETS.map(({src,size,purpose})=>({src,type:"image/png",sizes:`${size}x${size}`,purpose}));
/** Neon installs: the fox as neon tubes on the dark Neon ground (also for Neon light: the tubes need the dark). */
export const PWA_NEON_BACKGROUND=neonTheme.modes.dark!.colors['surface-page'];
export const PWA_NEON_ICON_ASSETS=[
  {src:"/assets/kurami-fox-neon-any-512.png",file:"kurami-fox-neon-any-512.png",size:512,purpose:"any"},
  {src:"/assets/kurami-fox-neon-any-1024.png",file:"kurami-fox-neon-any-1024.png",size:1024,purpose:"any"},
  {src:"/assets/kurami-fox-neon-maskable-512.png",file:"kurami-fox-neon-maskable-512.png",size:512,purpose:"maskable"},
  {src:"/assets/kurami-fox-neon-maskable-1024.png",file:"kurami-fox-neon-maskable-1024.png",size:1024,purpose:"maskable"},
] as const;
export const PWA_NEON_MANIFEST_ICONS=PWA_NEON_ICON_ASSETS.map(({src,size,purpose})=>({src,type:"image/png",sizes:`${size}x${size}`,purpose}));

/** The installed app follows the Hub default theme: icon set, splash and system bar colours. */
export function pwaAppearance(appearance:string|null):{icons:typeof PWA_MANIFEST_ICONS|typeof PWA_NEON_MANIFEST_ICONS;background:string;themeColor:string} {
  const [theme,mode]=(appearance??"").split(".");
  if(theme!=="neon")return {icons:PWA_MANIFEST_ICONS,background:PWA_BACKGROUND,themeColor:PWA_BACKGROUND};
  const surface=neonTheme.modes[mode==="light"?"light":"dark"]!.colors['surface-page'];
  return {icons:PWA_NEON_MANIFEST_ICONS,background:surface,themeColor:surface};
}
// Installed WebAPKs may request their previous manifest URLs while updating.
export const PWA_LEGACY_ICON_ASSETS=PWA_ICON_ASSETS.map(asset=>({...asset,src:asset.src.replace('-v3.','-v2.'),file:asset.file.replace('-v3.','-v2.')}));
