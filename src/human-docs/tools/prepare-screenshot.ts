// Crop an owner-supplied screenshot, paint over private areas and write src/human-docs/assets/shot-<name>.png.
// Usage: node src/human-docs/tools/prepare-screenshot.ts <input.png> <name> [--crop=x,y,w,h] [--redact=x,y,w,h ...] [--scale=0.5]
// Originals stay outside Git; review the output before committing it.
import {readFileSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {findBrowser,launchBrowser} from "../../ui-library/testing/devtools.ts";

const [input,name,...options]=process.argv.slice(2);
if(!input||!name||!/^[a-z0-9-]+$/.test(name))throw new Error("Usage: prepare-screenshot.ts <input.png> <name> [--crop=x,y,w,h] [--redact=x,y,w,h ...] [--scale=n]");
const rect=(value:string)=>{const parts=value.split(",").map(Number);if(parts.length!==4||parts.some(n=>!Number.isFinite(n)||n<0))throw new Error(`Invalid rectangle ${value}`);return parts;};
const crop=options.find(option=>option.startsWith("--crop="))?.slice(7);
const redactions=options.filter(option=>option.startsWith("--redact=")).map(option=>rect(option.slice(9)));
const scale=Number(options.find(option=>option.startsWith("--scale="))?.slice(8)??"1");
const source=`data:image/png;base64,${readFileSync(resolve(input)).toString("base64")}`;
const {devtools,close}=await launchBrowser(findBrowser());
try{
  const data=await devtools.evaluate<string>(`new Promise((done,fail)=>{const image=new Image();image.onload=()=>{
    const [x,y,w,h]=${JSON.stringify(crop?rect(crop):null)}??[0,0,image.width,image.height];
    const canvas=document.createElement("canvas");canvas.width=Math.round(w*${scale});canvas.height=Math.round(h*${scale});
    const context=canvas.getContext("2d");context.imageSmoothingQuality="high";
    context.drawImage(image,x,y,w,h,0,0,canvas.width,canvas.height);
    context.fillStyle="#8a8a86";
    for(const [rx,ry,rw,rh] of ${JSON.stringify(redactions)})context.fillRect((rx-x)*${scale},(ry-y)*${scale},rw*${scale},rh*${scale});
    done(canvas.toDataURL("image/png").split(",")[1]);};image.onerror=()=>fail(new Error("Unreadable image"));image.src=${JSON.stringify(source)};})`);
  const output=resolve(import.meta.dirname,"../assets",`shot-${name}.png`);
  writeFileSync(output,Buffer.from(data,"base64"));
  console.log(JSON.stringify({output}));
}finally{await close();}
