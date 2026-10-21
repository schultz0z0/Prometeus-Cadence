import 'server-only';
import {randomUUID} from 'node:crypto';
import type {SchedulerLease} from '../../domain/automation-runtime.ts';
import {latestDueWindow} from '../../domain/schedule.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {withContextTransaction} from '../db/transaction.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {AppError} from '../errors.ts';
import {runtimeInTransaction,definitionInTransaction,occurrenceView} from './repository.ts';
import {materializeOccurrence} from './dispatch.ts';
import {assignEligibleLeads,eligibleLeads,syncOccurrenceJob} from './assignments.ts';
export async function runSchedulerOnce(options:{signal:AbortSignal;workerId?:string;workspaceId?:string;now?:()=>Date}):Promise<boolean>{
 if(process.env.AUTOMATIONS_SCHEDULER_ENABLED!=='true'||options.signal.aborted)return false;
 const row=(await workerPool().query('SELECT * FROM app.claim_due_automation($1,$2)',[options.workerId??randomUUID(),options.workspaceId??null])).rows[0];if(!row)return false;
 const lease:SchedulerLease={workspaceId:row.workspace_id,automationId:row.automation_id,actorId:row.actor_id,token:row.token,fence:Number(row.fence),expiresAt:new Date(row.expires_at).toISOString()};
 let lost=false,checking=Promise.resolve();const timer=setInterval(()=>{checking=checking.then(async()=>{if(!(await workerPool().query('SELECT app.heartbeat_automation($1,$2,$3) AS ok',[lease.automationId,lease.token,lease.fence])).rows[0].ok)lost=true;}).catch(()=>{lost=true;});},10000);
 const transaction=<T>(fn:(c:import('pg').PoolClient)=>Promise<T>)=>withContextTransaction(workerPool(),{workspaceId:lease.workspaceId,userId:lease.actorId,role:'admin',sessionId:'scheduler'},async c=>{await lockWorkspace(c);await c.query("SELECT set_config('app.automation_token',$1,true),set_config('app.automation_fence',$2,true)",[lease.token,String(lease.fence)]);const rt=await runtimeInTransaction(c,lease.automationId,true);if(rt.lease_token!==lease.token||Number(rt.fence)!==lease.fence||new Date(rt.lease_until).getTime()<=Date.now()||lost||options.signal.aborted)throw new AppError(409,'Lease do agendador obsoleta.','STALE_AUTOMATION');return fn(c);});
 try{
  await transaction(async c=>{
   let runtime=await runtimeInTransaction(c,lease.automationId);const definition=await definitionInTransaction(c,lease.automationId),now=(options.now?.()??new Date()).toISOString();
   if(!definition.schedule)throw new AppError(409,'Revise a programação.','SCHEDULE_INVALID');
   let pending=null;
   if(runtime.pending_occurrence_id){
    await syncOccurrenceJob(c,runtime.pending_occurrence_id);
    pending=(await c.query('SELECT * FROM app.automation_occurrence WHERE id=$1',[runtime.pending_occurrence_id])).rows[0];
    if(pending&&['queued','running','needs_reconciliation'].includes(pending.state))return;
    if(pending?.state!=='waiting_dependency'){await c.query('UPDATE app.automation_runtime SET pending_occurrence_id=NULL WHERE automation_id=$1',[lease.automationId]);pending=null;}
   }
   const window=pending?{scheduledAt:new Date(pending.scheduled_at).toISOString(),nextRunAt:runtime.next_run_at?new Date(runtime.next_run_at).toISOString():null,skipped:Number(pending.skipped_windows)}:runtime.next_run_at?latestDueWindow(definition.schedule,new Date(runtime.next_run_at).toISOString(),now):null;
   if(!window){if(!runtime.next_run_at)await c.query("UPDATE app.automation_runtime SET status='paused',revision=revision+1 WHERE automation_id=$1",[lease.automationId]);return;}
   const occurrence=await materializeOccurrence(c,lease,window,assignEligibleLeads);
   let backlog=0;if(definition.payload.source==='QUALIFY'&&occurrence.state!=='waiting_dependency')backlog=(await eligibleLeads(c,definition,occurrence,1)).total;
   await c.query('UPDATE app.automation_runtime SET backlog=$2 WHERE automation_id=$1',[lease.automationId,backlog]);
  });
 }catch(error){
  if(error instanceof AppError&&error.code!=='STALE_AUTOMATION'){
   await transaction(async c=>{await c.query("UPDATE app.automation_runtime SET status='blocked',blocked_code=$2,next_run_at=NULL,pending_occurrence_id=NULL,revision=revision+1 WHERE automation_id=$1",[lease.automationId,error.code??'AUTOMATION_BLOCKED']);await c.query('INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,$3)',[lease.workspaceId,lease.actorId,'automation.blocked:'+(error.code??'AUTOMATION_BLOCKED')]);}).catch(()=>{});
  }else throw error;
 }finally{clearInterval(timer);await checking;await workerPool().query('SELECT app.ack_automation($1,$2,$3)',[lease.automationId,lease.token,lease.fence]);}
 return true;
}
