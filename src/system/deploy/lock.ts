// Shared checkout-write fence for application releases and docs-only synchronization.
// Fail closed even for a stale/empty lock: reclaiming it can race a new owner.
import {mkdir,open,rm} from "node:fs/promises";
import {resolve} from "node:path";
export async function withDeployLock<T>(home:string,work:()=>Promise<T>):Promise<T> {
  const directory=resolve(home,"state/deploy"),lock=resolve(directory,"lock");
  await mkdir(directory,{recursive:true,mode:0o700});
  const handle=await open(lock,"wx",0o600).catch(()=>{throw new Error("Another release is running or the deploy lock needs operator inspection");});
  try {
    await handle.writeFile(String(process.pid));
    return await work();
  } finally {await handle.close();await rm(lock);}
}
