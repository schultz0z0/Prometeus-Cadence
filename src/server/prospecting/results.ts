import type {PoolClient} from 'pg';
import type {JobLease,ModuleResult} from '../../domain/prospecting.ts';
import {assertJobLease} from './repository.ts';
import {lockWorkspace} from './ingestion.ts';
import {settleUsage} from './usage.ts';
import {randomUUID} from 'node:crypto';
export async function recordModuleResult(c:PoolClient,lease:JobLease,leadId:string,result:ModuleResult){
  await lockWorkspace(c);await assertJobLease(c,lease);
  const prior=(await c.query('SELECT * FROM app.prospecting_item WHERE job_id=$1 AND lead_id=$2 FOR UPDATE',[lease.jobId,leadId])).rows[0];
  const results:ModuleResult[]=prior?.payload.results??[];
  if(results.some(r=>r.module===result.module))return;
  if(result.usage)await settleUsage(c,lease.jobId,result.usage);
  const name=(await c.query('SELECT payload->>\'name\' AS name FROM app.lead WHERE id=$1',[leadId])).rows[0]?.name;
  if(!name)throw Error('LEAD_NOT_FOUND');
  await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status,payload) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,'pending_review',$5) ON CONFLICT(workspace_id,job_id,id) DO UPDATE SET payload=EXCLUDED.payload,status='pending_review'",[lease.jobId,prior?.id??randomUUID(),leadId,name,{results:[...results,result]}]);
}
