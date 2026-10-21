import 'server-only';
import {z} from 'zod';
import {isIP} from 'node:net';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {PlanningInput,PlanningReview,PlanningBase} from '../../domain/planning.ts';
import {resolveAiRoute,aiRouteView,type AiRoute} from '../../domain/ai-routing.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {planningInputSchema} from './contracts.ts';
import {readApprovedContext} from '../context/repository.ts';
import {workspaceProspectingConfig} from '../prospecting/workspace-config.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {readConnectionCheck} from '../prospecting/ai/connection.ts';
import {estimateUsage,requirements} from '../prospecting/config.ts';
import {hashValue,createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {insertReviewedJob} from '../prospecting/job-store.ts';
import {jobView} from '../prospecting/repository.ts';
import {getJob} from '../prospecting/service.ts';
import {readPlanningProposal} from './repository.ts';
import {isPublicAddress} from '../prospecting/extraction/public-url.ts';
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
export function parsePlanning(input:unknown):PlanningInput{
 const parsed=planningInputSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise os dados da análise.');
 if(parsed.data.task==='context_read')try{
  const url=new URL(/^https?:\/\//i.test(parsed.data.domain)?parsed.data.domain:'https://'+parsed.data.domain),host=url.hostname.replace(/^\[|\]$/g,'');
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port)||host==='localhost'||host.endsWith('.local')||isIP(host)&&!isPublicAddress(host))throw Error();
  return {...parsed.data,domain:url.origin};
 }catch{throw new AppError(422,'Informe um domínio público válido.');}
 return parsed.data;
}
async function authorized(c:PoolClient,p:Principal){requirePermission({...p,role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'data.write');}
export async function planningReviewState(c:PoolClient,p:Principal,input:PlanningInput){
 await authorized(c,p);
 const {config,policy}=await workspaceProspectingConfig(c),aiPolicy=await readAiPolicy(c),runtime=conventionalConfig(p.workspaceId);
 const textOnly=input.task==='context_read'||input.task==='message_preview',effectivePolicy=textOnly&&aiPolicy.mode==='auto'?{...aiPolicy,mode:'conventional-only' as const}:aiPolicy;
 const conventional=aiPolicy.conventionalProvider?runtime.conventional[aiPolicy.conventionalProvider].route:null;
 const resolution=resolveAiRoute(effectivePolicy,runtime,conventional?await readConnectionCheck(c,conventional):null);
 const aiRoute=resolution.route?{...resolution.route,mode:aiPolicy.mode}:null,blockers=[...resolution.blockers,...requirements(config,input,p.workspaceId,aiRoute)];
 const context=input.task==='context_read'?null:await readApprovedContext(c);
 let product=null,targetProduct=null,baseSnapshot:unknown=null;
 const productId=input.task==='context_read'?input.target.kind==='product'?input.target.productId:null:input.productId??null;
 if(productId){
  const row=(await c.query('SELECT * FROM app.product_profile WHERE id=$1',[productId])).rows[0];
  if(!row||row.archived)throw new AppError(404,'Produto não encontrado ou arquivado.');
  if(input.task==='context_read')targetProduct=row;else{product=row.approved??null;if(!product)blockers.push('Aprove o perfil do produto antes de gerar com ele.');}
 }
 if(input.task==='context_read')baseSnapshot=targetProduct?.draft??(await c.query('SELECT payload FROM app.context_version ORDER BY version DESC LIMIT 1')).rows[0]?.payload??null;
 if(input.task==='audience_plan'&&!input.description&&(!context?.offer||!context.idealCustomer))blockers.push('Informe o público ou aprove oferta e cliente ideal no contexto.');
 if(input.task==='cadence_options'){
  const list=(await c.query('SELECT id,name FROM app.list WHERE id=$1',[input.listId])).rows[0];if(!list)throw new AppError(404,'Lista não encontrada.');baseSnapshot={list};
  if(!context?.offer||!context.idealCustomer)blockers.push('Aprove oferta e cliente ideal antes de gerar a cadência.');
 }
 if(input.task==='message_preview'){
  const cadence=(await c.query('SELECT payload FROM app.cadence WHERE id=$1',[input.cadenceId])).rows[0]?.payload,lead=(await c.query('SELECT payload FROM app.lead WHERE id=$1',[input.leadId])).rows[0]?.payload;
  const step=cadence?.steps.find((s:{id:string})=>s.id===input.stepId);
  if(!cadence||!lead||!step||lead.listId!==cadence.listId)throw new AppError(404,'Selecione um lead e uma etapa da mesma lista.');
  baseSnapshot={cadence,lead,step};
 }
 const revision=Number((await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1',[p.workspaceId])).rows[0]?.revision??0);
 const base:PlanningBase={contextVersion:context?.version??0,productVersion:product?.version??null,workspaceRevision:revision};
 const limitsHash=hashValue({policy,caps:config.caps,globalCaps:config.globalCaps}),profileVersion=hashValue({version:config.version,limitsHash,aiRoute,base,productId,product,targetRevision:targetProduct?.revision??null,baseSnapshot});
 return {config,aiRoute,blockers,profileVersion,base,productId,proof:{userId:p.userId,workspaceId:p.workspaceId,input,revision,profileVersion},checkpoint:{context,product,baseSnapshot,planning:{contractVersion:'planning-v1',base,productId,targetRevision:targetProduct?.revision??null,limitsHash},execution:{version:config.version,aiRoute,profiles:config.profiles}}};
}
export async function preparePlanning(p:Principal,input:unknown):Promise<PlanningReview>{
 const parsed=parsePlanning(input);return withWorkspaceTransaction(p,async c=>{
  const s=await planningReviewState(c,p,parsed),now=Date.now();return {input:parsed,token:createReviewToken(s.proof,secret(),now),expiresAt:new Date(now+600000).toISOString(),profileVersion:s.profileVersion,base:s.base,productId:s.productId,usage:estimateUsage(parsed,s.aiRoute),aiRoute:s.aiRoute?aiRouteView(s.aiRoute):null,blockers:s.blockers,warnings:['Esta análise usa IA e pode ter custo desconhecido.','Gerar não cria listas, automações ou cadências. Revise o resultado antes de aplicar.']};
 });
}
const confirmation=z.strictObject({requestId:z.uuid(),input:planningInputSchema,reviewToken:z.string().min(1).max(8192)});
export async function confirmPlanning(p:Principal,input:unknown){
 const parsed=confirmation.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação inválida.');
 const body=parsed.data,request=parsePlanning(body.input),hash=hashValue(request);
 return withWorkspaceTransaction(p,async c=>{
  await authorized(c,p);await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);await lockWorkspace(c);
  const old=(await c.query('SELECT * FROM app.prospecting_job WHERE request_id=$1',[body.requestId])).rows[0];if(old){if(old.actor_id!==p.userId||old.body_hash!==hash||old.kind!=='planning')throw new AppError(409,'Identificador já utilizado.');return jobView(old);}
  const s=await planningReviewState(c,p,request);verifyReviewToken(body.reviewToken,s.proof,secret());if(s.blockers.length)throw new AppError(409,s.blockers[0],'PLANNING_BLOCKED');
  const job=await insertReviewedJob(c,p,{requestId:body.requestId,input:request,listId:request.task==='cadence_options'?request.listId:null,bodyHash:hash,profileVersion:s.profileVersion,checkpoint:s.checkpoint,usage:estimateUsage(request,s.aiRoute),caps:s.config.caps,globalCaps:s.config.globalCaps});
  await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,'planning.confirm')",[p.workspaceId,p.userId]);return job;
 });
}
export async function getPlanning(p:Principal,id:string){
 const job=await getJob(p,id);if(job.kind!=='planning')throw new AppError(404,'Análise não encontrada.');
 const data=await withWorkspaceTransaction(p,async c=>{
  const row=(await c.query('SELECT input,checkpoint FROM app.prospecting_job WHERE id=$1',[id])).rows[0];
  if(!row)throw new AppError(404,'Análise não encontrada.');
  const sources=(await c.query('SELECT payload FROM app.planning_evidence WHERE job_id=$1 ORDER BY created_at,id',[id])).rows.map(r=>r.payload);
  return {request:row.input as PlanningInput,sources,baseline:row.input.task==='context_read'?row.checkpoint.baseSnapshot??null:null,...(row.input.task==='message_preview'?{previewStep:row.checkpoint.baseSnapshot?.step}:{})};
 });
 try{return {job,...data,proposal:await readPlanningProposal(p,id)};}catch(e){if(e instanceof AppError&&e.status===404)return {job,...data,proposal:null};throw e;}
}
