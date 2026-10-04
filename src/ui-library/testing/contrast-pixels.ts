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
    const scroll=await devtools.evaluate<{x:number;y:number}>('({x:scrollX,y:scrollY})');
    const prior=await devtools.evaluate<string|null>(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;const previous=element.getAttribute('style');element.style.setProperty('color','transparent','important');element.style.setProperty('text-shadow','none','important');element.style.setProperty('text-decoration-color','transparent','important');return previous;})()`);
    let minimum=Infinity;
    try {
      const foreground=luminance(review.foreground);
      for(const rectangle of review.rectangles) {
        // Read covered content above the floating dock, as a user would by scrolling.
        const moved=await devtools.evaluate<boolean>(`(async()=>{const element=document.querySelector(${JSON.stringify(selector)}),dock=document.querySelector('.mobile-navigation__bar');if(!element||!dock||dock.contains(element))return false;const s=getComputedStyle(dock),r=dock.getBoundingClientRect(),text=${JSON.stringify(rectangle)},top=text.y-scrollY;if(s.visibility!=='hidden'&&s.display!=='none'&&top<r.bottom&&top+text.height>r.top&&text.x<r.right&&text.x+text.width>r.left){scrollTo({left:scrollX,top:Math.max(0,text.y-innerHeight/3),behavior:'instant'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;}return false;})()`);
        const clip={x:Math.max(0,Math.floor(rectangle.x)),y:Math.max(0,Math.floor(rectangle.y)),width:Math.ceil(rectangle.width),height:Math.ceil(rectangle.height),scale:1};
        const viewport=moved?await devtools.evaluate<{x:number;y:number}>('({x:scrollX,y:scrollY})'):null;
        const screenshot=await devtools.call<{data:string}>("Page.captureScreenshot",moved?{format:"png",captureBeyondViewport:false}:{format:"png",captureBeyondViewport:true,clip});
        const image=decodePng(Buffer.from(screenshot.data,"base64"));
        const left=viewport?Math.floor(rectangle.x-viewport.x):0,top=viewport?Math.floor(rectangle.y-viewport.y):0;
        const width=viewport?clip.width:image.width,height=viewport?clip.height:image.height;
        if(left<0||top<0||left+width>image.width||top+height>image.height){minimum=0;continue;}
        for(let y=top;y<top+height;y++)for(let x=left;x<left+width;x++) {
          const offset=(y*image.width+x)*4;
          const background=luminance(image.rgba.subarray(offset,offset+3));
          minimum=Math.min(minimum,(Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05));
        }
      }
    } finally {
      await devtools.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(element){const prior=${JSON.stringify(prior)};if(prior===null)element.removeAttribute('style');else element.setAttribute('style',prior);}})()`);
      await devtools.evaluate(`scrollTo({left:${scroll.x},top:${scroll.y},behavior:'instant'})`);
    }
    results.push({element:review.element,text:review.text,required:review.required,minimum:Number.isFinite(minimum)?Number(minimum.toFixed(3)):null,status:minimum>=review.required&&Number.isFinite(minimum)?"pixel-bound-passed":"manual-review-required"});
  }
  return results;
}
