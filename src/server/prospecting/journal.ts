import type {JobLease,JobState,ProviderUsage,Units} from '../../domain/prospecting.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {settleUsage,releaseUnused,assertReserved} from './usage.ts';
import {prospectingConfig} from './config.ts';
import {ProviderError} from './providers/transport.ts';
import {AppError} from '../errors.ts';
import {hashValue} from './review.ts';
export class UncertainStep extends Error{}
export async function readLeasedJob(lease:JobLease){return withLeasedTransaction(lease,async c=>(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0]);}
export async function finishJob(lease:JobLease,state:JobState,code?:string){
  await withLeasedTransaction(lease,async c=>{
    await c.query('UPDATE app.prospecting_job SET state=$2,error_code=$3,error_message=$4,updated_at=now(),revision=revision+1 WHERE id=$1',[lease.jobId,state,code??null,code?'A execução precisa de atenção. Consulte o estado e revise antes de repetir.':null]);
    if(['completed','partial','failed','cancelled'].includes(state))await releaseUnused(c,lease.jobId);
  });
}
export async function performStep<T>(lease:JobLease,step:string,provider:string,units:Units,call:()=>Promise<T>,usage?:(result:T)=>ProviderUsage):Promise<T>{
  const operationId=hashValue({job:lease.jobId,step});
  const prior=await withLeasedTransaction(lease,async c=>{
    const job=(await c.query('SELECT checkpoint FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0];
    if(!prospectingConfig().enabled||job.checkpoint.execution?.version!==prospectingConfig().version)throw new AppError(409,'A configuração mudou. Revise antes de continuar.','PROFILE_CHANGED');
    const old=(await c.query('SELECT * FROM app.prospecting_attempt WHERE id=$1',[operationId])).rows[0];
    if(old)return old;
    await assertReserved(c,lease.jobId,units);
    await c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,provider,step,state,payload) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,'prepared',$5)",[lease.jobId,operationId,provider,step,{reservedUnits:units}]);
    return null;
  });
  if(prior?.state==='completed')return prior.payload.result as T;
  if(prior){await finishJob(lease,'needs_reconciliation','UNCERTAIN_STEP');throw new UncertainStep();}
  let result:T;
  try{result=await call();}
  catch(error){
    if(error instanceof ProviderError&&error.uncertain){await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_attempt SET state='uncertain' WHERE id=$1",[operationId]));await finishJob(lease,'needs_reconciliation','UNCERTAIN_STEP');throw new UncertainStep();}
    await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_attempt SET state='failed' WHERE id=$1",[operationId]));throw error;
  }
  await withLeasedTransaction(lease,async c=>{
    if(usage){const measured=usage(result);if(Object.keys(measured.units).length)await settleUsage(c,lease.jobId,{...measured,operationId});}
    await c.query("UPDATE app.prospecting_attempt SET state='completed',payload=$2 WHERE id=$1",[operationId,{result,reservedUnits:units}]);
  });return result;
}
export async function handleStepFailure(lease:JobLease,error:unknown){
  if(error instanceof UncertainStep)return;
  if(error instanceof AppError&&error.code==='STALE_JOB')throw error;
  const job=await readLeasedJob(lease);
  await finishJob(lease,job.counts.inserted||job.counts.pending?'partial':'failed',error instanceof ProviderError?error.code:error instanceof AppError?error.code??'STEP_FAILED':'STEP_FAILED');
}
