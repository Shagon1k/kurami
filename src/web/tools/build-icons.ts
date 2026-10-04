import assert from "node:assert/strict";
import {mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {findBrowser,launchBrowser} from "../../ui-library/testing/devtools.ts";
import {kuramiTheme} from "../../ui-library/themes/kurami.ts";
import {PWA_BACKGROUND,PWA_ICON_ASSETS} from "../icons.ts";

// Rasterize vector paths at each final size; never resize a raster master.
const root=resolve(import.meta.dirname,"../../..");
const brand=resolve(root,"src/ui-library/assets/brand");
const master=readFileSync(resolve(brand,"kurami-fox-pwa-master-v3.svg"),'utf8');
assert.match(master,/viewBox="0 0 1000 1000"/);
assert(!/<(?:image|filter|foreignObject|script)\b|\bhref=/i.test(master),'PWA source must contain self-contained vector geometry');
const geometry=master.replace(/^[\s\S]*?<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const browser=await launchBrowser(findBrowser(process.argv[2]));
try {
  const exports=await browser.devtools.evaluate<Array<{file:string;png:string;size:number;purpose:string;coverage:number}>>(`(async()=>{
    const image=new Image();image.src=${JSON.stringify("data:image/svg+xml;base64,"+Buffer.from(master).toString("base64"))};await image.decode();
    if(image.naturalWidth!==1000||image.naturalHeight!==1000)throw new Error('Unexpected vector coordinate system');
    const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;
    const sourceContext=source.getContext('2d');sourceContext.drawImage(image,0,0);
    const pixels=sourceContext.getImageData(0,0,source.width,source.height).data;
    let left=source.width,top=source.height,right=-1,bottom=-1;
    // Measure the visible contour; include faint antialiasing in the safe radius below.
    for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(pixels[(y*source.width+x)*4+3]>8){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(right<left)throw new Error('Empty master');
    const width=right-left+1,height=bottom-top+1,cx=(left+right)/2,cy=(top+bottom)/2;
    let radius=0;
    for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(pixels[(y*source.width+x)*4+3]>0)radius=Math.max(radius,Math.hypot(x-cx,y-cy)+1);
    const results=[];
    for(const asset of ${JSON.stringify(PWA_ICON_ASSETS)}){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=asset.size;
      const context=canvas.getContext('2d');
      const maskable=asset.purpose==='maskable';
      // Android's guaranteed safe zone is a circle of radius 40%, not an 80% square.
      const scale=maskable?asset.size*0.395/radius:asset.size*0.92/Math.max(width,height);
      const x=asset.size/2-cx*scale,y=asset.size/2-cy*scale;
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+asset.size+'" height="'+asset.size+'" viewBox="0 0 '+asset.size+' '+asset.size+'"><rect width="100%" height="100%" fill="'+${JSON.stringify(PWA_BACKGROUND)}+'"/><g transform="translate('+x+' '+y+') scale('+scale+')">'+${JSON.stringify(geometry)}+'</g></svg>';
      const exported=new Image();exported.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await exported.decode();
      context.drawImage(exported,0,0);
      results.push({file:asset.file,png:canvas.toDataURL('image/png').split(',')[1],size:asset.size,purpose:asset.purpose,coverage:Math.max(width,height)*scale/asset.size});
    }
    return results;
  })()`);
  assert.equal(exports.length,PWA_ICON_ASSETS.length);
  for(const asset of exports){
    assert(PWA_ICON_ASSETS.some(value=>value.file===asset.file));
    writeFileSync(resolve(brand,asset.file),Buffer.from(asset.png,"base64"));
    console.log(`${asset.file}: ${asset.size}px, ${asset.purpose}, mark ${(asset.coverage*100).toFixed(1)}%`);
  }
  const preview=resolve(root,"dist/pwa-icons");mkdirSync(preview,{recursive:true});
  const fileData=(file:string)=>"data:image/png;base64,"+readFileSync(resolve(brand,file)).toString("base64");
  const reference="data:image/webp;base64,"+readFileSync(resolve(brand,"kurami-fox-header.webp")).toString("base64");
  await browser.devtools.call("Emulation.setDeviceMetricsOverride",{width:960,height:540,deviceScaleFactor:1,mobile:false});
  await browser.devtools.evaluate(`document.body.innerHTML=${JSON.stringify(`<style>body{margin:0;padding:32px;background:${kuramiTheme.light.colors["surface-page"]};color:${kuramiTheme.light.colors["text-primary"]};font:16px system-ui}h1{font-size:24px}.row{display:flex;gap:32px;align-items:center}.reference{width:144px;height:144px;object-fit:contain}.mark{width:320px;height:320px;object-fit:contain}.launcher{width:144px;height:144px;overflow:hidden}.launcher img{width:100%;height:100%}.round{border-radius:50%}.square{border-radius:28%}figure{margin:24px 0}figcaption{margin-top:12px}</style><h1>Kurami · PWA icon preview</h1><div class="row"><figure><img class="reference" src="${reference}" alt="Existing header fox"><figcaption>Лого из хедера</figcaption></figure><figure><img class="mark" src="${fileData("kurami-fox-any-1024-v3.png")}" alt="Warm paper splash mark"><figcaption>PWA · 1024px</figcaption></figure><figure><div class="launcher round"><img src="${fileData("kurami-fox-maskable-1024-v3.png")}" alt="Circular mask"></div><figcaption>Круглая иконка</figcaption></figure><figure><div class="launcher square"><img src="${fileData("kurami-fox-maskable-1024-v3.png")}" alt="Rounded square mask"></div><figcaption>Квадратная иконка</figcaption></figure></div><p>Preview of supplied assets, not a capture of an Android launcher.</p>`)};Promise.all([...document.images].map(image=>image.decode()))`);
  const shot=await browser.devtools.call<{data:string}>("Page.captureScreenshot",{format:"png"});
  writeFileSync(resolve(preview,"preview.png"),Buffer.from(shot.data,"base64"));
}finally {await browser.close();}
