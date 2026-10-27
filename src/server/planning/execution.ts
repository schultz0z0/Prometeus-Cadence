import {createHash} from 'node:crypto';
import type {JobLease,JobInput} from '../../domain/prospecting.ts';
import type {PlanningInput,PlanningEvidence,PlanningProposal} from '../../domain/planning.ts';
import type {AiRoute} from '../../domain/ai-routing.ts';
import {withLeasedTransaction} from '../prospecting/worker-db.ts';
import {readLeasedJob,performStep,finishJob,UncertainStep} from '../prospecting/journal.ts';
import {fetchEvidencePack} from '../prospecting/extraction/fetch-page.ts';
import {generatePlanning} from './model.ts';
import {rankPlanningOptions} from './ranking.ts';
import {savePlanningEvidence} from './evidence.ts';
import {savePlanningProposal} from './repository.ts';
import {assertAiRouteCurrent} from '../prospecting/ai/route-guard.ts';
import {diagnoseCodex} from '../prospecting/ai/diagnostics.ts';
import {recordConnectionCheck} from '../prospecting/ai/connection.ts';
import {conventionalUnit,ensureOAuthCompanion} from '../prospecting/ai/json.ts';
import {hashValue} from '../prospecting/review.ts';
import {workspaceProspectingConfig} from '../prospecting/workspace-config.ts';
import {readApprovedContext} from '../context/repository.ts';
import {requirePermission} from '../auth/permissions.ts';
import {ProviderError} from '../prospecting/providers/transport.ts';
import {AppError} from '../errors.ts';
export interface PlanningAdapters{signal?:AbortSignal;collect?:typeof fetchEvidencePack;planningGenerate?:typeof generatePlanning;rank?:typeof rankPlanningOptions;diagnose?:typeof diagnoseCodex}
// Planning's generate adapter is named separately from the existing summary adapter.
export type PlanningExecutionAdapters=Omit<PlanningAdapters,'planningGenerate'>&{generate?:typeof generatePlanning};
async function preflight(lease:JobLease,job:any,deps:PlanningExecutionAdapters,freshOperationId?:string){
 const check=()=>withLeasedTransaction(lease,async c=>{
  requirePermission({workspaceId:lease.workspaceId,userId:lease.actorId,sessionId:'worker',role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'data.write');
  await assertAiRouteCurrent(c,job,freshOperationId);
  const {config,policy}=await workspaceProspectingConfig(c);
  if(!config.enabled||config.version!==job.checkpoint.execution.version||hashValue({policy,caps:config.caps,globalCaps:config.globalCaps})!==job.checkpoint.planning.limitsHash)throw new AppError(409,'Os limites ou a configuração mudaram.','PROFILE_CHANGED');
  if(job.input.task!=='context_read'){
   const approved=await readApprovedContext(c);if((approved?.version??0)!==job.checkpoint.planning.base.contextVersion)throw new AppError(409,'O contexto aprovado mudou.','CONTEXT_CHANGED');
   const productId=job.checkpoint.planning.productId;
   if(productId){const product=(await c.query('SELECT approved,archived FROM app.product_profile WHERE id=$1',[productId])).rows[0];if(!product||product.archived||(product.approved?.version??null)!==job.checkpoint.planning.base.productVersion)throw new AppError(409,'O produto aprovado mudou.','PRODUCT_CHANGED');}
  }
 });
 await check();
 if(job.checkpoint.execution.aiRoute.conventional.provider==='chatgpt-oauth'){
  await ensureOAuthCompanion(lease.workspaceId,job.checkpoint.execution.aiRoute.conventional,deps.signal);
  await check();
 }
 if(job.checkpoint.execution.aiRoute.conventional.provider==='codex-local'){
  const result=await(deps.diagnose??diagnoseCodex)();if(!result.authenticated||result.authMode!=='chatgpt')throw new AppError(409,'Autentique o Codex local com ChatGPT.','AI_COMPANION_UNAVAILABLE');
  await check();
 }
 deps.signal?.throwIfAborted();
}
function source(id:string,kind:PlanningEvidence['kind'],value:unknown):PlanningEvidence{
 const text=JSON.stringify(value).slice(0,12000);return {id,kind,url:null,text,hash:createHash('sha256').update(text).digest('hex'),obtainedAt:new Date().toISOString()};
}
export async function runPlanning(lease:JobLease,deps:PlanningExecutionAdapters={}):Promise<void>{
 const job=await readLeasedJob(lease),input=job.input as JobInput;if(input.kind!=='planning')throw new AppError(409,'Tipo de execução incompatível.');
 const route=job.checkpoint.execution.aiRoute as AiRoute,signal=deps.signal??new AbortController().signal;
 try{
  if(job.state==='cancelling'){
   const unknown=await withLeasedTransaction(lease,async c=>(await c.query("SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND state IN('prepared','uncertain') LIMIT 1",[lease.jobId])).rowCount);
   await finishJob(lease,unknown?'needs_reconciliation':'cancelled',unknown?'CANCEL_UNCERTAIN':undefined);return;
  }
  const sources=await performStep(lease,'planning:collect','public-web',{},async()=>{
   await preflight(lease,job,deps);
   const sources:PlanningEvidence[]=[];
   if(input.task==='context_read'){
    const pages=await(deps.collect??fetchEvidencePack)(input.domain,{signal},true);
    for(const p of pages.slice(0,3))sources.push({id:p.id,kind:'public_page',url:p.url,text:p.text,hash:p.hash,obtainedAt:p.fetchedAt});
    if(!sources.length)throw new AppError(409,'Não foi possível obter conteúdo público deste domínio.','NO_PUBLIC_EVIDENCE');
   }else{
    if(job.checkpoint.context)sources.push(source('approved-company','approved_context',job.checkpoint.context));
    if(job.checkpoint.product)sources.push(source('approved-product','approved_context',job.checkpoint.product));
    if(input.task==='audience_plan')sources.push(source('audience-brief','user_brief',{description:input.description,channel:input.channel}));
    else if(input.task==='cadence_options')sources.push(source('cadence-brief','user_brief',input));
    else{
     const {lead,step}=job.checkpoint.baseSnapshot;
     sources.push(source('selected-lead','lead_fact',{step:{channel:step.channel,body:step.body.slice(0,2000),subject:step.subject?.slice(0,200),delayDays:step.delayDays},lead:{name:lead.name,companyName:lead.companyName,email:lead.email,phone:lead.phone,site:lead.site,city:lead.city,cnpj:lead.cnpj,summary:lead.summary?.slice(0,2000)}}));
    }
   }
   return withLeasedTransaction(lease,c=>savePlanningEvidence(c,lease,sources));
  });
  const step='planning:generate',operationId=hashValue({job:lease.jobId,step}),conventional=route.conventional;
  const slot=(release:boolean)=>withLeasedTransaction(lease,async c=>Boolean((await c.query('SELECT app.codex_prospecting_slot($1,$2,$3,$4) AS ok',[lease.jobId,lease.token,lease.fence,release])).rows[0].ok));
  const generated=await performStep(lease,step,conventional.provider==='codex-local'?'codex':conventional.provider,{[conventionalUnit(conventional.provider)]:1},async()=>{
   await preflight(lease,job,deps,operationId);
   try{return await(deps.generate??generatePlanning)({jobId:lease.jobId,workspaceId:lease.workspaceId,operationId,route:conventional,signal,acquireSlot:()=>slot(false),releaseSlot:async()=>{await slot(true);}},{request:input,sources,context:job.checkpoint.context,product:job.checkpoint.product,base:job.checkpoint.planning.base});}
   catch(error){await withLeasedTransaction(lease,c=>recordConnectionCheck(c,lease,{operationId,route:conventional,outcome:error instanceof ProviderError&&error.uncertain?'uncertain':'failed',code:error instanceof ProviderError?error.code:'PLANNING_FAILED'}));throw error;}
  },r=>r.usage);
  // Content is immutable. Ranking is a separate durable assessment in the journal.
  const proposal:PlanningProposal={...generated.proposal,recommendedOptionId:null};
  await withLeasedTransaction(lease,c=>savePlanningProposal(c,lease,proposal));
  if(route.decisionProvider==='jev'&&(input.task==='audience_plan'||input.task==='cadence_options')){
   if(!('options' in proposal))throw new AppError(409,'Proposta sem opções.');
   const step='planning:rank',operationId=hashValue({job:lease.jobId,step});
   await performStep(lease,step,'openrouter',{jevCalls:1},async()=>{
    await preflight(lease,job,deps);
    return(deps.rank??rankPlanningOptions)({operationId,signal,credential:process.env.OPENROUTER_API_KEY??''},{task:input.task as 'audience_plan'|'cadence_options',options:proposal.options,company:job.checkpoint.context,product:job.checkpoint.product,request:input,criteria:JSON.stringify({request:input,context:job.checkpoint.context,product:job.checkpoint.product}).slice(0,12000)});
   },r=>r.usage);
  }
  await finishJob(lease,'completed');
 }catch(error){
  if(error instanceof UncertainStep)return;
  if(error instanceof AppError&&error.code==='STALE_JOB')throw error;
  const hasProposal=await withLeasedTransaction(lease,async c=>(await c.query('SELECT 1 FROM app.planning_proposal WHERE job_id=$1',[lease.jobId])).rowCount);
  await finishJob(lease,hasProposal?'partial':'failed',error instanceof ProviderError?error.code:error instanceof AppError?error.code??'PLANNING_FAILED':'PLANNING_FAILED');
 }
}
