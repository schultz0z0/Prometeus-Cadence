import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const command=process.argv[2]??'status';
async function owner(){try{const value=JSON.parse(await readFile('.runtime/supervisor.json','utf8'));process.kill(value.pid,0);return value;}catch{return null;}}
if(command==='install'){
 if(process.platform!=='win32')throw Error('Use runtime:start with your service manager on this OS.');
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File','scripts/install-runtime.ps1','-NodePath',process.execPath,'-Workspace',root],{stdio:'inherit',windowsHide:true});
}else if(command==='start'||command==='ensure'){
 if(command==='ensure'){try{await readFile('.runtime/paused');process.exit(0);}catch{}}
 else await unlink('.runtime/paused').catch(()=>{});
 if(await owner())console.log('Continuous runtime already running.');
 else{
  await mkdir('.runtime',{recursive:true});
  const child=spawn(process.execPath,['--experimental-strip-types','scripts/runtime-supervisor.ts'],{cwd:root,detached:true,windowsHide:true,stdio:'ignore'});child.unref();
  let ready=false;for(let i=0;i<30;i++){await delay(200);if(await owner()){ready=true;break;}}
  if(!ready)throw Error('Runtime did not start. Check local environment and runtime frequency settings.');console.log('Continuous runtime started.');
 }
}else if(command==='stop'){
 await mkdir('.runtime',{recursive:true});await writeFile('.runtime/paused','paused');
 if(await owner()){await writeFile('.runtime/stop','stop');let stopped=false;for(let i=0;i<120;i++){await delay(500);if(!await owner()){stopped=true;break;}}if(!stopped)throw Error('Runtime is draining active work. Check runtime:status; no forced termination performed.');}
 console.log('Continuous runtime stopped.');
}else if(command==='status'){
 const supervisor=await owner();const services={};for(const name of ['dispatch','sync','jobs','scheduler'])try{const value=JSON.parse(await readFile('.runtime/'+name+'.json','utf8'));let alive=false;try{if(value.pid){process.kill(value.pid,0);alive=true;}}catch{}services[name]={...value,alive};}catch{services[name]={state:'not-started',alive:false};}
 console.log(JSON.stringify({running:!!supervisor,supervisor,services},null,2));
}else throw Error('Use start, stop, status or install.');
