import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {assistantActionAllowed,commandPermission,commandSchemas,type AssistantProposal,type CommandKind} from '../../domain/assistant-actions.ts';
import type {PlanningInput} from '../../domain/planning.ts';
import type {JobInput} from '../../domain/prospecting.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {capabilities} from '../auth/permissions.ts';
import {createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {preparePlanning,confirmPlanning} from '../planning/service.ts';
import {prepareJob,confirmJob} from '../prospecting/service.ts';
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
const failures:Record<string,[number,string]>={
 ASSISTANT_ACCESS:[403,'Você não tem mais acesso a este workspace.'],
 PROPOSAL_NOT_FOUND:[404,'Proposta não encontrada.'],
 PROPOSAL_CANCELLED:[409,'Esta proposta foi cancelada.'],
 PROPOSAL_DONE:[409,'Esta proposta já foi confirmada.'],
 PROPOSAL_EXPIRED:[409,'A proposta venceu. Peça de novo ao assistente.'],
 PROPOSAL_BUSY:[409,'Esta proposta já está sendo confirmada.'],
 PROPOSAL_INVALID:[422,'Operação inválida para a proposta.'],
};
function proposalError(e:unknown){const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;}
const idSchema=z.string().min(1).max(200),confirmSchema=z.strictObject({token:z.string().min(1).max(8192),requestId:z.uuid()});
type Row={id:string;kind:CommandKind;payload:Record<string,any>;summary:string;state:AssistantProposal['state'];expires_at:Date;entity_id:string|null;href:string|null;confirm_request_id:string|null};
export const proposalView=(r:Row):AssistantProposal=>({id:r.id,kind:r.kind,payload:r.payload,summary:r.summary,state:r.state,expiresAt:r.expires_at.toISOString(),entityId:r.entity_id,href:r.href});
// The chat confirmation is consent only: the role must already hold the permission of the command.
async function authorized(c:PoolClient,p:Principal,kind:CommandKind){
 const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role as Principal['role'];
 if(!assistantActionAllowed({requested:commandPermission[kind],allowed:capabilities(role),confirmed:true}))throw new AppError(403,'Seu papel não permite esta ação.');
}
async function lock(p:Principal,id:string,forConfirm:boolean){
 if(!idSchema.safeParse(id).success)throw new AppError(404,'Proposta não encontrada.');
 return withWorkspaceTransaction(p,async c=>{const r=(await c.query('SELECT * FROM app.assistant_proposal_lock($1,$2)',[id,forConfirm])).rows[0] as Row;await authorized(c,p,r.kind);return r;});
}
// Inputs are rebuilt from the stored proposal on every call; the client never supplies the command body.
const QUALIFY_CAP=500;
async function underlying(p:Principal,r:Row):Promise<{kind:'planning';input:PlanningInput}|{kind:'job';input:JobInput;total:number}|{kind:'draft';conversationId:string;channel:string;text:string}>{
 const v=commandSchemas[r.kind].parse(r.payload) as Record<string,any>;
 if(r.kind==='create-audience-automation')return{kind:'planning',input:{kind:'planning',task:'audience_plan',description:v.description,channel:v.channel,timezone:'America/Sao_Paulo'} as PlanningInput};
 if(r.kind==='create-cadence')return{kind:'planning',input:{kind:'planning',task:'cadence_options',listId:v.listId,objective:v.objective,channels:v.channels,tone:v.tone,rhythm:'Padrão',highlight:'',avoid:'',decisionMaker:''} as PlanningInput};
 return withWorkspaceTransaction(p,async c=>{
  if(r.kind==='qualify-list'){
   const ids=(await c.query("SELECT id FROM app.lead WHERE list_id=$1 ORDER BY payload->>'createdAt',id LIMIT $2",[v.listId,QUALIFY_CAP])).rows.map(x=>x.id as string);
   if(!ids.length)throw new AppError(409,'A lista não tem contatos para qualificar.');
   const total=Number((await c.query('SELECT count(*) n FROM app.lead WHERE list_id=$1',[v.listId])).rows[0].n);
   return{kind:'job' as const,total,input:{kind:'qualification',listId:v.listId,leadIds:ids,modules:['email','phone'],summaryPolicy:'fits',escalation:'off',options:{skipProcessed:true,language:'pt-BR'}} as JobInput};
  }
  const conv=(await c.query('SELECT id,channel FROM app.channel_conversation WHERE id=$1',[v.conversationId])).rows[0];
  if(!conv)throw new AppError(404,'A conversa não existe mais neste workspace.');
  return{kind:'draft' as const,conversationId:conv.id,channel:conv.channel,text:v.text};
 });
}
const draftProof=(p:Principal,r:Row,u:{conversationId:string;text:string})=>({purpose:'assistant-draft',userId:p.userId,workspaceId:p.workspaceId,proposalId:r.id,conversationId:u.conversationId,text:u.text});
export async function prepareAssistantAction(p:Principal,id:string){
 try{
  const r=await lock(p,id,false),u=await underlying(p,r);
  const review=u.kind==='planning'?await preparePlanning(p,u.input):u.kind==='job'?await withCap(await prepareJob(p,u.input),u.total)
   :{input:{conversationId:u.conversationId,text:u.text},token:createReviewToken(draftProof(p,r,u),secret()),expiresAt:new Date(Date.now()+600000).toISOString(),blockers:[] as string[],warnings:['Confirmar só guarda o rascunho e abre a conversa. Nada é enviado: a resposta ainda passa pela revisão de envio.'],usage:[]};
  // The review never shows a deadline past the proposal's own.
  if(Date.parse(review.expiresAt)>r.expires_at.getTime())review.expiresAt=r.expires_at.toISOString();
  return{proposal:proposalView(r),review};
 }catch(e){throw proposalError(e);}
}
async function withCap<T extends {warnings:string[]}>(review:T,total:number){
 if(total>QUALIFY_CAP)review.warnings=[`Esta qualificação cobre ${QUALIFY_CAP} de ${total} contatos da lista (os mais antigos). Peça de novo depois para o restante.`,...review.warnings];
 return review;
}
// A job already committed for a claimed confirmation (crash before finish) is the proposal's entity; it is never created twice.
async function committed(p:Principal,r:Row,requestId:string){
 if(r.kind==='draft-reply')return null;
 const job=(await withWorkspaceTransaction(p,c=>c.query('SELECT id,input FROM app.prospecting_job WHERE request_id=$1 AND actor_id=$2',[requestId,p.userId]))).rows[0];
 if(!job)return null;
 return{entityId:job.id as string,href:job.input?.task==='audience_plan'?'/automations/new/ai?job='+encodeURIComponent(job.id):job.input?.task==='cadence_options'?'/cadences/new/ai?job='+encodeURIComponent(job.id):'/executions/'+encodeURIComponent(job.id)};
}
async function finish(p:Principal,id:string,requestId:string,e:{entityId:string;href:string}){
 const done=await withWorkspaceTransaction(p,async c=>(await c.query("SELECT * FROM app.assistant_proposal_finish($1,'confirmed',$2,$3,$4)",[id,requestId,e.entityId,e.href])).rows[0] as Row);
 return{proposal:proposalView(done),entityId:done.entity_id!,href:done.href!};
}
export async function confirmAssistantAction(p:Principal,id:string,raw:unknown):Promise<{proposal:AssistantProposal;entityId:string;href:string}>{
 const parsed=confirmSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Revise a proposta antes de confirmar.');const body=parsed.data;
 try{
  const current=await lock(p,id,true);
  if(current.state==='confirmed'){if(current.confirm_request_id!==body.requestId)throw new AppError(409,'Esta proposta já foi confirmada.','PROPOSAL_DONE');return{proposal:proposalView(current),entityId:current.entity_id!,href:current.href!};}
  if(current.confirm_request_id){const prior=await committed(p,current,current.confirm_request_id);if(prior)return finish(p,id,current.confirm_request_id,prior);}
  const claimed=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT * FROM app.assistant_proposal_claim($1,$2)',[id,body.requestId])).rows[0] as Row);
  let entityId:string,href:string;
  try{
   const u=await underlying(p,claimed);
   if(u.kind==='planning'){const job=await confirmPlanning(p,{requestId:body.requestId,input:u.input,reviewToken:body.token});entityId=job.id;href=(u.input.task==='audience_plan'?'/automations/new/ai?job=':'/cadences/new/ai?job=')+encodeURIComponent(job.id);}
   else if(u.kind==='job'){const job=await confirmJob(p,{requestId:body.requestId,input:u.input,reviewToken:body.token});entityId=job.id;href='/executions/'+encodeURIComponent(job.id);}
   else{verifyReviewToken(body.token,draftProof(p,claimed,u),secret());entityId=claimed.id;href=(u.channel==='EMAIL'?'/messages/email':'/messages/whatsapp')+'?conversation='+encodeURIComponent(u.conversationId)+'&draft='+encodeURIComponent(claimed.id);}
  }catch(e){
   // Release only when nothing was committed for this id; a committed job keeps the claim and is finished on retry.
   if(!await committed(p,claimed,body.requestId).catch(()=>null))await withWorkspaceTransaction(p,c=>c.query('SELECT app.assistant_proposal_release($1,$2)',[id,body.requestId])).catch(()=>{});
   throw e;
  }
  return finish(p,id,body.requestId,{entityId,href});
 }catch(e){throw proposalError(e);}
}
export async function cancelAssistantAction(p:Principal,id:string):Promise<AssistantProposal>{
 if(!idSchema.safeParse(id).success)throw new AppError(404,'Proposta não encontrada.');
 try{return await withWorkspaceTransaction(p,async c=>proposalView((await c.query("SELECT * FROM app.assistant_proposal_finish($1,'cancelled',NULL,NULL,NULL)",[id])).rows[0]));}
 catch(e){throw proposalError(e);}
}
// A confirmed draft is read back only by its owner, for the conversation it was written for.
export async function readAssistantDraft(p:Principal,id:string):Promise<{conversationId:string;text:string}>{
 if(!idSchema.safeParse(id).success)throw new AppError(404,'Rascunho não encontrado.');
 const r=await withWorkspaceTransaction(p,async c=>(await c.query("SELECT payload FROM app.assistant_proposal WHERE id=$1 AND kind='draft-reply' AND state='confirmed'",[id])).rows[0]);
 if(!r)throw new AppError(404,'Rascunho não encontrado.');
 return{conversationId:r.payload.conversationId,text:r.payload.text};
}
