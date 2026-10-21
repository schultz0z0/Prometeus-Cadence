import 'server-only';
import pg from 'pg';
let pool:pg.Pool|undefined;
export function dispatchPool(){
 const url=process.env.DISPATCH_DATABASE_URL;if(!url||new URL(url).username!=='cadence_dispatcher')throw Error('Dispatch database role required.');
 if(!pool){pool=new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,options:'-c search_path=app,public -c statement_timeout=15000'});pool.on('error',()=>{});}return pool;
}
export async function closeDispatchPool(){if(pool){await pool.end();pool=undefined;}}
