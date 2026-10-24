import {setTimeout as delay} from 'node:timers/promises';
export function runtimeConfig(env:Record<string,string|undefined>){
 const integer=(key:string,fallback:number,min:number,max:number)=>{const value=Number(env[key]??fallback);if(!Number.isInteger(value)||value<min||value>max)throw Error('Invalid '+key);return value;};
 return {billingMs:integer('RUNTIME_BILLING_MS',5000,5000,60000),billingBatch:integer('RUNTIME_BILLING_BATCH',5,1,10),channelsMs:integer('RUNTIME_CHANNELS_MS',5000,1000,60000),dispatchMs:integer('RUNTIME_DISPATCH_MS',2000,1000,60000),syncMs:integer('RUNTIME_SYNC_MS',5000,1000,60000),jobMs:integer('RUNTIME_JOB_MS',2000,1000,60000),schedulerMs:integer('RUNTIME_SCHEDULER_MS',2000,1000,60000),messages:integer('RUNTIME_DISPATCH_MESSAGES',5,1,20),syncBoxes:integer('RUNTIME_SYNC_BOXES',5,1,10),syncMessages:integer('RUNTIME_SYNC_MESSAGES',20,1,100)};
}
export async function runSerialLoop(tick:()=>Promise<unknown>,options:{signal:AbortSignal;intervalMs:number;random?:()=>number;sleep?:(ms:number)=>Promise<void>;onError?:()=>void;onSuccess?:()=>void}){
 let failures=0;const random=options.random??Math.random;
 while(!options.signal.aborted){
  try{await tick();failures=0;options.onSuccess?.();}catch{failures=Math.min(failures+1,6);options.onError?.();}
  if(options.signal.aborted)break;
  const ms=Math.min(60000,options.intervalMs*2**failures)+Math.floor(random()*options.intervalMs*.1);
  await (options.sleep??(ms=>delay(ms,undefined,{signal:options.signal}).catch(()=>{})))(ms);
 }
}
