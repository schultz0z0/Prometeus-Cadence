import {setTimeout as delay} from 'node:timers/promises';
import {parseMailSyncOptions,mailSyncEnabled} from './mail-sync-options.ts';
process.loadEnvFile('.env.local');
const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
try{
 const options=parseMailSyncOptions(process.argv.slice(2));
 if(!mailSyncEnabled(process.env,options)){console.log('Mail sync disabled. No claims or provider calls.');}
 else{const {runMailSyncTick}=await import('../src/server/mail/sync/worker.ts');do{console.log(JSON.stringify(await runMailSyncTick({...options,now:new Date().toISOString(),signal:controller.signal})));if(options.once||controller.signal.aborted)break;await delay(60000,undefined,{signal:controller.signal}).catch(()=>{});}while(!controller.signal.aborted);}
}catch{console.error('Mail sync stopped. Check scope, budgets and server configuration.');process.exitCode=1;}
finally{const [{closeDispatchPool},{getPools}]=await Promise.all([import('../src/server/messaging/worker-db.ts'),import('../src/server/db/pool.ts')]);await Promise.allSettled([closeDispatchPool(),getPools().close()]);}
