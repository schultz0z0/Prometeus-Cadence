import 'server-only';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {AutomationDefinition,AutomationRuntime,AutomationOccurrence,AutomationAuthorization} from '../../domain/automation-runtime.ts';
import {scheduleV2Schema} from '../../domain/schedule.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
export async function syncAutomationDefinition(c:PoolClient,id:string){await c.query('SELECT app.sync_automation_definition($1)',[id]);}
export function runtimeView(r:Record<string,any>):AutomationRuntime{return {automationId:r.automation_id,revision:Number(r.revision),definitionRevision:Number(r.definition_revision),status:r.status,nextRunAt:r.next_run_at?new Date(r.next_run_at).toISOString():null,lastRunAt:r.last_run_at?new Date(r.last_run_at).toISOString():null,blockedCode:r.blocked_code??null,backlog:Number(r.backlog)};}
export function occurrenceView(r:Record<string,any>):AutomationOccurrence{return {id:r.id,automationId:r.automation_id,revision:Number(r.definition_revision),origin:r.origin,scheduledAt:new Date(r.scheduled_at).toISOString(),state:r.state,jobId:r.job_id??null,skippedWindows:Number(r.skipped_windows),blockedCode:r.blocked_code??null,counts:r.counts};}
export async function definitionInTransaction(c:PoolClient,id:string):Promise<AutomationDefinition>{
 const row=(await c.query('SELECT d.* FROM app.automation_definition d JOIN app.automation_runtime r ON r.workspace_id=d.workspace_id AND r.automation_id=d.automation_id AND r.definition_revision=d.revision WHERE d.automation_id=$1',[id])).rows[0];
 if(!row)throw new AppError(404,'Automação não encontrada.');
 const payload=row.payload,schedule=scheduleV2Schema.safeParse(payload.schedule);
 return {id:row.automation_id,revision:Number(row.revision),payload,schedule:schedule.success?schedule.data:null,dependsOnAutomationId:payload.dependsOnAutomationId??null,qualificationCriteria:payload.criteria??null,productId:payload.origin?.productId??null};
}
export async function runtimeInTransaction(c:PoolClient,id:string,lock=false){
 const row=(await c.query('SELECT * FROM app.automation_runtime WHERE automation_id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!row)throw new AppError(404,'Automação não encontrada.');return row;
}
export async function authorizationInTransaction(c:PoolClient,id:string):Promise<AutomationAuthorization>{const row=(await c.query('SELECT payload FROM app.automation_authorization WHERE id=$1',[id])).rows[0];if(!row)throw new AppError(409,'Autorização indisponível.','AUTOMATION_AUTHORIZATION_MISSING');return row.payload;}
export function readAutomationRuntime(p:Principal,id:string){return withWorkspaceTransaction(p,async c=>runtimeView(await runtimeInTransaction(c,id)));}
export function readAutomationDefinition(p:Principal,id:string){return withWorkspaceTransaction(p,c=>definitionInTransaction(c,id));}
