import type {JobLease,JobState,ProviderUsage,Units} from '../../domain/prospecting.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {releaseUnused,assertReserved} from './usage.ts';
import {prospectingConfig} from './config.ts';
import {ProviderError} from './providers/transport.ts';
import {AppError} from '../errors.ts';
import {hashValue} from './review.ts';
import {assertAutomationAuthority} from '../automations/guard.ts';
import {syncOccurrenceJob} from '../automations/assignments.ts';
import {workerPool} from './worker-db.ts';
import {assertExecution} from '../billing/entitlements.ts';
export class UncertainStep extends Error{}
export async function readLeasedJob(lease:JobLease){return withLeasedTransaction(lease,async c=>(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0]);}
export async function finishJob(lease:JobLease,state:JobState,code?:string){
  await withLeasedTransaction(lease,async c=>{
    await c.query('UPDATE app.prospecting_job SET state=$2,error_code=$3,error_message=$4,updated_at=now(),revision=revision+1 WHERE id=$1',[lease.jobId,state,code??null,code?'A execução precisa de atenção. Consulte o estado e revise antes de repetir.':null]);
    if(['completed','partial','failed','cancelled'].includes(state))await releaseUnused(c,lease.jobId);
    const marker=(await c.query('SELECT checkpoint FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0].checkpoint.automation;if(marker)await syncOccurrenceJob(c,marker.occurrenceId);
  });
}
export async function performStep<T>(lease:JobLease,step:string,provider:string,units:Units,call:()=>Promise<T>,usage?:(result:T)=>ProviderUsage):Promise<T>{
  const operationId=hashValue({job:lease.jobId,step});
  const prior=await withLeasedTransaction(lease,async c=>{
    const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0];
    const old=(await c.query('SELECT * FROM app.prospecting_attempt WHERE id=$1',[operationId])).rows[0];
    if(old)return old;
    await assertExecution(c);
    await assertAutomationAuthority(c,job,'dispatch');
    if(!prospectingConfig().enabled||job.checkpoint.execution?.version!==prospectingConfig().version)throw new AppError(409,'A configuração mudou. Revise antes de continuar.','PROFILE_CHANGED');
    await assertReserved(c,lease.jobId,units);
    await c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,provider,step,state,payload) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,'prepared',$5)",[lease.jobId,operationId,provider,step,{reservedUnits:units}]);
    return null;
  });
  if(prior?.state==='completed')return prior.payload.result as T;
  if(prior){await finishJob(lease,'needs_reconciliation','UNCERTAIN_STEP');throw new UncertainStep();}
  let result:T;
  try{
    await withLeasedTransaction(lease,async c=>{await assertExecution(c);const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0];await assertAutomationAuthority(c,job,'dispatch',operationId);});
    result=await call();
  }
  catch(error){
    if(error instanceof ProviderError&&error.uncertain){await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_attempt SET state='uncertain' WHERE id=$1",[operationId]));await finishJob(lease,'needs_reconciliation','UNCERTAIN_STEP');throw new UncertainStep();}
    await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_attempt SET state='failed' WHERE id=$1",[operationId]));throw error;
  }
  // A bounded technical receipt survives membership removal during the call.
  // Domain publication below still goes through the normal membership fence.
  const measured=usage?{...usage(result),provider,operationId}:null;
  const received=await workerPool().query('SELECT app.record_received_prospecting_step($1,$2,$3,$4,$5,$6,$7) AS authorized',[lease.jobId,lease.token,lease.fence,lease.actorId,operationId,JSON.stringify(result),measured]);
  if(!received.rows[0].authorized)throw new AppError(403,'Resposta preservada; o acesso foi removido.','RESULT_RECEIVED_ACCESS_REVOKED');
  return result;
}
export async function handleStepFailure(lease:JobLease,error:unknown){
  if(error instanceof UncertainStep)return;
  if(error instanceof AppError&&error.code==='STALE_JOB')throw error;
  const job=await readLeasedJob(lease);
  const hasItems=await withLeasedTransaction(lease,async c=>!!(await c.query('SELECT 1 FROM app.prospecting_item WHERE job_id=$1 LIMIT 1',[lease.jobId])).rowCount);
  await finishJob(lease,job.counts.inserted||job.counts.pending||hasItems?'partial':'failed',error instanceof ProviderError?error.code:error instanceof AppError?error.code??'STEP_FAILED':'STEP_FAILED');
}
