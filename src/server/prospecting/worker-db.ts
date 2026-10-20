import 'server-only';
import pg from 'pg';
import type {PoolClient} from 'pg';
import type {JobLease} from '../../domain/prospecting.ts';
import {withContextTransaction} from '../db/transaction.ts';
import {assertJobLease} from './repository.ts';
import {lockWorkspace} from './ingestion.ts';
let pool:pg.Pool|undefined;
export function workerPool(){
  const url=process.env.WORKER_DATABASE_URL;if(!url||new URL(url).username!=='cadence_worker')throw Error('Worker database role required.');
  if(!pool){pool=new pg.Pool({connectionString:url,max:4,connectionTimeoutMillis:5000,idleTimeoutMillis:10000,options:'-c search_path=app,public -c statement_timeout=15000'});pool.on('error',()=>{});}return pool;
}
export function withLeasedTransaction<T>(lease:JobLease,fn:(c:PoolClient)=>Promise<T>){
  return withContextTransaction(workerPool(),{workspaceId:lease.workspaceId,userId:lease.actorId,role:'operator',sessionId:'worker-job-authority'},async c=>{
    await lockWorkspace(c);await assertJobLease(c,lease,true);const result=await fn(c);await assertJobLease(c,lease,true,true);return result;
  });
}
