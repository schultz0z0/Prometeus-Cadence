import pg from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
const ownership=new AsyncLocalStorage<{valid:boolean}>();
let pool:pg.Pool|undefined;
export function assertOAuthLock(){if(ownership.getStore()?.valid===false)throw Error('CHATGPT_CONNECTION_LOCK_LOST');}
export async function withOAuthLock<T>(workspaceId:string,run:()=>Promise<T>):Promise<T>{
 const url=process.env.WORKER_DATABASE_URL;if(!url||new URL(url).username!=='cadence_worker')throw Error('ChatGPT connection requires the worker database role');
 if(!pool){pool=new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,allowExitOnIdle:true});pool.on('error',()=>{});}
 const client=await pool.connect(),state={valid:true};const lost=()=>{state.valid=false;};client.on('error',lost);
 try{
  await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='20s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",['prometeus.chatgpt.oauth:'+workspaceId]);
  return await ownership.run(state,async()=>{const result=await run();assertOAuthLock();await client.query('COMMIT');return result;});
 }finally{state.valid=false;client.removeListener('error',lost);client.release(true);}
}
