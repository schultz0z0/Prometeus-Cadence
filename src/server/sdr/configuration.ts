import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {ConventionalRoute} from '../../domain/ai-routing.ts';
import {resolveAiRoute} from '../../domain/ai-routing.ts';
import {parseSdrOutput,sdrOutputJsonSchema,sdrPrompt,type SdrOutput} from '../../domain/sdr-turn.ts';
import {sdrBlockers,sdrDraftSchema,type SdrDraft,type SdrFacts} from '../../domain/sdr-policy.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {requirePermission} from '../auth/permissions.ts';
import {createReviewToken,hashValue,verifyReviewToken} from '../prospecting/review.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
import {runConventionalJson,type ConventionalContext} from '../prospecting/ai/json.ts';
// 07B.1: configuration, private knowledge, dry-run simulation and reviewed activation of SDR agents. Nothing here sends.
type Generate=(ctx:ConventionalContext,request:{prompt:string;schema:unknown;maxOutputTokens:number;parse:(raw:unknown)=>SdrOutput})=>Promise<{value:SdrOutput;usage:{provider:string}}>;
/** route lets tests stand in for the platform configuration; production resolves it from the workspace policy. */
export type SdrDeps={generate?:Generate;route?:ConventionalRoute|null;signal?:AbortSignal};
const failures:Record<string,[number,string]>={
 SDR_ACCESS:[403,'Seu papel não permite esta alteração.'],
 SDR_NOT_FOUND:[404,'Não encontrado neste workspace.'],
 SDR_CHANGED:[409,'Isto mudou desde que você abriu. Recarregue e revise de novo.'],
 SDR_LIMIT:[422,'Você chegou ao limite deste workspace (20 agentes, 200 itens de conhecimento).'],
 SDR_SIM_LIMIT:[429,'Você chegou ao limite de 30 simulações por dia neste workspace. Amanhã libera de novo.'],
 SDR_PLAN:[409,'O Agente SDR faz parte do plano Pro com assinatura ativa.'],
 SDR_CHANNEL:[409,'Um canal escolhido não está pronto para enviar e receber.'],
 SDR_CHANNEL_TAKEN:[409,'Um canal escolhido já é atendido por outro agente ativo.'],
 SDR_STATE:[409,'O agente não está ativo.'],
 SDR_INVALID:[422,'Operação inválida.'],
 SDR_POLICY:[409,'Esta configuração ainda não pode ser ativada. Revise de novo.'],
};
function sdrError(e:unknown){const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;}
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{throw sdrError(e);});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
const iso=(d:Date|null)=>d?d.toISOString():null;
const invalid=(e:z.ZodError)=>new AppError(422,e.issues[0]?.message&&!/^(Invalid|Too|Unrecognized|Expected)/.test(e.issues[0].message)?e.issues[0].message:'Revise os campos do agente.');
export interface SdrAgentView{id:string;revision:number;state:'draft'|'active'|'paused';name:string;draft:SdrDraft;activeRevision:number|null;activatedAt:string|null;pausedAt:string|null;pendingChanges:boolean}
export interface SdrKnowledgeView{id:string;revision:number;kind:'faq'|'note';title:string;body:string;state:'draft'|'approved'|'archived';approvedAt:string|null}
const agentView=(r:Record<string,any>):SdrAgentView=>({id:r.id,revision:Number(r.revision),state:r.state,name:r.name,draft:r.draft,activeRevision:r.active_revision==null?null:Number(r.active_revision),
 activatedAt:iso(r.activated_at),pausedAt:iso(r.paused_at),pendingChanges:r.state==='active'&&Number(r.revision)!==Number(r.active_revision)});
const knowledgeView=(r:Record<string,any>):SdrKnowledgeView=>({id:r.id,revision:Number(r.revision),kind:r.kind,title:r.title,body:r.body,state:r.state,approvedAt:iso(r.approved_at)});
async function channels(c:PoolClient){
 return (await c.query(`SELECT cc.id,cc.name,cc.channel,cc.provider,b.agent_id "agentId",a.name "agentName",
  (cc.state='ready' AND EXISTS(SELECT 1 FROM app.channel_sender s WHERE s.workspace_id=cc.workspace_id AND s.connection_id=cc.id AND s.ready)) ready
  FROM app.channel_connection cc LEFT JOIN app.sdr_channel_binding b ON b.workspace_id=cc.workspace_id AND b.connection_id=cc.id
  LEFT JOIN app.sdr_agent a ON a.workspace_id=b.workspace_id AND a.id=b.agent_id WHERE cc.archived_at IS NULL AND cc.channel='WHATSAPP' ORDER BY cc.name,cc.id`)).rows as {id:string;name:string;channel:string;provider:string;agentId:string|null;agentName:string|null;ready:boolean}[];
}
const contextVersion=async(c:PoolClient)=>(await c.query("SELECT max(version) v FROM app.context_version WHERE payload->>'approvedAt' IS NOT NULL")).rows[0].v as number|null;
export async function readSdr(p:Principal){return tx(p,async c=>{
 const role=(await c.query('SELECT app.current_role() r')).rows[0].r as string|null;if(!role)throw new AppError(403,failures.SDR_ACCESS[1]);
 const version=await contextVersion(c);
 return {entitled:(await c.query('SELECT app.sdr_entitled() v')).rows[0].v as boolean,canManage:['owner','admin'].includes(role),
  agents:(await c.query('SELECT * FROM app.sdr_agent ORDER BY created_at,id')).rows.map(agentView),channels:await channels(c),
  members:(await c.query('SELECT * FROM app.sdr_members()')).rows as {id:string;name:string;role:string}[],
  knowledge:(await c.query("SELECT * FROM app.sdr_knowledge WHERE state<>'archived' ORDER BY kind,title,id")).rows.map(knowledgeView),
  context:{approved:version!=null,version},
  simulationsLeft:Math.max(0,30-Number((await c.query("SELECT count(*) n FROM app.sdr_simulation WHERE created_at>clock_timestamp()-interval '1 day'")).rows[0].n))};
});}
const saveSchema=z.strictObject({id:z.string().min(1).max(200).optional(),expectedRevision:z.number().int().min(0),draft:z.unknown()});
export async function saveSdrAgent(p:Principal,raw:unknown):Promise<SdrAgentView>{
 requirePermission(p,'context.draft');
 const s=saveSchema.safeParse(raw);if(!s.success)throw new AppError(422,'Revise os campos do agente.');
 const d=sdrDraftSchema.safeParse(s.data.draft);if(!d.success)throw invalid(d.error);
 return tx(p,async c=>agentView((await c.query('SELECT * FROM app.sdr_save_agent($1,$2,$3,$4)',[s.data.id??null,s.data.expectedRevision,d.data.name,d.data])).rows[0]));
}
const knowledgeSchema=z.strictObject({id:z.string().min(1).max(200).optional(),expectedRevision:z.number().int().min(0),kind:z.enum(['faq','note']),title:z.string().trim().min(1).max(120),body:z.string().trim().min(1).max(4000)});
export async function saveSdrKnowledge(p:Principal,raw:unknown):Promise<SdrKnowledgeView>{
 requirePermission(p,'context.draft');
 const k=knowledgeSchema.safeParse(raw);if(!k.success)throw new AppError(422,'Escreva um título (até 120 caracteres) e um texto (até 4.000).');
 return tx(p,async c=>knowledgeView((await c.query('SELECT * FROM app.sdr_save_knowledge($1,$2,$3,$4,$5)',[k.data.id??null,k.data.expectedRevision,k.data.kind,k.data.title,k.data.body])).rows[0]));
}
const stateSchema=z.strictObject({id:z.string().min(1).max(200),expectedRevision:z.number().int().min(1),state:z.enum(['draft','approved','archived'])});
export async function setSdrKnowledgeState(p:Principal,raw:unknown):Promise<SdrKnowledgeView>{
 const k=stateSchema.safeParse(raw);if(!k.success)throw new AppError(422,failures.SDR_INVALID[1]);
 requirePermission(p,k.data.state==='approved'?'context.approve':'context.draft');
 return tx(p,async c=>knowledgeView((await c.query('SELECT * FROM app.sdr_set_knowledge_state($1,$2,$3)',[k.data.id,k.data.expectedRevision,k.data.state])).rows[0]));
}
async function lockedAgent(c:PoolClient,id:string){
 const r=(await c.query('SELECT * FROM app.sdr_agent WHERE id=$1',[id])).rows[0];if(!r)throw new AppError(404,failures.SDR_NOT_FOUND[1],'SDR_NOT_FOUND');return r;
}
// ---- Simulation (dry run): the draft answers one sample message; nothing is stored as a message or sent.
const simSchema=z.strictObject({agentId:z.string().min(1).max(200),incoming:z.string().trim().min(1).max(1000)});
async function aiRoute(c:PoolClient,p:Principal,deps:SdrDeps){
 if(deps.route!==undefined)return deps.route;
 const policy=await readAiPolicy(c),resolved=resolveAiRoute({...policy,mode:'conventional-only',jevEnabled:false},conventionalConfig(p.workspaceId),null);
 return resolved.route&&resolved.route.conventional.provider!=='codex-local'?resolved.route.conventional:null;
}
export async function simulateSdr(p:Principal,raw:unknown,deps:SdrDeps={}){
 requirePermission(p,'context.draft');
 const s=simSchema.safeParse(raw);if(!s.success)throw new AppError(422,'Escreva a mensagem de exemplo (até 1.000 caracteres).');
 const ctx=await tx(p,async c=>{
  const a=await lockedAgent(c,s.data.agentId),draft=sdrDraftSchema.parse(a.draft),route=await aiRoute(c,p,deps);
  if(!route)throw new AppError(503,'A IA não está disponível agora para simular. Tente mais tarde.');
  const left=(await c.query('SELECT app.sdr_reserve_simulation($1) n',[a.id])).rows[0].n as number;
  const knowledge=draft.knowledgeIds.length?(await c.query("SELECT kind,title,body FROM app.sdr_knowledge WHERE id=ANY($1) AND state<>'archived' ORDER BY title",[draft.knowledgeIds])).rows:[];
  const context=(await c.query("SELECT payload FROM app.context_version WHERE payload->>'approvedAt' IS NOT NULL ORDER BY version DESC LIMIT 1")).rows[0]?.payload??null;
  return {draft,route,left,prompt:sdrPrompt({draft,context,knowledge,incoming:s.data.incoming})};
 });
 const fields=ctx.draft.qualification.map(q=>q.field),signal=AbortSignal.any([AbortSignal.timeout(60000),...(deps.signal?[deps.signal]:[])]);
 let out:SdrOutput;
 try{out=(await(deps.generate??runConventionalJson)({operationId:'sdr-simulation:'+randomUUID(),workspaceId:p.workspaceId,signal,route:ctx.route},
  {prompt:ctx.prompt,schema:sdrOutputJsonSchema,maxOutputTokens:4096,parse:v=>parseSdrOutput(v,fields)})).value;}
 catch{throw new AppError(502,'A IA não respondeu à simulação. Tente de novo.');}
 return {reply:out.reply,decision:out.decision,fields:out.fields,sent:false as const,remaining:ctx.left};
}
// ---- Activation (review → confirm) and pause.
const prepareSchema=z.strictObject({agentId:z.string().min(1).max(200),revision:z.number().int().min(1)});
const confirmSchema=prepareSchema.extend({token:z.string().min(1).max(8192),requestId:z.uuid()});
async function activationState(c:PoolClient,p:Principal,agentId:string,revision:number){
 const a=await lockedAgent(c,agentId);if(Number(a.revision)!==revision)throw new AppError(409,failures.SDR_CHANGED[1],'SDR_CHANGED');
 const draft=sdrDraftSchema.parse(a.draft),version=await contextVersion(c),chs=await channels(c),members=(await c.query('SELECT * FROM app.sdr_members()')).rows as {id:string;name:string}[];
 const knowledge=draft.knowledgeIds.length?(await c.query('SELECT id,state,revision::int FROM app.sdr_knowledge WHERE id=ANY($1) ORDER BY id',[draft.knowledgeIds])).rows as {id:string;state:string;revision:number}[]:[];
 const facts:SdrFacts={pro:(await c.query('SELECT app.sdr_entitled() v')).rows[0].v,contextApproved:version!=null,
  // Only the chosen channels: an unrelated channel changing does not void the review.
  channels:chs.filter(x=>draft.channelIds.includes(x.id)).map(x=>({id:x.id,ready:x.ready,provider:x.provider,takenBy:x.agentId&&x.agentId!==agentId?x.agentName:null})),
  handoffIsMember:members.some(m=>m.id===draft.handoff.memberId),knowledge};
 const chosen=draft.channelIds.map(id=>chs.find(x=>x.id===id)).filter(x=>!!x);
 const summary={name:draft.name,channels:chosen.map(x=>({id:x.id,name:x.name,channel:x.channel,provider:x.provider})),hours:draft.hours,maxRepliesPerDay:draft.maxRepliesPerDay,
  approvalMode:draft.approvalMode,questions:draft.qualification.length,handoff:{member:members.find(m=>m.id===draft.handoff.memberId)?.name??null,rules:draft.handoff.rules.length},knowledge:draft.knowledgeIds.length,contextVersion:version};
 const proof={purpose:'sdr-activation',userId:p.userId,workspaceId:p.workspaceId,agentId,revision,config:hashValue(draft),contextVersion:version,facts};
 return {agent:a,draft,version,blockers:sdrBlockers(draft,facts),summary,proof};
}
export async function prepareSdrActivation(p:Principal,raw:unknown){
 requirePermission(p,'workspace.settings');
 const i=prepareSchema.safeParse(raw);if(!i.success)throw new AppError(422,failures.SDR_INVALID[1]);
 return tx(p,async c=>{const s=await activationState(c,p,i.data.agentId,i.data.revision),now=Date.now();
  return {agentId:i.data.agentId,revision:i.data.revision,summary:s.summary,blockers:s.blockers,token:createReviewToken(s.proof,secret(),now),expiresAt:new Date(now+600000).toISOString(),
   warnings:['O agente nasce pedindo o seu ok antes de cada resposta.','Ativar não envia nada: a cada mensagem recebida, o agente prepara um rascunho e espera a sua aprovação na caixa do WhatsApp.']};});
}
export async function confirmSdrActivation(p:Principal,raw:unknown):Promise<SdrAgentView>{
 requirePermission(p,'workspace.settings');
 const i=confirmSchema.safeParse(raw);if(!i.success)throw new AppError(422,'Revise a ativação antes de confirmar.');
 return tx(p,async c=>{
  const current=await lockedAgent(c,i.data.agentId);
  if(current.state==='active'&&current.activation_request===i.data.requestId&&Number(current.active_revision)===i.data.revision)return agentView(current);
  const s=await activationState(c,p,i.data.agentId,i.data.revision);
  verifyReviewToken(i.data.token,s.proof,secret());
  if(s.blockers.length)throw new AppError(409,s.blockers[0],'SDR_BLOCKED');
  return agentView((await c.query('SELECT * FROM app.sdr_activate($1,$2,$3,$4)',[i.data.agentId,i.data.revision,s.version,i.data.requestId])).rows[0]);
 });
}
const pauseSchema=z.strictObject({agentId:z.string().min(1).max(200),expectedRevision:z.number().int().min(1)});
export async function pauseSdrAgent(p:Principal,raw:unknown):Promise<SdrAgentView>{
 requirePermission(p,'workspace.settings');
 const i=pauseSchema.safeParse(raw);if(!i.success)throw new AppError(422,failures.SDR_INVALID[1]);
 return tx(p,async c=>agentView((await c.query('SELECT * FROM app.sdr_pause($1,$2)',[i.data.agentId,i.data.expectedRevision])).rows[0]));
}
