import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {parseWorkerOptions} from './prospecting-smoke-options.ts';
const options=parseWorkerOptions(process.argv.slice(2));process.loadEnvFile('.env.local');
const {runSchedulerOnce}=await import('../src/server/automations/scheduler.ts'),{workerPool}=await import('../src/server/prospecting/worker-db.ts'),{getPools}=await import('../src/server/db/pool.ts');
const controller=new AbortController(),workerId=randomUUID();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
try{
 console.log(process.env.AUTOMATIONS_SCHEDULER_ENABLED==='true'?'Automation scheduler ready.':'Automation scheduler disabled; no claims or mutations.');
 if(process.env.AUTOMATIONS_SCHEDULER_ENABLED==='true')do{await runSchedulerOnce({workerId,signal:controller.signal,workspaceId:options.workspaceId});if(options.once||controller.signal.aborted)break;await delay(2000,undefined,{signal:controller.signal}).catch(()=>{});}while(!controller.signal.aborted);
}finally{await Promise.all([workerPool().end(),getPools().close()]);}
