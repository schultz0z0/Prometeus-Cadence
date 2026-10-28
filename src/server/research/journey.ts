import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {JobLease,ProspectingInput,UsageEstimate} from '../../domain/prospecting.ts';
import type {Confirm} from '../../domain/reviewed-operation.ts';
import {journeyInputSchema,journeyRetryIds,type JourneyInput,type JourneyView,type JourneyReview,type JourneyStage} from '../../domain/prospecting-journey.ts';
import {withContextTransaction,withWorkspaceTransaction} from '../db/transaction.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {assertJobLease} from '../prospecting/repository.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {prospectingReviewState} from '../prospecting/service.ts';
import {insertReviewedJob} from '../prospecting/job-store.ts';
import {createReviewToken,verifyReviewToken,hashValue} from '../prospecting/review.ts';
import {estimateUsage,prospectingConfig} from '../prospecting/config.ts';
import {releaseUnused} from '../prospecting/usage.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {readApprovedContext} from '../context/repository.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {readConnectionCheck} from '../prospecting/ai/connection.ts';
import {resolveAiRoute} from '../../domain/ai-routing.ts';
import {assertExecution} from '../billing/entitlements.ts';
import {preparePlanning,planningReviewState} from '../planning/service.ts';
import {preparePlanningSelection,confirmPlanningSelection} from '../planning/confirmation.ts';

const terminal=['completed','partial','failed','cancelled','needs_reconciliation'];
const sequence:JourneyStage[]=['discover','research','people','qualify'];
const confirmSchema=z.strictObject({input:journeyInputSchema,token:z.string().min(1).max(8192),requestId:z.uuid()});
const resumeSchema=z.strictObject({token:z.string().min(1).max(8192),requestId:z.uuid()});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
function parse<T>(schema:z.ZodType<T>,raw:unknown):T{const r=schema.safeParse(raw);if(!r.success)throw new AppError(422,'Revise o objetivo, a localização e a quantidade.');return r.data;}
async function authorize(c:PoolClient,p:Principal){const role=(await c.query('SELECT app.current_role() role')).rows[0].role;if(!['owner','admin','operator'].includes(role))throw new AppError(403,'Seu papel não permite esta alteração.');requirePermission({...p,role},'data.write');}
function discovery(input:JourneyInput):ProspectingInput{return{kind:'generation',source:'MAPS',destination:input.destinationListId?{mode:'existing',listId:input.destinationListId}:{mode:'new',name:input.brief.slice(0,100)},filters:{term:input.brief.slice(0,1000),location:input.location},limit:input.limit,dedupScope:'workspace'};}
async function basis(c:PoolClient,p:Principal,input:JourneyInput){
 await authorize(c,p);
 const s=await prospectingReviewState(c,p,discovery(input)),context=await readApprovedContext(c),policy=await readAiPolicy(c),runtime=conventionalConfig(p.workspaceId),route=policy.conventionalProvider?runtime.conventional[policy.conventionalProvider].route:null;
 const resolved=resolveAiRoute(policy,runtime,route?await readConnectionCheck(c,route):null);
 const frozen={context,aiRoute:resolved.route,execution:s.checkpoint.execution,policy,sourcePolicy:s.profileVersion};
 const blockers=[...s.blockers,...resolved.blockers];if(!context?.offer||!context.idealCustomer)blockers.push('Aprove a oferta e o cliente ideal no contexto da empresa.');
 return{s,frozen,hash:hashValue(frozen),blockers};
}
function proof(p:Principal,input:JourneyInput,basisHash:string,revision=0,id?:string){return{action:id?'journey.resume':'journey.create',userId:p.userId,workspaceId:p.workspaceId,input,basisHash,revision,id:id??null};}
function estimated(input:JourneyInput,route:any):UsageEstimate[]{
 const gen=estimateUsage(discovery(input)),q:ProspectingInput={kind:'qualification',listId:'estimate',leadIds:Array.from({length:input.limit},(_,i)=>String(i)),modules:['qualify','summary'],summaryPolicy:'all',escalation:'off'};
 return [...gen,...estimateUsage({...q,modules:['deep'],companyResearch:{sourceKinds:['website','social','registry'],maxPagesPerCompany:10}}),...estimateUsage({...q,modules:['decisors'],companyPeople:true,enrichment:{maxCredits:input.limit,destinationName:'Decisores'}},route,input.limit),...estimateUsage(q,route)];
}
export async function prepareJourney(p:Principal,value:unknown):Promise<JourneyReview>{
 const input=parse(journeyInputSchema,value);return withWorkspaceTransaction(p,async c=>{const b=await basis(c,p,input),pr=proof(p,input,b.hash);return{input,token:createReviewToken(pr,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),basisHash:b.hash,blockers:b.blockers,warnings:['A pesquisa pode ser parcial. Contatos pessoais não são garantidos.','Custos de fornecedores desconhecidos não são tratados como zero. A capacidade é revalidada em cada etapa.'],usage:estimated(input,b.frozen.aiRoute),effects:['Criar a lista de destino, se necessário, e iniciar busca, investigação, pessoas e qualificação.','Resultados permanecem revisáveis. Nenhuma cadência será publicada e nenhuma mensagem será enviada.']};});
}
async function row(c:PoolClient,id:string,lock=false){const r=(await c.query('SELECT * FROM app.prospecting_journey WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!r)throw new AppError(404,'Jornada não encontrada.');return r;}
async function stages(c:PoolClient,id:string){return(await c.query('SELECT s.*,j.state job_state,j.input job_input,j.counts,j.error_code FROM app.journey_stage s JOIN app.prospecting_job j ON j.workspace_id=s.workspace_id AND j.id=s.job_id WHERE s.journey_id=$1 ORDER BY s.created_at,s.id',[id])).rows;}
async function view(c:PoolClient,id:string):Promise<JourneyView>{const q=await row(c,id),ss=await stages(c,id);return{id:q.id,revision:Number(q.revision),state:q.state,input:q.input,listId:q.list_id,proposalJobId:q.proposal_job_id,cadenceId:q.cadence_id,reason:q.reason,missing:(await missing(c,id)).length,stages:ss.map(s=>({name:s.name,jobId:s.job_id,state:s.job_state,missing:s.missing,companies:s.company_ids.length}))};}
export function getJourney(p:Principal,id:string){return withWorkspaceTransaction(p,c=>view(c,id));}
export function journeyForJob(p:Principal,jobId:string){return withWorkspaceTransaction(p,async c=>{const s=(await c.query('SELECT journey_id FROM app.journey_stage WHERE job_id=$1',[jobId])).rows[0];return s?view(c,s.journey_id):null;});}
export async function confirmJourney(p:Principal,value:Confirm<JourneyInput>|unknown):Promise<JourneyView>{
 const body=parse(confirmSchema,value);return withWorkspaceTransaction(p,async c=>{
  await authorize(c,p);await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);await lockWorkspace(c);
  const digest=hashValue(body.input),old=(await c.query('SELECT * FROM app.prospecting_journey WHERE request_id=$1',[body.requestId])).rows[0];if(old){if(old.actor_id!==p.userId||old.body_hash!==digest)throw new AppError(409,'Identificador já utilizado.');return view(c,old.id);}
  const b=await basis(c,p,body.input);verifyReviewToken(body.token,proof(p,body.input,b.hash),secret());if(b.blockers.length)throw new AppError(409,b.blockers[0]);await assertExecution(c);
  let listId=body.input.destinationListId;if(!listId){listId=randomUUID();await c.query('INSERT INTO app.list(workspace_id,id,name) VALUES($1,$2,$3)',[p.workspaceId,listId,body.input.brief.slice(0,100)]);await c.query('UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1',[p.workspaceId]);}
  const id=randomUUID();await c.query('INSERT INTO app.prospecting_journey(workspace_id,id,actor_id,request_id,body_hash,input,basis,list_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,id,p.userId,body.requestId,digest,body.input,b.frozen,listId]);
  await enqueue(c,p,await row(c,id),'discover',[]);return view(c,id);
 });
}
async function enqueue(c:PoolClient,p:Principal,q:any,name:JourneyStage,ids:string[]){
 const size=name==='people'?100:500,batches=ids.length?Array.from({length:Math.ceil(ids.length/size)},(_,i)=>ids.slice(i*size,(i+1)*size).sort()):name==='discover'?[[]]:[];
 const version=Number((await c.query('SELECT COALESCE(max(version),0)+1 n FROM app.journey_stage WHERE journey_id=$1 AND name=$2',[q.id,name])).rows[0].n);
 for(const batch of batches){
  const input:ProspectingInput=name==='discover'?{...discovery(q.input),destination:{mode:'existing',listId:q.list_id}} as ProspectingInput:{kind:'qualification',listId:q.list_id,leadIds:batch,modules:name==='research'?['deep']:name==='people'?['decisors']:['qualify','summary'],summaryPolicy:'all',escalation:'off',...(name==='research'?{companyResearch:{sourceKinds:['website','social','registry'],maxPagesPerCompany:10}}:{}),...(name==='people'?{companyPeople:true,enrichment:{maxCredits:batch.length,destinationName:'Decisores · '+q.input.brief.slice(0,75)}}:{})};
  const s=await prospectingReviewState(c,p,input);if(s.blockers.length)throw new AppError(409,s.blockers[0],'JOURNEY_CAPACITY');
  const job=await insertReviewedJob(c,p,{input,listId:q.list_id,requestId:randomUUID(),bodyHash:hashValue({journey:q.id,name,version,batch}),profileVersion:s.profileVersion,checkpoint:{...s.checkpoint,context:q.basis.context,journey:{id:q.id,name,version,basisHash:hashValue(q.basis)}},usage:estimateUsage(input,s.aiRoute,s.enrichment?.reserveCredits),caps:s.config.caps,globalCaps:s.config.globalCaps});
  await c.query('INSERT INTO app.journey_stage(workspace_id,journey_id,id,name,version,company_ids,batch_key,job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,q.id,randomUUID(),name,version,batch,hashValue(batch),job.id]);
 }
}
async function ids(c:PoolClient,id:string){return(await c.query("SELECT DISTINCT i.lead_id FROM app.journey_stage s JOIN app.prospecting_item i ON i.workspace_id=s.workspace_id AND i.job_id=s.job_id JOIN app.lead l ON l.workspace_id=i.workspace_id AND l.id=i.lead_id WHERE s.journey_id=$1 AND s.name='discover' ORDER BY i.lead_id",[id])).rows.map(r=>r.lead_id as string);}
async function missing(c:PoolClient,id:string,name:JourneyStage='research'){
 const cases=(await c.query('SELECT r.lead_id,r.state FROM app.research_case r JOIN app.journey_stage s ON s.workspace_id=r.workspace_id AND s.job_id=r.job_id WHERE s.journey_id=$1 AND s.name=$2',[id,name])).rows;
 return journeyRetryIds(cases.map(r=>({leadId:r.lead_id,state:r.state})));
}
async function currentBasis(c:PoolClient,p:Principal,q:any){const b=await basis(c,p,q.input);return b;}
export async function assertJourneyAuthority(c:PoolClient,job:any){
 if(!job.checkpoint?.journey||job.state==='cancelling')return;
 const role=(await c.query('SELECT app.current_role() role')).rows[0].role;if(!['owner','admin','operator'].includes(role))throw new AppError(403,'A autorização para esta jornada foi removida.');
 const q=await row(c,job.checkpoint.journey.id);if(q.state!=='running'||q.actor_id!==job.actor_id||hashValue(q.basis)!==job.checkpoint.journey.basisHash)throw new AppError(409,'A jornada foi pausada ou mudou.','JOURNEY_CHANGED');
 const current=await basis(c,{workspaceId:q.workspace_id,userId:q.actor_id,role,sessionId:'journey-worker'},q.input);
 if(current.hash!==hashValue(q.basis))throw new AppError(409,'O contexto ou as fontes mudaram. Revise a retomada.','JOURNEY_CHANGED');
}
async function synchronize(c:PoolClient,q:any){
 const ss=await stages(c,q.id);for(const s of ss)await c.query('UPDATE app.journey_stage SET state=$2,missing=$3 WHERE id=$1',[s.id,s.job_state,s.error_code?[s.error_code]:[]]);return ss;
}
async function advance(c:PoolClient,p:Principal,q:any){
 const ss=await synchronize(c,q);if(q.state!=='running')return;
 if(ss.some(s=>s.job_state==='needs_reconciliation')){await c.query("UPDATE app.prospecting_journey SET state='blocked',reason='NEEDS_RECONCILIATION',revision=revision+1 WHERE id=$1",[q.id]);return;}
 const b=await currentBasis(c,p,q);if(b.hash!==hashValue(q.basis)){await c.query("UPDATE app.prospecting_journey SET state='blocked',reason='CONTEXT_CHANGED',revision=revision+1 WHERE id=$1",[q.id]);return;}
 if(ss.some(s=>!terminal.includes(s.job_state)))return;
 const all=await ids(c,q.id);if(!all.length){await c.query("UPDATE app.prospecting_journey SET state='review',reason='EMPTY_RESULT',revision=revision+1 WHERE id=$1",[q.id]);return;}
 const next=sequence.find(n=>!ss.some(s=>s.name===n));
 if(next){await enqueue(c,p,q,next,all);await c.query('UPDATE app.prospecting_journey SET revision=revision+1 WHERE id=$1',[q.id]);}
 else await c.query("UPDATE app.prospecting_journey SET state='review',reason=NULL,revision=revision+1 WHERE id=$1",[q.id]);
}
export async function advanceJourney(lease:JobLease):Promise<JourneyView>{
 const p:Principal={workspaceId:lease.workspaceId,userId:lease.actorId,role:'operator',sessionId:'journey-worker'};
 return withContextTransaction(workerPool(),p,async c=>{
  await lockWorkspace(c);await authorize(c,p);await assertJobLease(c,lease,true,true);
  const stage=(await c.query('SELECT journey_id FROM app.journey_stage WHERE job_id=$1',[lease.jobId])).rows[0];if(!stage)throw new AppError(404,'Etapa não encontrada.');
  await c.query("SELECT set_config('app.journey_job',$1,true),set_config('app.journey_token',$2,true),set_config('app.journey_fence',$3,true)",[lease.jobId,lease.token,String(lease.fence)]);
  const q=await row(c,stage.journey_id,true);await c.query('SAVEPOINT journey_advance');
  try{await advance(c,p,q);await c.query('RELEASE SAVEPOINT journey_advance');}catch(e){await c.query('ROLLBACK TO SAVEPOINT journey_advance');await c.query('RELEASE SAVEPOINT journey_advance');if(!(e instanceof AppError))throw e;await c.query("UPDATE app.prospecting_journey SET state='blocked',reason=$2,revision=revision+1 WHERE id=$1",[q.id,e.code??'REVIEW_REQUIRED']);}
  return view(c,q.id);
 });
}
export async function advancePendingJourney(workspaceId?:string){const r=(await workerPool().query('SELECT * FROM app.claim_journey_advance($1)',[workspaceId??null])).rows[0];if(!r)return false;const lease={workspaceId:r.workspace_id,actorId:r.actor_id,jobId:r.job_id,token:r.token,expiresAt:r.expires_at.toISOString(),fence:Number(r.fence)};try{await advanceJourney(lease);}finally{await withContextTransaction(workerPool(),{workspaceId:r.workspace_id,userId:r.actor_id,role:'operator',sessionId:'journey-worker'},c=>c.query('UPDATE app.prospecting_job SET lease_until=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND fence=$3',[r.job_id,r.token,r.fence])).catch(()=>{});}return true;}
export async function cancelJourney(p:Principal,id:string){return withWorkspaceTransaction(p,async c=>{
 await authorize(c,p);await lockWorkspace(c);const q=await row(c,id,true);if(q.actor_id!==p.userId&&(await c.query('SELECT app.current_role() role')).rows[0].role==='operator')throw new AppError(403,'Somente o criador ou um administrador pode pausar esta jornada.');
 for(const s of await stages(c,id))if(!terminal.includes(s.job_state)){await c.query("UPDATE app.prospecting_job SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE 'cancelling' END,revision=revision+1 WHERE id=$1",[s.job_id]);if(s.job_state==='queued')await releaseUnused(c,s.job_id);}
 await c.query("UPDATE app.prospecting_journey SET state='paused',reason=NULL,revision=revision+1 WHERE id=$1",[id]);await synchronize(c,q);return view(c,id);
});}
async function resumeState(c:PoolClient,p:Principal,id:string){await authorize(c,p);const q=await row(c,id,true);if(q.actor_id!==p.userId)throw new AppError(403,'Retome com o usuário que autorizou a jornada.');const ss=await stages(c,id),b=await basis(c,p,q.input),blockers=[...b.blockers];if(!['paused','blocked','review'].includes(q.state))blockers.push('Pause a jornada antes de revisar a retomada.');if(ss.some(s=>!terminal.includes(s.job_state)||s.job_state==='needs_reconciliation'))blockers.push('Aguarde o encerramento ou a reconciliação da operação anterior.');return{q,ss,b,blockers,pr:proof(p,q.input,b.hash,Number(q.revision),id)};}
export async function prepareJourneyResume(p:Principal,id:string):Promise<JourneyReview>{return withWorkspaceTransaction(p,async c=>{const s=await resumeState(c,p,id);return{input:s.q.input,token:createReviewToken(s.pr,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),basisHash:s.b.hash,blockers:s.blockers,warnings:['Resultados concluídos são preservados. Apenas pendências e etapas invalidadas serão consultadas novamente.','A estimativa abaixo é um teto; custos externos desconhecidos continuam sem valor comprovado.'],usage:estimated(s.q.input,s.b.frozen.aiRoute),effects:['Retomar as etapas pendentes com o contexto revisado. Nenhuma mensagem será enviada.']};});}
export async function resumeJourney(p:Principal,id:string,raw:unknown){const body=parse(resumeSchema,raw);return withWorkspaceTransaction(p,async c=>{
 await authorize(c,p);await lockWorkspace(c);const digest=hashValue({action:'journey.resume',id}),old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[body.requestId])).rows[0];if(old){if(old.user_id!==p.userId||old.body_hash!==digest)throw new AppError(409,'Identificador já utilizado.');return view(c,id);}
 const s=await resumeState(c,p,id);verifyReviewToken(body.token,s.pr,secret());if(s.blockers.length)throw new AppError(409,s.blockers[0]);await assertExecution(c);
 const changed=hashValue(s.q.basis)!==s.b.hash;await c.query("UPDATE app.prospecting_journey SET basis=$2,state='running',reason=NULL,revision=revision+1 WHERE id=$1",[id,s.b.frozen]);const q=await row(c,id),all=await ids(c,id);
 if(!all.length){if(s.ss.find(s=>s.name==='discover')?.job_state==='completed')await advance(c,p,q);else await enqueue(c,p,q,'discover',[]);}
 else{
  const research=await missing(c,id);let started=false;
  for(const name of ['research','people','qualify'] as const){const previous=s.ss.filter(s=>s.name===name),pending=name==='research'?research:previous.length?previous.filter(s=>!['completed','partial'].includes(s.job_state)).flatMap(s=>s.company_ids):all;const retry=changed&&name!=='research'?all:pending;if(retry.length){await enqueue(c,p,q,name,[...new Set(retry)]);started=true;break;}}
  if(!started)await advance(c,p,q);
 }
 await c.query("INSERT INTO app.command_result VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[body.requestId,p.userId,digest,{journeyId:id}]);return view(c,id);
});}
const cadenceChannels=z.strictObject({channels:z.array(z.enum(['EMAIL','WHATSAPP'])).min(1).max(2)});
async function cadenceInput(p:Principal,id:string,raw:unknown){const {channels}=parse(cadenceChannels,raw);return withWorkspaceTransaction(p,async c=>{await authorize(c,p);const q=await row(c,id);if(q.state!=='review'||!q.list_id)throw new AppError(409,'Conclua e revise a jornada antes de sugerir a cadência.');const ss=await stages(c,id);if(ss.some(s=>!terminal.includes(s.job_state)))throw new AppError(409,'Aguarde as etapas pendentes.');return{kind:'planning' as const,task:'cadence_options' as const,listId:q.list_id,objective:'Apresentar a oferta',channels,tone:'Consultivo',rhythm:'Padrão' as const,highlight:q.input.brief,avoid:'Não inventar dados ou prometer contatos pessoais.',decisionMaker:''};});}
export async function prepareJourneyCadence(p:Principal,id:string,raw:unknown){return preparePlanning(p,await cadenceInput(p,id,raw));}
export async function confirmJourneyCadence(p:Principal,id:string,raw:unknown){
 const body=parse(z.strictObject({channels:z.array(z.enum(['EMAIL','WHATSAPP'])).min(1).max(2),token:z.string().min(1),requestId:z.uuid()}),raw),input=await cadenceInput(p,id,{channels:body.channels});
 return withWorkspaceTransaction(p,async c=>{await authorize(c,p);await lockWorkspace(c);const q=await row(c,id,true),digest=hashValue(input),old=(await c.query('SELECT id,actor_id,body_hash FROM app.prospecting_job WHERE request_id=$1',[body.requestId])).rows[0];
  if(old){if(old.actor_id!==p.userId||old.body_hash!==digest||q.proposal_job_id!==old.id)throw new AppError(409,'Identificador já utilizado.');return view(c,id);}
  if(q.state!=='review'||q.proposal_job_id)throw new AppError(409,'Uma proposta já está vinculada ou a jornada mudou.');
  const s=await planningReviewState(c,p,input);verifyReviewToken(body.token,s.proof,secret());if(s.blockers.length)throw new AppError(409,s.blockers[0]);
  const job=await insertReviewedJob(c,p,{input,listId:q.list_id,requestId:body.requestId,bodyHash:digest,profileVersion:s.profileVersion,checkpoint:s.checkpoint,usage:estimateUsage(input,s.aiRoute),caps:s.config.caps,globalCaps:s.config.globalCaps});
  await c.query('UPDATE app.prospecting_journey SET proposal_job_id=$2,revision=revision+1 WHERE id=$1',[id,job.id]);return view(c,id);
 });
}
export async function prepareJourneySelection(p:Principal,id:string,raw:unknown){const q=await getJourney(p,id);if(!q.proposalJobId)throw new AppError(409,'Gere e revise as propostas primeiro.');return preparePlanningSelection(p,q.proposalJobId,raw);}
export async function confirmJourneySelection(p:Principal,id:string,raw:unknown){const q=await getJourney(p,id);if(!q.proposalJobId)throw new AppError(409,'Gere e revise as propostas primeiro.');return confirmPlanningSelection(p,q.proposalJobId,raw);}
