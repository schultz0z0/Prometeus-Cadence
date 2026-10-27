import type {PoolClient} from 'pg';
import type {AutomationDefinition,AutomationOccurrence} from '../../domain/automation-runtime.ts';
import {WaitingDependency} from './dispatch.ts';
import {AppError} from '../errors.ts';
import {qualificationOptionsFromFilters} from '../../domain/qualification-policy.ts';
export async function eligibleLeads(c:PoolClient,definition:AutomationDefinition,occurrence:AutomationOccurrence,limit:number){
 const options=qualificationOptionsFromFilters(definition.payload.filters);
 let dependencyJob:string|null=null;
 if(definition.dependsOnAutomationId){
  const dependency=(await c.query("SELECT o.job_id,j.state FROM app.automation_occurrence o LEFT JOIN app.prospecting_job j ON j.workspace_id=o.workspace_id AND j.id=o.job_id WHERE o.automation_id=$1 AND (o.scheduled_at AT TIME ZONE $2)::date=($3::timestamptz AT TIME ZONE $2)::date AND o.scheduled_at<=$3::timestamptz ORDER BY o.scheduled_at DESC LIMIT 1",[definition.dependsOnAutomationId,definition.schedule!.timezone,occurrence.scheduledAt])).rows[0];
  if(!dependency||!['completed','partial','failed','cancelled'].includes(dependency.state))throw new WaitingDependency();
  if(!['completed','partial'].includes(dependency.state))throw new AppError(409,'A busca dependente não produziu resultados confirmados.','DEPENDENCY_FAILED');
  dependencyJob=dependency.job_id;
 }
 const rows=(await c.query("SELECT l.id,count(*) OVER() AS total FROM app.lead l LEFT JOIN app.automation_lead_assignment a ON a.workspace_id=l.workspace_id AND a.automation_id=$2 AND a.lead_id=l.id WHERE l.list_id=$1 AND (a.lead_id IS NULL OR a.state='released') AND COALESCE(l.payload->>'qualification','pending')='pending' AND (NOT $7::boolean OR length(btrim(COALESCE(l.payload->>'site','')))>0) AND (NOT $8::boolean OR length(btrim(COALESCE(l.payload->>'email','')))=0) AND ($3::text IS NULL OR EXISTS(SELECT 1 FROM app.prospecting_item i JOIN app.automation_occurrence o ON o.workspace_id=i.workspace_id AND o.job_id=i.job_id JOIN app.prospecting_job j ON j.workspace_id=i.workspace_id AND j.id=i.job_id WHERE i.workspace_id=l.workspace_id AND o.automation_id=$5 AND o.scheduled_at<=$6::timestamptz AND j.state IN('completed','partial') AND i.lead_id=l.id AND i.status='inserted')) ORDER BY l.payload->>'createdAt',l.id LIMIT $4",[definition.payload.listId,definition.id,dependencyJob,limit,definition.dependsOnAutomationId,occurrence.scheduledAt,!!(options.onlyWithSite||options.skipWithoutSite),!!options.onlyMissingEmail])).rows;
 return {ids:rows.map(r=>r.id as string),total:Number(rows[0]?.total??0)};
}
export async function assignEligibleLeads(c:PoolClient,definition:AutomationDefinition,occurrence:AutomationOccurrence,limit:number):Promise<string[]>{
 const {ids}=await eligibleLeads(c,definition,occurrence,limit);
 for(const id of ids)await c.query("INSERT INTO app.automation_lead_assignment(workspace_id,automation_id,lead_id,definition_revision,contract_version,occurrence_id) VALUES(current_setting('app.workspace_id'),$1,$2,$3,'qualification-v1',$4) ON CONFLICT(workspace_id,automation_id,lead_id) DO UPDATE SET definition_revision=EXCLUDED.definition_revision,occurrence_id=EXCLUDED.occurrence_id,job_id=NULL,state='assigned',created_at=clock_timestamp() WHERE app.automation_lead_assignment.state='released'",[definition.id,id,definition.revision,occurrence.id]);
 return ids;
}
// Both callers hold a fenced runtime or job lease. Never release uncertain/attempted work.
export async function syncOccurrenceJob(c:PoolClient,occurrenceId:string){
 const row=(await c.query('SELECT o.*,j.state AS job_state,j.counts AS job_counts FROM app.automation_occurrence o JOIN app.prospecting_job j ON j.workspace_id=o.workspace_id AND j.id=o.job_id WHERE o.id=$1',[occurrenceId])).rows[0];if(!row)return;
 const state=row.job_state==='waiting_provider'||row.job_state==='cancelling'?'running':row.job_state;
 await c.query('UPDATE app.automation_occurrence SET state=$2,counts=$3 WHERE id=$1',[occurrenceId,state,row.job_counts]);
 const attempts=(await c.query('SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 LIMIT 1',[row.job_id])).rowCount;
 const assignment=state==='cancelled'&&!attempts?'released':state==='needs_reconciliation'?'uncertain':['failed','cancelled'].includes(state)?'failed':['completed','partial'].includes(state)?'pending_review':attempts?'attempted':'assigned';
 await c.query('UPDATE app.automation_lead_assignment SET state=$2 WHERE occurrence_id=$1',[occurrenceId,assignment]);
}
