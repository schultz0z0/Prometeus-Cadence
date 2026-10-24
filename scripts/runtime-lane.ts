import {mkdir,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {runtimeConfig,runSerialLoop} from './runtime-core.ts';
process.loadEnvFile('.env.local');
const name=process.argv[2],config=runtimeConfig(process.env),controller=new AbortController(),workerId=randomUUID();
if(!['dispatch','sync','jobs','scheduler','channels'].includes(name))throw Error('Invalid runtime lane');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
process.on('message',message=>{if(message==='shutdown')controller.abort();});
process.on('disconnect',()=>controller.abort());
let state='starting',lastSuccess:string|null=null,failures=0;
await mkdir('.runtime',{recursive:true});
let reporting=Promise.resolve();
function report(){const payload=JSON.stringify({pid:process.pid,state,lastSuccess,failures,updatedAt:new Date().toISOString()});reporting=reporting.catch(()=>{}).then(async()=>{const path='.runtime/'+name+'.json';await writeFile(path+'.tmp',payload);await rename(path+'.tmp',path);});return reporting;}
let tick:()=>Promise<unknown>,intervalMs:number;
if(name==='dispatch'){
 const {runMessagingTick}=await import('../src/server/messaging/worker.ts');
 tick=()=>runMessagingTick({now:()=>new Date().toISOString(),maxMessages:config.messages,allowSync:false});intervalMs=config.dispatchMs;
}else if(name==='sync'){
 process.env.MAIL_SYNC_ENABLED='true';const {runMailSyncTick}=await import('../src/server/mail/sync/worker.ts');
 tick=()=>runMailSyncTick({now:new Date().toISOString(),maxMailboxes:config.syncBoxes,maxMessages:config.syncMessages,allowSync:true,signal:controller.signal}).then(result=>{if(result.failed)throw Error('Mailbox sync failed');return result;});intervalMs=config.syncMs;
}else if(name==='channels'){
 const {runOpenwaChannelTick}=await import('../src/server/channels/openwa/worker.ts');tick=()=>runOpenwaChannelTick({now:new Date().toISOString(),signal:controller.signal}).then(result=>{if(result.failed)throw Error('Channel maintenance failed');return result;});intervalMs=config.channelsMs;
}else if(name==='jobs'){
 const {runWorkerOnce}=await import('../src/server/prospecting/worker.ts');tick=()=>runWorkerOnce({},{workerId,signal:controller.signal});intervalMs=config.jobMs;
}else{
 process.env.AUTOMATIONS_SCHEDULER_ENABLED='true';const {runSchedulerOnce}=await import('../src/server/automations/scheduler.ts');tick=()=>runSchedulerOnce({workerId,signal:controller.signal});intervalMs=config.schedulerMs;
}
try{
 await report();
 await runSerialLoop(async()=>{state='running';await report();await tick();lastSuccess=new Date().toISOString();failures=0;state='waiting';await report();},{signal:controller.signal,intervalMs,onError:()=>{failures++;state='backoff';void report().catch(()=>{});}});
}finally{
 state='stopped';await report();
 const [{closeDispatchPool},{closeIngressPool}]=await Promise.all([import('../src/server/messaging/worker-db.ts'),import('../src/server/channels/ingress-db.ts')]);
 await Promise.allSettled([closeDispatchPool(),closeIngressPool()]);
 if(name==='jobs'||name==='scheduler'){const {workerPool}=await import('../src/server/prospecting/worker-db.ts');await workerPool().end();}
 process.disconnect?.();
}
