// Decodes the 8-bit, non-interlaced RGB/RGBA PNGs Chrome writes, enough to count changed pixels.
import {inflateSync} from "node:zlib";

export type Image={width:number;height:number;rgba:Uint8Array};

export function decodePng(png:Buffer):Image {
  if(png.readUInt32BE(0)!==0x89504e47)throw new Error("Not a PNG");
  let offset=8,width=0,height=0,channels=0;
  const chunks:Buffer[]=[];
  while(offset<png.length){
    const length=png.readUInt32BE(offset),type=png.toString("ascii",offset+4,offset+8),data=png.subarray(offset+8,offset+8+length);
    if(type==="IHDR"){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      if(data[8]!==8||data[12]!==0||(data[9]!==2&&data[9]!==6))throw new Error("Unsupported PNG format");
      channels=data[9]===6?4:3;
    }else if(type==="IDAT")chunks.push(data);
    else if(type==="IEND")break;
    offset+=12+length;
  }
  const raw=inflateSync(Buffer.concat(chunks)),stride=width*channels,rgba=new Uint8Array(width*height*4);
  let previous=new Uint8Array(stride);
  for(let y=0;y<height;y++){
    const filter=raw[y*(stride+1)],line=raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)),current=new Uint8Array(stride);
    for(let x=0;x<stride;x++){
      const left=x>=channels?current[x-channels]:0,up=previous[x],corner=x>=channels?previous[x-channels]:0;
      const predictor=filter===0?0:filter===1?left:filter===2?up:filter===3?(left+up)>>1:paeth(left,up,corner);
      current[x]=(line[x]+predictor)&255;
    }
    for(let x=0;x<width;x++)for(let c=0;c<4;c++)rgba[(y*width+x)*4+c]=c<channels?current[x*channels+c]:255;
    previous=current;
  }
  return {width,height,rgba};
}

function paeth(a:number,b:number,c:number):number {
  const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
  return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

/** Share of pixels that differ, or 1 when the page size changed. */
export function changedShare(a:Image,b:Image):number {
  if(a.width!==b.width||a.height!==b.height)return 1;
  let changed=0;
  for(let i=0;i<a.rgba.length;i+=4)if(a.rgba[i]!==b.rgba[i]||a.rgba[i+1]!==b.rgba[i+1]||a.rgba[i+2]!==b.rgba[i+2])changed++;
  return changed/(a.width*a.height);
}
