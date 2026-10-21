import type {PoolClient} from 'pg';
import {AppError} from '../errors.ts';
import {hashValue} from '../prospecting/review.ts';
import {authorizationInTransaction,definitionInTransaction,runtimeInTransaction} from './repository.ts';
import {automationAuthorizationState} from './state.ts';
export async function assertAutomationAuthority(c:PoolClient,job:{id:string;workspace_id:string;actor_id:string;checkpoint:Record<string,any>},phase:'dispatch'|'result',freshOperationId?:string):Promise<void>{
 const marker=job.checkpoint.automation;if(!marker)return;
 const auth=await authorizationInTransaction(c,marker.authorizationId);
 const occurrence=(await c.query('SELECT job_id,authorization_id FROM app.automation_occurrence WHERE id=$1',[marker.occurrenceId])).rows[0];
 if(!occurrence||occurrence.job_id!==job.id||occurrence.authorization_id!==auth.id||auth.automationId!==marker.id)throw new AppError(409,'O vínculo da execução não é válido.','AUTOMATION_AUTHORIZATION_MISSING');
 if(phase==='result')return;
 const runtime=await runtimeInTransaction(c,auth.automationId),definition=await definitionInTransaction(c,auth.automationId),role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;
 if(job.actor_id!==auth.actorId||!['owner','admin'].includes(role))throw new AppError(409,'O autorizador não tem mais a permissão necessária.','AUTHORIZER_REMOVED');
 if(auth.origin==='schedule'&&(runtime.status!=='active'||Number(runtime.epoch)!==auth.epoch||runtime.authorization_id!==auth.id))throw new AppError(409,'A recorrência foi pausada ou revisada.','AUTOMATION_PAUSED');
 if(definition.revision!==auth.revision||hashValue({revision:definition.revision,payload:definition.payload})!==auth.definitionHash)throw new AppError(409,'A definição da automação mudou.','AUTOMATION_CHANGED');
 const current=await automationAuthorizationState(c,{workspaceId:job.workspace_id,userId:job.actor_id,role,sessionId:'automation'},definition,freshOperationId);
 const {id:_id,automationId:_automationId,revision:_revision,epoch:_epoch,origin:_origin,actorId:_actor,...frozen}=auth;
 if(current.blockers.length||hashValue(current.draft)!==hashValue(frozen))throw new AppError(409,'Contexto, produto, fonte, IA ou limites mudaram. Revise a ativação.','AUTOMATION_CONFIGURATION_CHANGED');
}
