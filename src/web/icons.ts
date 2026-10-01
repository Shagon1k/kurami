/** Versioned PWA exports; native headers and favicons retain their existing assets. */
export const PWA_ICON_ASSETS=[
  {src:"/assets/kurami-fox-any-512-v2.png",file:"kurami-fox-any-512-v2.png",size:512,purpose:"any"},
  {src:"/assets/kurami-fox-any-1024-v2.png",file:"kurami-fox-any-1024-v2.png",size:1024,purpose:"any"},
  {src:"/assets/kurami-fox-maskable-512-v2.png",file:"kurami-fox-maskable-512-v2.png",size:512,purpose:"maskable"},
  {src:"/assets/kurami-fox-maskable-1024-v2.png",file:"kurami-fox-maskable-1024-v2.png",size:1024,purpose:"maskable"},
] as const;

export const PWA_MANIFEST_ICONS=PWA_ICON_ASSETS.map(({src,size,purpose})=>({src,type:"image/png",sizes:`${size}x${size}`,purpose}));
