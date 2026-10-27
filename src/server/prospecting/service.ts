import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {ProspectingInput,JobView,Review,Page,JobItemView} from '../../domain/prospecting.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {jobInputSchema,confirmationSchema,pageSchema,jobPageSchema} from './schemas.ts';
import {prospectingConfig,requirements,estimateUsage} from './config.ts';
import {workspaceProspectingConfig} from './workspace-config.ts';
import {createReviewToken,verifyReviewToken,hashValue} from './review.ts';
import {jobView,itemView,encodeCursor,decodeCursor} from './repository.ts';
import {releaseUnused} from './usage.ts';
import {insertReviewedJob} from './job-store.ts';
import {conventionalConfig} from './ai/config.ts';
import {readAiPolicy} from './ai/settings.ts';
import {readConnectionCheck} from './ai/connection.ts';
import {resolveAiRoute,aiRouteView,type AiRoute} from '../../domain/ai-routing.ts';
import {readApprovedContext} from '../context/repository.ts';
import {qualificationFingerprint} from '../../domain/qualification-policy.ts';
import {enrichmentCheckpoint} from './enrichment-context.ts';
import {processedQualifications} from './processed.ts';
const secret=()=>{const s=process.env.BETTER_AUTH_SECRET;if(!s)throw Error('Review signing is not configured');return s;};
async function authorized(c:PoolClient,p:Principal){
  const role=(await c.query('SELECT app.current_role() AS role')).rows[0]?.role;
  const current={...p,role};requirePermission(current,'data.write');return current;
}
async function reviewState(c:PoolClient,p:Principal,input:ProspectingInput){
  await authorized(c,p);
  const {config,policy}=await workspaceProspectingConfig(c);
  let aiRoute:AiRoute|null=null;const aiBlockers:string[]=[];
  if(input.kind==='qualification'&&input.modules.some(m=>['qualify','summary','decisors'].includes(m))){
    const aiPolicy=await readAiPolicy(c),runtime=conventionalConfig(p.workspaceId),selected=aiPolicy.conventionalProvider?runtime.conventional[aiPolicy.conventionalProvider].route:null;
    const resolution=resolveAiRoute(aiPolicy,runtime,selected?await readConnectionCheck(c,selected):null);aiRoute=resolution.route;aiBlockers.push(...resolution.blockers);
  }
  const blockers=[...aiBlockers];
  let listId:string|null=null;
  if(input.kind==='qualification'||input.destination.mode==='existing'){
    listId=input.kind==='qualification'?input.listId:input.destination.mode==='existing'?input.destination.listId:null;
    if(!(await c.query('SELECT 1 FROM app.list WHERE id=$1',[listId])).rowCount)throw new AppError(404,'Lista não encontrada neste workspace.');
  }
  let context:Record<string,unknown>|null=null;let bases:Record<string,unknown>={};const processed:Record<string,boolean>={};
  if(input.kind==='qualification'){
    const rows=(await c.query('SELECT id,payload FROM app.lead WHERE list_id=$1 AND id=ANY($2::text[])',[listId,input.leadIds])).rows;
    if(rows.length!==input.leadIds.length)throw new AppError(404,'Um contato selecionado não pertence à lista.');
    bases=Object.fromEntries(rows.map(r=>[r.id,r.payload]));
    context=await readApprovedContext(c) as unknown as Record<string,unknown>|null;
    if(input.options?.skipProcessed){
      Object.assign(processed,await processedQualifications(c,input.leadIds,bases,input.modules,Number(context?.version??0)));
    }
    if(input.modules.includes('qualify')&&!context?.approvedAt)blockers.push('Revise e aprove o contexto da empresa antes de qualificar com IA.');
  }
  const revision=Number((await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1',[p.workspaceId])).rows[0]?.revision??0);
  const enrichment=input.kind==='qualification'?await enrichmentCheckpoint(c,input,bases,config,aiRoute):null;
  blockers.push(...requirements(config,input,p.workspaceId,aiRoute,enrichment?.reserveCredits));
  const profileVersion=hashValue({config:config.version,policy:policy??null,contextVersion:context?.version??0,aiRoute,...(enrichment?{enrichment}: {})});
  const proof={userId:p.userId,workspaceId:p.workspaceId,input,revision,profileVersion};
  return {config,blockers,proof,profileVersion,aiRoute,enrichment,checkpoint:{context,bases,processed,...(enrichment?{enrichment}:{}),execution:{aiRoute,version:config.version,profiles:config.profiles,maxChargeUsd:Number(process.env.APIFY_MAX_CHARGE_USD??0),maxPages:Number(process.env.APOLLO_MAX_PAGES??0)}}};
}
function parseInput(input:unknown):ProspectingInput{const parsed=jobInputSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise fonte, filtros, destino e quantidade.');return parsed.data;}
export async function prepareJob(p:Principal,input:unknown):Promise<Review>{
  const parsed=parseInput(input);
  return withWorkspaceTransaction(p,async c=>{
    const state=await reviewState(c,p,parsed),now=Date.now();
    return {token:createReviewToken(state.proof,secret(),now),expiresAt:new Date(now+600000).toISOString(),input:parsed,blockers:state.blockers,profileVersion:state.profileVersion,aiRoute:state.aiRoute?aiRouteView(state.aiRoute):null,usage:estimateUsage(parsed,state.aiRoute,state.enrichment?.reserveCredits),...(state.enrichment?{enrichmentPreview:{companies:state.enrichment.groups.length,cached:state.enrichment.cached,maxCredits:state.enrichment.reserveCredits,freshLookups:state.enrichment.reserveCredits}}:{}),warnings:['A execução usa serviços externos. Custos desconhecidos não são tratados como zero.','Resultados de IA serão apresentados para revisão antes de aplicar.',...(parsed.kind==='generation'&&parsed.source==='CNPJ'?['Filtros e cobertura dependem do Actor; esta fonte não é uma base nacional local.']:[])]};
  });
}
export async function confirmJob(p:Principal,input:unknown):Promise<JobView>{
  const parsed=confirmationSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação inválida.');
  const body=parsed.data;
  return withWorkspaceTransaction(p,async c=>{
    await authorized(c,p);
    await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);
    await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1 FOR UPDATE',[p.workspaceId]);
    const hash=hashValue(body.input),old=(await c.query('SELECT * FROM app.prospecting_job WHERE request_id=$1',[body.requestId])).rows[0];
    if(old){if(old.actor_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Este identificador já foi utilizado.');return jobView(old);}
    const state=await reviewState(c,p,body.input);
    verifyReviewToken(body.reviewToken,state.proof,secret());
    if(state.blockers.length)throw new AppError(409,state.blockers[0],'PROVIDER_UNAVAILABLE');
    let listId:string;
    if(body.input.kind==='generation'&&body.input.destination.mode==='new'){
      listId=randomUUID();await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[p.workspaceId,listId,body.input.destination.name]);
      await c.query('UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1',[p.workspaceId]);
    }else listId=body.input.kind==='qualification'?body.input.listId:body.input.destination.mode==='existing'?body.input.destination.listId:'';
    const job=await insertReviewedJob(c,p,{requestId:body.requestId,listId,input:body.input,bodyHash:hash,profileVersion:state.profileVersion,checkpoint:state.checkpoint,usage:estimateUsage(body.input,state.aiRoute,state.enrichment?.reserveCredits),caps:state.config.caps,globalCaps:state.config.globalCaps});
    await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,'prospecting.confirm')",[p.workspaceId,p.userId]);
    return job;
  });
}
export async function listJobs(p:Principal,input:unknown={}):Promise<Page<JobView>>{
  const parsed=jobPageSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Página inválida.');
  const {limit,cursor}=parsed.data,after=decodeCursor(cursor);
  if(after&&!after.date)throw new AppError(422,'Página inválida.');
  return withWorkspaceTransaction(p,async c=>{
    const rows=(await c.query("SELECT * FROM app.prospecting_job WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::text)) AND ($4::text IS NULL OR kind=$4) AND ($5::text IS NULL OR state=$5) AND ($6::text IS NULL OR source=$6) AND ($7::text IS NULL OR checkpoint->'automation'->>'id'=$7) ORDER BY created_at DESC,id DESC LIMIT $3",[after?.date??null,after?.id??null,limit+1,parsed.data.kind??null,parsed.data.state??null,parsed.data.source??null,parsed.data.automationId??null])).rows;
    const items=rows.slice(0,limit),last=items.at(-1);
    return {items:items.map(jobView),nextCursor:rows.length>limit&&last?encodeCursor({date:new Date(last.created_at).toISOString(),id:last.id}):null};
  });
}
export async function getJob(p:Principal,id:string):Promise<JobView>{return withWorkspaceTransaction(p,async c=>{
  const row=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[id])).rows[0];
  if(!row)throw new AppError(404,'Execução não encontrada.');
  const usage=(await c.query("SELECT * FROM app.usage_ledger WHERE job_id=$1 AND event='consume' ORDER BY created_at",[id])).rows.map(r=>({provider:r.provider,operationId:r.operation_id,units:r.units,costUsd:r.cost_usd===null?null:Number(r.cost_usd),costKind:r.cost_kind,...r.metadata}));
  const unresolvedAttempts=(await c.query("SELECT id,provider,step FROM app.prospecting_attempt WHERE job_id=$1 AND (state IN('prepared','uncertain') OR payload->'result'->>'kind'='uncertain') ORDER BY created_at,id",[id])).rows.map(a=>({...a,canAttachRun:a.provider==='apify'&&(row.kind==='generation'||a.step.startsWith('registry:')||a.step.startsWith('website:')||a.step.startsWith('abort:'))}));
  const role=(await c.query("SELECT app.current_role() AS role")).rows[0].role;const retainedResults=['owner','admin'].includes(role)?(await c.query("SELECT id,provider,payload FROM app.prospecting_attempt WHERE job_id=$1 AND payload->>'receivedWithoutMembership'='true' ORDER BY created_at,id LIMIT 10",[id])).rows.map(a=>({operationId:a.id,provider:a.provider,result:a.payload.result,receivedAt:a.payload.receivedAt})):undefined;
  return {...jobView(row),usage,unresolvedAttempts,retainedResults};
});}
export async function listJobItems(p:Principal,id:string,input:unknown={}):Promise<Page<JobItemView>>{
  const parsed=pageSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Página inválida.');
  const {cursor,limit}=parsed.data,after=decodeCursor(cursor);
  return withWorkspaceTransaction(p,async c=>{
    if(!(await c.query('SELECT 1 FROM app.prospecting_job WHERE id=$1',[id])).rowCount)throw new AppError(404,'Execução não encontrada.');
    const rows=(await c.query('SELECT * FROM app.prospecting_item WHERE job_id=$1 AND ($2::text IS NULL OR id>$2) ORDER BY id LIMIT $3',[id,after?.id??null,limit+1])).rows;
    const items=rows.slice(0,limit),last=items.at(-1),evidence=(await c.query('SELECT id,lead_id,url,truncated,fetched_at FROM app.lead_evidence WHERE job_id=$1 AND lead_id=ANY($2::text[])',[id,items.map(i=>i.lead_id)])).rows;
    return {items:items.map(item=>({...itemView(item),evidence:evidence.filter(e=>e.lead_id===item.lead_id).map(e=>({id:e.id,url:e.url,truncated:e.truncated,fetchedAt:new Date(e.fetched_at).toISOString()}))})),nextCursor:rows.length>limit&&last?encodeCursor({id:last.id}):null};
  });
}
export async function cancelJob(p:Principal,id:string):Promise<JobView>{return withWorkspaceTransaction(p,async c=>{
  const role=await authorized(c,p),row=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new AppError(404,'Execução não encontrada.');
  if(row.actor_id!==p.userId&&role.role==='operator')throw new AppError(403,'Somente o criador ou um administrador pode cancelar esta execução.');
  if(['completed','partial','failed','cancelled'].includes(row.state))return jobView(row);
  const state=row.state==='queued'?'cancelled':'cancelling';
  const updated=(await c.query('UPDATE app.prospecting_job SET state=$2,updated_at=now(),revision=revision+1 WHERE id=$1 RETURNING *',[id,state])).rows[0];
  if(state==='cancelled'){await releaseUnused(c,id);if(row.checkpoint?.automation)await c.query('SELECT app.sync_cancelled_automation_job($1)',[id]);}
  await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,'prospecting.cancel')",[p.workspaceId,p.userId]);return jobView(updated);
});}
export async function providerCapabilities(p:Principal){const policy=await withWorkspaceTransaction(p,readAiPolicy),provider=policy.conventionalProvider,entry=provider?conventionalConfig(p.workspaceId).conventional[provider]:null;const c=prospectingConfig();return {enabled:c.enabled,sources:Object.fromEntries(Object.entries(c.ready).map(([source,configured])=>[source,{configured}])),decision:{model:'typesafe/jev-1.13',configured:c.jevReady},generation:{provider:provider??'none',configured:!!entry?.configured},limits:{perJob:500,pageSize:100}};}
