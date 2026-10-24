import {spawn,type ChildProcess} from 'node:child_process';
import {mkdir,open,readFile,unlink,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {runtimeConfig} from './runtime-core.ts';
process.chdir(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
process.loadEnvFile('.env.local');runtimeConfig(process.env);
await mkdir('.runtime',{recursive:true});
const lock='.runtime/supervisor.json';
try{const file=await open(lock,'wx');await file.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await file.close();}
catch{const owner=JSON.parse(await readFile(lock,'utf8'));try{process.kill(owner.pid,0);process.exit(0);}catch{await unlink(lock);const file=await open(lock,'wx');await file.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));await file.close();}}
await unlink('.runtime/stop').catch(()=>{});
const children=new Map<string,ChildProcess>(),controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
async function supervise(name:string){
 let crashes=0;
 while(!controller.signal.aborted){
  const started=Date.now(),child=spawn(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/runtime-lane.ts',name],{windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});children.set(name,child);
  await new Promise<void>(resolve=>{child.once('error',()=>resolve());child.once('exit',()=>resolve());});children.delete(name);
  if(controller.signal.aborted)break;
  crashes=Date.now()-started>60000?0:Math.min(crashes+1,6);
  await writeFile('.runtime/'+name+'.json',JSON.stringify({pid:null,state:'restarting',updatedAt:new Date().toISOString()}));
  await delay(Math.min(60000,1000*2**crashes),undefined,{signal:controller.signal}).catch(()=>{});
 }
}
const monitor=setInterval(()=>{void readFile('.runtime/stop').then(()=>controller.abort()).catch(()=>{});},500);
controller.signal.addEventListener('abort',()=>{for(const child of children.values())if(child.connected)child.send('shutdown');});
try{await Promise.all(['dispatch','sync','jobs','scheduler','channels'].map(supervise));}
finally{clearInterval(monitor);await unlink(lock).catch(()=>{});await unlink('.runtime/stop').catch(()=>{});}
