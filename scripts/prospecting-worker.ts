import {setTimeout as delay} from 'node:timers/promises';
process.loadEnvFile('.env.local');
const {runWorkerOnce}=await import('../src/server/prospecting/worker.ts');
const {workerPool}=await import('../src/server/prospecting/worker-db.ts');
const {getPools}=await import('../src/server/db/pool.ts');
const {randomUUID}=await import('node:crypto');
const controller=new AbortController(),workerId=randomUUID();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
try{
  console.log('Prospecting worker ready; external execution follows server configuration.');
  do{
    await runWorkerOnce({},{workerId,signal:controller.signal});
    if(process.argv.includes('--once')||controller.signal.aborted)break;
    await delay(2000,undefined,{signal:controller.signal}).catch(()=>{});
  }while(!controller.signal.aborted);
}finally{await Promise.all([workerPool().end(),getPools().close()]);}
