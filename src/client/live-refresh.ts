export interface PollingEnvironment {available():boolean;now():number;random():number;subscribe(wake:()=>void):()=>void;schedule(fn:()=>void,ms:number):()=>void}
export function startPolling(run:(signal:AbortSignal)=>Promise<unknown>,options:{intervalMs:number;environment:PollingEnvironment}){
 const {intervalMs,environment:e}=options;if(!Number.isFinite(intervalMs)||intervalMs<1000)throw Error('Invalid refresh interval');
 const controller=new AbortController();let running=false,failures=0,due=e.now()+intervalMs,cancel=()=>{};
 function schedule(){cancel();if(!controller.signal.aborted)cancel=e.schedule(()=>{void tick();},Math.max(1,due-e.now()));}
 async function tick(){
  if(controller.signal.aborted||running)return;
  if(!e.available()){cancel();return;}
  if(e.now()<due){schedule();return;}
  running=true;
  try{await run(controller.signal);failures=0;}catch{failures=Math.min(failures+1,5);}
  finally{running=false;due=e.now()+Math.min(60000,intervalMs*2**failures)+Math.floor(e.random()*intervalMs*.1);schedule();}
 }
 const unsubscribe=e.subscribe(()=>{if(!e.available()){cancel();return;}void tick();});schedule();
 return()=>{controller.abort();cancel();unsubscribe();};
}
