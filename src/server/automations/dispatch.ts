import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {AutomationAuthorization,AutomationDefinition,AutomationOccurrence,SchedulerLease,LeadSelector} from '../../domain/automation-runtime.ts';
import type {DueWindow} from '../../domain/schedule.ts';
import type {ProspectingInput} from '../../domain/prospecting.ts';
import {AppError} from '../errors.ts';
import {hashValue} from '../prospecting/review.ts';
import {insertReviewedJob} from '../prospecting/job-store.ts';
import {estimateUsage} from '../prospecting/config.ts';
import {authorizationInTransaction,definitionInTransaction,runtimeInTransaction,occurrenceView} from './repository.ts';
import {automationAuthorizationState} from './state.ts';
export class WaitingDependency extends Error{}
async function validate(c:PoolClient,auth:AutomationAuthorization,definition:AutomationDefinition){
 const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role,user=(await c.query("SELECT current_setting('app.user_id') AS id,current_setting('app.workspace_id') AS workspace")).rows[0];
 if(user.id!==auth.actorId||!['owner','admin'].includes(role))throw new AppError(409,'O autorizador perdeu o acesso administrativo.','AUTHORIZER_REMOVED');
 const current=await automationAuthorizationState(c,{userId:user.id,workspaceId:user.workspace,role,sessionId:'scheduler'},definition);
 const {id,automationId,revision,epoch,origin,actorId,...draft}=auth;
 if(current.blockers.length||definition.revision!==auth.revision||hashValue(current.draft)!==hashValue(draft))throw new AppError(409,'A autorização precisa ser revisada.','AUTOMATION_CONFIGURATION_CHANGED');
 return {current,user,role};
}
async function createOccurrence(c:PoolClient,auth:AutomationAuthorization,definition:AutomationDefinition,scheduledAt:string,skipped:number,requestId:string|null,selectLeads?:LeadSelector){
 const old=(await c.query("SELECT * FROM app.automation_occurrence WHERE automation_id=$1 AND ((origin='schedule' AND $2='schedule' AND definition_revision=$3 AND scheduled_at=$4) OR (origin='manual' AND request_id=$5)) FOR UPDATE",[auth.automationId,auth.origin,auth.revision,scheduledAt,requestId])).rows[0];
 if(old&&old.state!=='waiting_dependency')return occurrenceView(old);
 const validated=await validate(c,auth,definition),{workspace,id:userId}=validated.user;
 const active=(await c.query("SELECT 1 FROM app.automation_occurrence o JOIN app.prospecting_job j ON j.workspace_id=o.workspace_id AND j.id=o.job_id WHERE o.automation_id=$1 AND j.state IN('queued','running','waiting_provider','cancelling','needs_reconciliation') LIMIT 1",[auth.automationId])).rowCount;
 const id=old?.id??randomUUID();
 if(!old)await c.query("INSERT INTO app.automation_occurrence(workspace_id,id,automation_id,definition_revision,authorization_id,origin,request_id,scheduled_at,state,skipped_windows) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'empty',$9)",[workspace,id,auth.automationId,auth.revision,auth.id,auth.origin,requestId,scheduledAt,skipped]);
 const get=async()=>occurrenceView((await c.query('SELECT * FROM app.automation_occurrence WHERE id=$1',[id])).rows[0]);
 if(active){await c.query("UPDATE app.automation_occurrence SET state='blocked',blocked_code='EXECUTION_ACTIVE' WHERE id=$1",[id]);return get();}
 await c.query('SAVEPOINT automation_job');
 try{
  let input=validated.current.input!;
  if(input.kind==='qualification'){
   if(!selectLeads){await c.query("UPDATE app.automation_occurrence SET state='blocked',blocked_code='LEAD_SELECTOR_UNAVAILABLE' WHERE id=$1",[id]);await c.query('RELEASE SAVEPOINT automation_job');return get();}
   const ids=await selectLeads(c,definition,await get(),auth.maxItems);
   if(ids.length>auth.maxItems||new Set(ids).size!==ids.length)throw new AppError(409,'Seleção de leads inválida.');
   if(!ids.length){await c.query('RELEASE SAVEPOINT automation_job');return get();}
   input={...input,leadIds:ids};
  }
  let bases={};
  if(input.kind==='qualification'){
   const leads=(await c.query('SELECT id,payload FROM app.lead WHERE list_id=$1 AND id=ANY($2::text[])',[input.listId,input.leadIds])).rows;
   if(leads.length!==input.leadIds.length)throw new AppError(409,'O contato não pertence à lista autorizada.');bases=Object.fromEntries(leads.map(row=>[row.id,row.payload]));
  }
  const checkpoint={context:auth.context,product:auth.product,bases,automation:{id:auth.automationId,authorizationId:auth.id,occurrenceId:id,origin:auth.origin,epoch:auth.epoch,revision:auth.revision,productId:auth.productId,qualificationCriteria:definition.qualificationCriteria},execution:{version:auth.configVersion,profiles:auth.profiles,maxChargeUsd:auth.maxChargeUsd,maxPages:auth.maxPages,aiRoute:auth.aiRoute}};
  const job=await insertReviewedJob(c,{workspaceId:workspace,userId,role:validated.role,sessionId:'scheduler'},{requestId:id,listId:definition.payload.listId,input,bodyHash:hashValue({authorizationId:auth.id,occurrenceId:id,input}),profileVersion:hashValue(auth),checkpoint,usage:estimateUsage(input,auth.aiRoute),caps:auth.caps,globalCaps:auth.globalCaps});
  await c.query("UPDATE app.automation_occurrence SET job_id=$2,state='queued',blocked_code=NULL WHERE id=$1",[id,job.id]);
  await c.query('UPDATE app.automation_lead_assignment SET job_id=$2 WHERE occurrence_id=$1',[id,job.id]);
  await c.query('RELEASE SAVEPOINT automation_job');return get();
 }catch(error){
  await c.query('ROLLBACK TO SAVEPOINT automation_job');await c.query('RELEASE SAVEPOINT automation_job');
  if(error instanceof WaitingDependency){await c.query("UPDATE app.automation_occurrence SET state='waiting_dependency',blocked_code=NULL WHERE id=$1",[id]);return get();}
  const code=error instanceof AppError?error.code:undefined;
  if(code==='USAGE_LIMIT'||error instanceof Error&&error.message.includes('USAGE_LIMIT')){await c.query("UPDATE app.automation_occurrence SET state='blocked',blocked_code='USAGE_LIMIT' WHERE id=$1",[id]);return get();}
  throw error;
 }
}
export async function materializeOccurrence(c:PoolClient,lease:SchedulerLease,window:DueWindow,selectLeads?:LeadSelector):Promise<AutomationOccurrence>{
 await c.query("SELECT set_config('app.automation_token',$1,true),set_config('app.automation_fence',$2,true)",[lease.token,String(lease.fence)]);
 const r=await runtimeInTransaction(c,lease.automationId,true);
 if(r.workspace_id!==lease.workspaceId||r.status!=='active'||r.lease_token!==lease.token||Number(r.fence)!==lease.fence||new Date(r.lease_until).getTime()<=Date.now())throw new AppError(409,'A lease do agendador expirou.','STALE_AUTOMATION');
 await c.query("SELECT set_config('app.automation_token',$1,true),set_config('app.automation_fence',$2,true)",[lease.token,String(lease.fence)]);
 const auth=await authorizationInTransaction(c,r.authorization_id),definition=await definitionInTransaction(c,lease.automationId);
 if(auth.actorId!==lease.actorId||auth.epoch!==Number(r.epoch))throw new AppError(409,'Autorização de ativação obsoleta.','AUTOMATION_CHANGED');
 const occurrence=await createOccurrence(c,auth,definition,window.scheduledAt,window.skipped,null,selectLeads);
 await c.query('UPDATE app.automation_runtime SET next_run_at=$2,last_run_at=$3,pending_occurrence_id=$4,retry_at=$5 WHERE automation_id=$1',[lease.automationId,window.nextRunAt,occurrence.scheduledAt,['queued','running','waiting_dependency','needs_reconciliation'].includes(occurrence.state)?occurrence.id:null,occurrence.state==='waiting_dependency'?new Date(Date.now()+10000).toISOString():null]);
 return occurrence;
}
export async function dispatchManualOccurrence(c:PoolClient,auth:AutomationAuthorization,requestId:string,selectLeads?:LeadSelector){const occurrence=await createOccurrence(c,auth,await definitionInTransaction(c,auth.automationId),new Date().toISOString(),0,requestId,selectLeads);if(occurrence.state==='waiting_dependency')throw new AppError(409,'A busca dependente ainda não terminou. Revise a execução avulsa após sua conclusão.','DEPENDENCY_PENDING');return occurrence;}
