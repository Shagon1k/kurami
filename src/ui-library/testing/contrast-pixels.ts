import type {Devtools} from "./devtools.ts";
import {decodePng} from "./png.ts";

type Review={id:string;element:string;text:string;foreground:number[];required:number;rectangles:Array<{x:number;y:number;width:number;height:number}>};
const luminance=(rgb:ArrayLike<number>)=>[0,1,2].map(index=>{const value=rgb[index]!/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index]!,0);

/** Conservative evidence for one rendered state, not a whole-page accessibility certificate.
 * Sample the actual background beneath each text rectangle with its ink temporarily hidden.
 * A low bound requires manual review: whitespace and neighbouring ink can lower it too.
 */
export async function checkImageBackedContrast(devtools:Devtools) {
  await devtools.evaluate(`Promise.all([...document.images].filter(image=>image.getAttribute('src')&&new URL(image.currentSrc||image.src,location.href).origin===location.origin).map(image=>{image.loading='eager';return image.decode().catch(()=>{});})).then(()=>true)`);
  const pending=await devtools.evaluate<Review[]>("window.__kuramiContrastReview ?? []"),results=[];
  for(const review of pending) {
    const selector=`[data-contrast-review="${review.id}"]`;
    const prior=await devtools.evaluate<string|null>(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;const previous=element.getAttribute('style');element.style.setProperty('color','transparent','important');element.style.setProperty('text-shadow','none','important');element.style.setProperty('text-decoration-color','transparent','important');return previous;})()`);
    let minimum=Infinity;
    try {
      const foreground=luminance(review.foreground);
      for(const rectangle of review.rectangles) {
        const clip={x:Math.max(0,Math.floor(rectangle.x)),y:Math.max(0,Math.floor(rectangle.y)),width:Math.ceil(rectangle.width),height:Math.ceil(rectangle.height),scale:1};
        const screenshot=await devtools.call<{data:string}>("Page.captureScreenshot",{format:"png",captureBeyondViewport:true,clip});
        const image=decodePng(Buffer.from(screenshot.data,"base64"));
        for(let offset=0;offset<image.rgba.length;offset+=4) {
          const background=luminance(image.rgba.subarray(offset,offset+3));
          minimum=Math.min(minimum,(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05));
        }
      }
    } finally {
      await devtools.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(element){const prior=${JSON.stringify(prior)};if(prior===null)element.removeAttribute('style');else element.setAttribute('style',prior);}})()`);
    }
    results.push({element:review.element,text:review.text,required:review.required,minimum:Number.isFinite(minimum)?Number(minimum.toFixed(3)):null,status:minimum>=review.required&&Number.isFinite(minimum)?"pixel-bound-passed":"manual-review-required"});
  }
  return results;
}
