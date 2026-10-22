import {setTimeout as delay} from 'node:timers/promises';
import {parseMessagingOptions} from './messaging-options.ts';
process.loadEnvFile('.env.local');
const controller=new AbortController();for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>controller.abort());
try{
 const options=parseMessagingOptions(process.argv.slice(2));
 if(process.env.MESSAGING_WORKER_ENABLED!=='true'||!options.allowDispatch){console.log('Messaging worker disabled. No claims, provider calls or sends.');}
 else {
  const {runMessagingTick}=await import('../src/server/messaging/worker.ts');
  console.log('Messaging worker enabled for the explicitly selected scope.');
  do{const result=await runMessagingTick({now:()=>new Date().toISOString(),maxMessages:options.maxMessages,allowSync:options.allowSync,...(options.workspaceId?{workspaceId:options.workspaceId}:{}),...(options.messageId?{messageId:options.messageId}:{})});console.log(JSON.stringify(result));if(options.once||controller.signal.aborted)break;await delay(2000,undefined,{signal:controller.signal}).catch(()=>{});}while(!controller.signal.aborted);
 }
}catch{console.error('Messaging worker stopped. Check database availability, options and server configuration. No automatic replay was initiated.');process.exitCode=1;}
finally{
 const [{closeIngressPool},{closeDispatchPool},{getPools}]=await Promise.all([import('../src/server/channels/ingress-db.ts'),import('../src/server/messaging/worker-db.ts'),import('../src/server/db/pool.ts')]);
 await Promise.allSettled([closeIngressPool(),closeDispatchPool(),getPools().close()]);
}
