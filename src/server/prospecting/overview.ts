import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import {summarizeQualification,summarizeGeneration,type ExecutionOverview} from '../../domain/execution-overview.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {itemView} from './repository.ts';
import {chooseNextModule} from './ai/policy.ts';
// 20/11/2026: the end-user execution screen reads groups, lot map and progress in one call, over every item.
export async function readExecutionOverview(p:Principal,id:string):Promise<ExecutionOverview>{
 return withWorkspaceTransaction(p,async c=>{
  const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[id])).rows[0];
  if(!job)throw new AppError(404,'Execução não encontrada.');
  const active=['queued','running','waiting_provider'].includes(job.state);
  const lastStep=async()=>(await c.query('SELECT step FROM app.prospecting_attempt WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1',[id])).rows[0]?.step??null;
  // 21/11/2026: a generation shows the companies that came in, the repeated ones and the discarded ones.
  if(job.kind==='generation'){
   const list=job.list_id?(await c.query('SELECT name FROM app.list WHERE id=$1',[job.list_id])).rows[0]?.name??null:null;
   const created=(await c.query("SELECT i.lead_id,i.name,l.payload FROM app.prospecting_item i LEFT JOIN app.lead l ON l.workspace_id=i.workspace_id AND l.id=i.lead_id WHERE i.job_id=$1 AND i.status='inserted' ORDER BY i.id",[id])).rows;
   const dups=(await c.query("SELECT name FROM app.prospecting_item WHERE job_id=$1 AND status='duplicate' ORDER BY id LIMIT 500",[id])).rows;
   const counts=job.counts??{};
   return summarizeGeneration({source:job.input.source,listId:job.list_id,listName:list,target:Number(job.input.limit??0),counts:{inserted:Number(counts.inserted??0),duplicates:Number(counts.duplicates??0),rejected:Number(counts.rejected??0)},reasons:job.checkpoint.discoveryReasons??{},
    created:created.map(r=>({leadId:r.lead_id,name:r.payload?.name??r.name,city:r.payload?.city,phone:r.payload?.phone,site:r.payload?.site,email:r.payload?.email,cnpj:r.payload?.cnpj,rating:r.payload?.rating})),duplicateNames:dups.map(r=>r.name),
    startedAt:new Date(job.created_at).toISOString(),now:new Date().toISOString(),running:active,currentStep:active?await lastStep():null});
  }
  if(job.kind!=='qualification'||job.input.enrichment||job.input.companyResearch||job.input.companyPeople||job.checkpoint.purpose==='ai-connection-test')throw new AppError(409,'Esta execução não tem resumo de qualificação.');
  const rows=(await c.query('SELECT * FROM app.prospecting_item WHERE job_id=$1 ORDER BY id',[id])).rows;
  const step=active?(await lastStep())??'queued':null;
  return summarizeQualification({fitAssessed:Array.isArray(job.input.modules)&&job.input.modules.includes('qualify'),total:Array.isArray(job.input.leadIds)?job.input.leadIds.length:rows.length,startedAt:new Date(job.created_at).toISOString(),now:new Date().toISOString(),currentStep:step,
   items:rows.map(row=>{const v=itemView(row);return {id:v.id,name:v.name,leadId:v.leadId,applied:v.applied,results:v.results,createdAt:new Date(row.created_at??job.created_at).toISOString(),finished:chooseNextModule(job.input,v.results)===null};})});
 });
}
