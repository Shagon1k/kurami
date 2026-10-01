// Disposable supervisor fixture. It executes the real launcher and worker, never a terminal UI.
import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const args=process.argv.slice(2);
const root=process.env.PROTOCOL_SUPERVISOR_ROOT;
const marker=(name)=>resolve(root,name.replace(/^=/u,"")+".pid");
if(args[0]==="has-session") process.exit(existsSync(marker(args[args.indexOf("-t")+1])) ? 0 : 1);
if(args[0]==="list-sessions") { process.stdout.write(readdirSync(root).filter((name)=>name.endsWith(".pid")).map((name)=>name.slice(0,-4)).join("\n")+"\n"); process.exit(0); }
if(args[0]==="kill-session") { const path=marker(args[args.indexOf("-t")+1]); if(existsSync(path)) {process.kill(Number(readFileSync(path,"utf8")),"SIGTERM");unlinkSync(path);} process.exit(0); }
if(args[0]==="new-session") {
  // Match tmux -d: return after dispatch while a separate fixture process supervises exit.
  const supervisor=spawn(process.execPath,[import.meta.filename,"supervise",...args.slice(1)],
    {detached:true,stdio:"ignore",env:process.env});
  supervisor.unref();
  const path=marker(args[args.indexOf("-s")+1]);
  for(let attempt=0;attempt<100 && !existsSync(path);attempt++) await new Promise(done=>setTimeout(done,10));
  if(!existsSync(path)) throw new Error("Disposable supervisor did not acknowledge dispatch");
  process.exit(0);
}
if(args[0]!=="supervise") throw new Error("Protocol lifecycle must not capture screens or send terminal keys");
const environment={...process.env};
for(let i=0;i<args.length;i++) if(args[i]==="-e") {
  const entry=args[++i];const separator=entry.indexOf("=");environment[entry.slice(0,separator)]=entry.slice(separator+1);
}
const path=marker(args[args.indexOf("-s")+1]);
const output=openSync(resolve(root,"worker.log"),"a",0o600);
const child=spawn("bash",[args.at(-1)],{cwd:args[args.indexOf("-c")+1],env:environment,stdio:["ignore",output,output]});
writeFileSync(path,String(child.pid));
child.on("exit",()=>{if(existsSync(path)) unlinkSync(path);});
// This process deliberately remains the disposable supervisor while its worker lives.
