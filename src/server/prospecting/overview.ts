import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import {summarizeQualification,type QualificationOverview} from '../../domain/execution-overview.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {itemView} from './repository.ts';
import {chooseNextModule} from './ai/policy.ts';
// 20/11/2026: the end-user execution screen reads groups, lot map and progress in one call, over every item.
export async function readExecutionOverview(p:Principal,id:string):Promise<QualificationOverview>{
 return withWorkspaceTransaction(p,async c=>{
  const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[id])).rows[0];
  if(!job)throw new AppError(404,'Execução não encontrada.');
  if(job.kind!=='qualification'||job.input.enrichment||job.input.companyResearch||job.input.companyPeople||job.checkpoint.purpose==='ai-connection-test')throw new AppError(409,'Esta execução não tem resumo de qualificação.');
  const rows=(await c.query('SELECT * FROM app.prospecting_item WHERE job_id=$1 ORDER BY id',[id])).rows;
  const active=['queued','running','waiting_provider'].includes(job.state);
  const step=active?(await c.query('SELECT step FROM app.prospecting_attempt WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]?.step??'queued':null;
  return summarizeQualification({fitAssessed:Array.isArray(job.input.modules)&&job.input.modules.includes('qualify'),total:Array.isArray(job.input.leadIds)?job.input.leadIds.length:rows.length,startedAt:new Date(job.created_at).toISOString(),now:new Date().toISOString(),currentStep:step,
   items:rows.map(row=>{const v=itemView(row);return {id:v.id,name:v.name,leadId:v.leadId,applied:v.applied,results:v.results,createdAt:new Date(row.created_at??job.created_at).toISOString(),finished:chooseNextModule(job.input,v.results)===null};})});
 });
}
