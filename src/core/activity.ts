import {appendFile,mkdir} from "node:fs/promises";
import {closeSync,existsSync,openSync,readSync,readdirSync,statSync} from "node:fs";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";

export type SystemActivity={id:string;at:string;source:string;subject:string;event:string};
export async function recordSystemActivity(home:string,source:string,subject:string,event:string):Promise<void> {
  const at=new Date().toISOString();const directory=resolve(home,"state/activity");
  await mkdir(directory,{recursive:true,mode:0o700});
  await appendFile(resolve(directory,at.slice(0,10)+".jsonl"),JSON.stringify({id:randomUUID(),at,source,subject:subject.slice(0,120),event})+"\n",{mode:0o600});
}
export function readSystemActivity(home:string,cutoff:string):SystemActivity[] {
  const directory=resolve(home,"state/activity");if(!existsSync(directory))return [];
  const result:SystemActivity[]=[];
  try {
    const files=readdirSync(directory).filter(name=>/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)&&name.slice(0,10)>=cutoff.slice(0,10)).sort().slice(-8);
    for(const name of files){
      const path=resolve(directory,name);const stat=statSync(path);let fd:number|undefined;
      try{
        const start=Math.max(0,stat.size-128*1024);const buffer=Buffer.alloc(stat.size-start);fd=openSync(path,"r");
        const length=readSync(fd,buffer,0,buffer.length,start);
        const lines=buffer.subarray(0,length).toString("utf8").split("\n");if(start)lines.shift();
        for(const line of lines){try{const item=JSON.parse(line);if(typeof item.id==="string"&&typeof item.at==="string"&&item.at>=cutoff&&[item.source,item.subject,item.event].every(value=>typeof value==="string"&&value.length<=160))result.push(item);}catch{}}
      }finally{if(fd!==undefined)closeSync(fd);}
    }
  }catch{return result;}
  return result.sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,20);
}
