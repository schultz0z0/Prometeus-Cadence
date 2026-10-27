import 'server-only';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {AutomationDefinition,AutomationRuntime,AutomationOccurrence,AutomationAuthorization} from '../../domain/automation-runtime.ts';
import {scheduleV2Schema} from '../../domain/schedule.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {decodeCursor,encodeCursor} from '../prospecting/repository.ts';
import type {Page} from '../../domain/prospecting.ts';
export async function syncAutomationDefinition(c:PoolClient,id:string){await c.query('SELECT app.sync_automation_definition($1)',[id]);}
export function runtimeView(r:Record<string,any>):AutomationRuntime{return {automationId:r.automation_id,revision:Number(r.revision),definitionRevision:Number(r.definition_revision),status:r.status,nextRunAt:r.next_run_at?new Date(r.next_run_at).toISOString():null,lastRunAt:r.last_run_at?new Date(r.last_run_at).toISOString():null,blockedCode:r.blocked_code??null,backlog:Number(r.backlog)};}
export function occurrenceView(r:Record<string,any>):AutomationOccurrence{return {id:r.id,automationId:r.automation_id,revision:Number(r.definition_revision),origin:r.origin,scheduledAt:new Date(r.scheduled_at).toISOString(),state:r.state,jobId:r.job_id??null,skippedWindows:Number(r.skipped_windows),blockedCode:r.blocked_code??null,counts:r.counts,...(r.counts.transferred!==undefined?{transferred:Number(r.counts.transferred)}:{})};}
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
export function listAutomationRuntime(p:Principal){return withWorkspaceTransaction(p,async c=>{const rows=(await c.query('SELECT * FROM app.automation_runtime ORDER BY automation_id LIMIT 501')).rows;if(rows.length>500)throw new AppError(422,'Filtre as automações para continuar.');return Promise.all(rows.map(async r=>({definition:await definitionInTransaction(c,r.automation_id),runtime:runtimeView(r)})));});}
export function listAutomationOccurrences(p:Principal,id:string,cursor?:string):Promise<Page<AutomationOccurrence>>{const after=decodeCursor(cursor);if(after&&!after.date)throw new AppError(422,'Página inválida.');return withWorkspaceTransaction(p,async c=>{await definitionInTransaction(c,id);const rows=(await c.query('SELECT * FROM app.automation_occurrence WHERE automation_id=$1 AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::text)) ORDER BY created_at DESC,id DESC LIMIT 51',[id,after?.date??null,after?.id??null])).rows,last=rows[49];return {items:rows.slice(0,50).map(occurrenceView),nextCursor:rows.length>50?encodeCursor({date:new Date(last.created_at).toISOString(),id:last.id}):null};});}
