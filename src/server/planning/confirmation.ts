import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Automation,Cadence,PlanningOrigin} from '../../domain/model.ts';
import type {PlanningSelectionReview,PlanningProposal,AudienceOption,CadenceOption} from '../../domain/planning.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {readApprovedContext} from '../context/repository.ts';
import {hashValue,createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {audienceOptionSchema,cadenceOptionSchema} from './contracts.ts';
import {defaultCadenceSettings} from '../../demo/seed.ts';
import {syncAutomationDefinition} from '../automations/repository.ts';
const selectionSchema=z.strictObject({optionId:z.enum(['option_1','option_2','option_3']),edits:z.record(z.string(),z.unknown())});
const confirmationSchema=selectionSchema.extend({requestId:z.uuid(),reviewToken:z.string().min(1).max(8192)});
export interface PlanningSelectionResult{revision:number;listId?:string;automationIds?:[string,string];cadenceId?:string}
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
async function authorized(c:PoolClient,p:Principal){requirePermission({...p,role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'data.write');}
async function selectionState(c:PoolClient,p:Principal,jobId:string,body:z.infer<typeof selectionSchema>){
 const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[jobId])).rows[0];if(!job)throw new AppError(404,'Análise não encontrada.');
 const proposal=(await c.query('SELECT payload FROM app.planning_proposal WHERE job_id=$1',[jobId])).rows[0]?.payload as PlanningProposal|undefined;
 if(job.kind!=='planning'||!['completed','partial'].includes(job.state)||!proposal||!('options' in proposal))throw new AppError(409,'Esta análise não contém opções disponíveis para criação.');
 if((await c.query('SELECT 1 FROM app.planning_confirmation WHERE job_id=$1',[jobId])).rowCount)throw new AppError(409,'Uma opção desta análise já foi criada.');
 const option=proposal.options.find(o=>o.id===body.optionId);if(!option)throw new AppError(409,'Opção indisponível.');
 const allowed=proposal.task==='audience_plan'?['title','listName','source','filters','channel','dailyLimit','modules','criteria','schedules']:['name','steps'];
 if(Object.keys(body.edits).some(k=>!allowed.includes(k)))throw new AppError(422,'A edição contém campos não permitidos.');
 const parsed=proposal.task==='audience_plan'?audienceOptionSchema.safeParse({...option,...body.edits}):cadenceOptionSchema.safeParse({...option,...body.edits});
 if(!parsed.success)throw new AppError(422,'Revise os campos da opção escolhida.');
 const edited=parsed.data;
 const approved=await readApprovedContext(c);if((approved?.version??0)!==proposal.base.contextVersion)throw new AppError(409,'O contexto aprovado mudou. Gere e revise novamente.');
 const productId=job.checkpoint.planning.productId;
 if(productId){const product=(await c.query('SELECT * FROM app.product_profile WHERE id=$1',[productId])).rows[0];if(!product||product.archived||(product.approved?.version??null)!==proposal.base.productVersion)throw new AppError(409,'O produto aprovado mudou.');}
 if(proposal.task==='cadence_options'){
  if(!(await c.query('SELECT 1 FROM app.list WHERE id=$1',[job.input.listId])).rowCount)throw new AppError(409,'A lista foi removida.');
  if(!('steps' in edited)||edited.steps.some(s=>!job.input.channels.includes(s.channel)))throw new AppError(422,'Use os canais revisados na análise.');
 }
 const revision=Number((await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1',[p.workspaceId])).rows[0]?.revision??0);
 const edits=Object.fromEntries(allowed.map(k=>[k,(edited as unknown as Record<string,unknown>)[k]]));
 const proof={userId:p.userId,workspaceId:p.workspaceId,jobId,optionId:body.optionId,edits,revision,profileVersion:hashValue({proposal,jobRevision:job.revision})};
 return {job,proposal,edited,edits,proof};
}
export async function preparePlanningSelection(p:Principal,jobId:string,input:unknown):Promise<PlanningSelectionReview>{
 const parsed=selectionSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Seleção inválida.');
 return withWorkspaceTransaction(p,async c=>{
  await authorized(c,p);const s=await selectionState(c,p,jobId,parsed.data),now=Date.now();
  return {optionId:parsed.data.optionId,edits:s.edits,token:createReviewToken(s.proof,secret(),now),expiresAt:new Date(now+600000).toISOString(),effects:s.proposal.task==='audience_plan'?['Criar uma lista e duas automações pausadas.','Nenhuma busca ou envio será iniciado.']:['Criar uma cadência em rascunho.','Nenhuma mensagem será enviada.'],blockers:[]};
 });
}
async function createAudience(c:PoolClient,p:Principal,option:AudienceOption,origin:PlanningOrigin){
 const listId=randomUUID(),automationIds:[string,string]=[randomUUID(),randomUUID()],now=new Date().toISOString();
 await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[p.workspaceId,listId,option.listName]);
 const automations:Automation[]=[
  {id:automationIds[0],name:'Buscar · '+option.title,description:option.description,listId,source:option.source,status:'paused',schedule:option.schedules.search,dailyLimit:option.dailyLimit,filters:option.filters,modules:[],createdAt:now,origin},
  {id:automationIds[1],name:'Qualificar · '+option.title,description:option.description,listId,source:'QUALIFY',status:'paused',schedule:option.schedules.qualification,dailyLimit:option.dailyLimit,filters:{channel:option.channel},modules:option.modules,criteria:option.criteria,dependsOnAutomationId:automationIds[0],createdAt:now,origin},
 ];
 for(const automation of automations)await c.query('INSERT INTO app.automation(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[p.workspaceId,automation.id,listId,automation]);
 for(const automation of automations)await syncAutomationDefinition(c,automation.id);
 return {listId,automationIds};
}
export async function confirmPlanningSelection(p:Principal,jobId:string,input:unknown):Promise<PlanningSelectionResult>{
 const parsed=confirmationSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação inválida.');
 const body=parsed.data,hash=hashValue({action:'planning.selection',jobId,optionId:body.optionId,edits:body.edits});
 return withWorkspaceTransaction(p,async c=>{
  await authorized(c,p);await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);await lockWorkspace(c);
  const old=(await c.query('SELECT * FROM app.planning_confirmation WHERE request_id=$1',[body.requestId])).rows[0];
  if(old){if(old.actor_id!==p.userId||old.job_id!==jobId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result;}
  const s=await selectionState(c,p,jobId,body);verifyReviewToken(body.reviewToken,s.proof,secret());
  const origin:PlanningOrigin={kind:'planning',jobId,optionId:body.optionId,contextVersion:s.proposal.base.contextVersion,productVersion:s.proposal.base.productVersion,...(s.job.checkpoint.planning.productId?{productId:s.job.checkpoint.planning.productId}:{})};
  let created:Omit<PlanningSelectionResult,'revision'>;
  if(s.proposal.task==='audience_plan')created=await createAudience(c,p,s.edited as AudienceOption,origin);
  else{
   const option=s.edited as CadenceOption,id=randomUUID();
   const cadence:Cadence={id,name:option.name,listId:s.job.input.listId,status:'draft',steps:option.steps.map(step=>({...step,id:randomUUID()})),settings:defaultCadenceSettings(),createdAt:new Date().toISOString(),origin};
   await c.query('INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[p.workspaceId,id,cadence.listId,cadence]);created={cadenceId:id};
  }
  const revision=Number((await c.query('UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1 RETURNING revision',[p.workspaceId])).rows[0].revision),result={revision,...created};
  await c.query('INSERT INTO app.planning_confirmation(workspace_id,job_id,request_id,actor_id,body_hash,result) VALUES($1,$2,$3,$4,$5,$6)',[p.workspaceId,jobId,body.requestId,p.userId,hash,result]);
  await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,'planning.selection.confirm')",[p.workspaceId,p.userId]);return result;
 });
}
