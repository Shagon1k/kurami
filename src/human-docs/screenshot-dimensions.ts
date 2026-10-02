import {readFileSync} from "node:fs";
import {resolve} from "node:path";

export function screenshotDimensions(file:string,root=resolve(import.meta.dirname,"../..")):{width:number;height:number} {
  if(!/^shot-[a-z0-9-]+\.png$/.test(file))throw new Error(`Invalid screenshot file ${file}`);
  const data=readFileSync(resolve(root,"src/human-docs/assets",file));
  if(data.length<33||data.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||data.readUInt32BE(8)!==13||data.toString("ascii",12,16)!=="IHDR")throw new Error(`Invalid screenshot PNG ${file}`);
  const width=data.readUInt32BE(16),height=data.readUInt32BE(20);
  if(!width||!height||width>10000||height>10000)throw new Error(`Invalid screenshot dimensions ${file}`);
  return {width,height};
}
