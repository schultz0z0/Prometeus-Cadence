import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {SdrProposal} from '../../domain/sdr-turn.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {requirePermission} from '../auth/permissions.ts';
import {prepareReply,confirmReply,type ReplyHooks} from '../messaging/replies.ts';
import {createHash} from 'node:crypto';
import {slotLabel,type SdrOffer,type SdrStage} from '../../domain/sdr-stage.ts';
import type {CalendarDeps} from '../integrations/calendar.ts';
// 07B.2: what a person does with the agent inside the existing inbox. The reply itself goes through the reviewed WhatsApp path.
const failures:Record<string,[number,string]>={
 SDR_ACCESS:[403,'Você não tem mais acesso a este workspace.'],
 SDR_NOT_FOUND:[404,'Não encontrado nesta conversa.'],
 SDR_CHANGED:[409,'A conversa mudou. Recarregue e tente de novo.'],
 SDR_STATE:[409,'Esta resposta já não está esperando o seu ok.'],
 SDR_FOLLOWUP_TOO_SOON:[409,'Já saiu uma mensagem nas últimas 24 horas. O retorno precisa esperar esse intervalo.'],
};
const sdrError=(e:unknown)=>{const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,async c=>{
 if(!(await c.query('SELECT app.current_role() r')).rows[0].r)throw new AppError(403,failures.SDR_ACCESS[1]);return fn(c);
}).catch(e=>{throw sdrError(e);});
export interface SdrTurnView{id:string;state:string;text:string|null;fields:{field:string;value:string}[];reason:string|null;messageId:string|null;createdAt:string;proposal:SdrProposal|null;followupAttempt:number;sources:{id:string;documentId:string;title:string;label:string}[];alerts:{kind:'unsourced-value';value:string}[]}
const turnView=(r:Record<string,any>):SdrTurnView=>({id:r.id,state:r.state,text:r.text,fields:r.fields,reason:r.reason,messageId:r.message_id,createdAt:r.created_at.toISOString(),proposal:r.proposal,followupAttempt:r.followup_attempt,sources:r.sources??[],alerts:r.alerts??[]});
export async function readSdrConversation(p:Principal,id:string){return tx(p,async c=>{
 const cc=(await c.query('SELECT connection_id,lead_id,lead_link_evidence FROM app.channel_conversation WHERE id=$1',[id])).rows[0];if(!cc)throw new AppError(404,failures.SDR_NOT_FOUND[1]);
 const thread=(await c.query('SELECT owner,revision,stage,offer,conflicts FROM app.sdr_thread_state WHERE conversation_id=$1',[id])).rows[0];
 // How the conversation got its lead: by the agent (same number, or a new lead) or by a person.
 const leadLink:'linked'|'created'|'manual'|null=!cc.lead_id?null:cc.lead_link_evidence?.actorId!=='sdr'?'manual':String(cc.lead_link_evidence?.evidence).startsWith('lead criado')?'created':'linked';
 const agent=(await c.query(`SELECT a.id,a.name,app.sdr_within_hours(r.config->'hours',clock_timestamp()) in_hours,app.sdr_connection_in_service(b.connection_id) in_service,(r.config->>'followupEnabled')::boolean AND cn.provider='openwa' followup FROM app.sdr_channel_binding b JOIN app.sdr_agent a ON a.workspace_id=b.workspace_id AND a.id=b.agent_id
  JOIN app.sdr_agent_revision r ON r.workspace_id=b.workspace_id AND r.agent_id=b.agent_id AND r.revision=b.revision JOIN app.channel_connection cn ON cn.workspace_id=b.workspace_id AND cn.id=b.connection_id WHERE b.connection_id=$1`,[cc.connection_id])).rows[0];
 const turn=(await c.query('SELECT * FROM app.sdr_turn WHERE conversation_id=$1 ORDER BY created_at DESC,id LIMIT 1',[id])).rows[0];
 const booking=(await c.query('SELECT app.sdr_booking_view($1) v',[id])).rows[0].v as {id:string;start:string;end:string;state:string;revision:number;timezone:string;meetUrl:string|null}|null;
 const followup=(await c.query("SELECT id,quote,attempts,next_at,expires_at FROM app.sdr_followup WHERE conversation_id=$1 AND state='active'",[id])).rows[0];
 return {booking,stage:(thread?.stage??'qualifying') as SdrStage,offer:(thread?.offer??null) as SdrOffer|null,conflicts:(thread?.conflicts??[]) as {field:string;value:string;current:string}[],leadLink,leadId:(cc.lead_id??null) as string|null,
  followup:followup?{id:followup.id as string,quote:followup.quote as string,attempts:followup.attempts as number,nextAt:followup.next_at.toISOString() as string,expiresAt:followup.expires_at.toISOString() as string}:null,
  agent:agent?{id:agent.id as string,name:agent.name as string,withinHours:agent.in_hours as boolean,inService:agent.in_service as boolean,followupAvailable:agent.followup as boolean}:null,canConsent:['owner','admin'].includes((await c.query('SELECT app.current_role() r')).rows[0].r),owner:(thread?.owner??'agent') as 'agent'|'human',revision:Number(thread?.revision??0),turn:turn?turnView(turn):null};
});}
const conflictSchema=z.strictObject({field:z.enum(['email','phone','companyName'])});
/** A person applies the value the lead gave to the lead record. */
export async function applySdrConflict(p:Principal,id:string,raw:unknown){
 requirePermission(p,'messages.reply');
 const b=conflictSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Campo inválido.');
 await tx(p,c=>c.query('SELECT app.sdr_apply_conflict($1,$2)',[id,b.data.field]));
 return readSdrConversation(p,id);
}
export async function listSdrPending(p:Principal){return tx(p,async c=>({items:(await c.query(`SELECT t.id,t.conversation_id "conversationId",t.state,t.text,t.created_at "createdAt",coalesce(nullif(l.payload->>'name',''),i.phone,'Contato') contact
  FROM app.sdr_turn t JOIN app.channel_conversation cc ON cc.workspace_id=t.workspace_id AND cc.id=t.conversation_id JOIN app.channel_identity i ON i.workspace_id=cc.workspace_id AND i.id=cc.identity_id
  LEFT JOIN app.lead l ON l.workspace_id=cc.workspace_id AND l.id=cc.lead_id WHERE t.state IN('pending-approval','uncertain') ORDER BY t.created_at LIMIT 50`)).rows as {id:string;conversationId:string;state:string;text:string|null;createdAt:string;contact:string}[]}));}
const revisionSchema=z.strictObject({expectedRevision:z.number().int().min(0)});
async function setOwner(p:Principal,id:string,raw:unknown,owner:'agent'|'human'){
 requirePermission(p,'messages.reply');
 const b=revisionSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Recarregue a conversa.');
 return tx(p,async c=>({owner,revision:Number((await c.query('SELECT app.sdr_set_owner($1,$2,$3) v',[id,owner,b.data.expectedRevision])).rows[0].v)}));
}
export const takeOverSdr=(p:Principal,id:string,raw:unknown)=>setOwner(p,id,raw,'human');
export const resumeSdr=(p:Principal,id:string,raw:unknown)=>setOwner(p,id,raw,'agent');
/** A manual reply from the inbox: the person took the conversation, atomically with the enqueue. Approvals do not use this. */
export const manualReplyHooks=(id:string):ReplyHooks=>({after:c=>c.query('SELECT app.sdr_note_human_reply($1)',[id])});
const turnSchema=z.strictObject({turnId:z.uuid()});
export async function retrySdrTurn(p:Principal,id:string,raw:unknown){
 requirePermission(p,'messages.reply');
 const b=turnSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Turno inválido.');
 await tx(p,c=>ownTurn(c,id,b.data.turnId).then(()=>c.query('SELECT app.sdr_retry_turn($1)',[b.data.turnId])));
 return {state:'queued'};
}
async function ownTurn(c:PoolClient,conversation:string,turn:string){
 const r=(await c.query('SELECT * FROM app.sdr_turn WHERE id=$1 AND conversation_id=$2',[turn,conversation])).rows[0];if(!r)throw new AppError(404,failures.SDR_NOT_FOUND[1],'SDR_NOT_FOUND');return r;
}
export async function rejectSdrReply(p:Principal,id:string,raw:unknown){
 requirePermission(p,'messages.reply');
 const b=turnSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Turno inválido.');
 return tx(p,async c=>{await ownTurn(c,id,b.data.turnId);return turnView((await c.query('SELECT * FROM app.sdr_reject_turn($1)',[b.data.turnId])).rows[0]);});
}
const textSchema=z.string().trim().min(1).max(4096),prepareSchema=z.strictObject({turnId:z.uuid(),text:textSchema});
export async function prepareSdrReply(p:Principal,id:string,raw:unknown){
 requirePermission(p,'messages.reply');
 const b=prepareSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Escreva a resposta.');
 await tx(p,async c=>{if((await ownTurn(c,id,b.data.turnId)).state!=='pending-approval')throw new AppError(409,failures.SDR_STATE[1],'SDR_STATE');});
 return {review:await prepareReply(p,id,{content:{kind:'text',text:b.data.text}})};
}
const approveSchema=prepareSchema.extend({reviewToken:z.string().min(1).max(8192),requestId:z.uuid()});
/** The reviewed confirmation must still say the booked day (dd/mm) and time (HH:MM or 9h). */
function mentionsSlot(text:string,start:string,tz:string){
 const m=/(\d{2}\/\d{2}).*?(\d{2}):(\d{2})/.exec(slotLabel(start,tz));if(!m)return false;
 const h=String(Number(m[2])),times=[`${m[2]}:${m[3]}`,`${h}:${m[3]}`,m[3]==='00'?`${h}h`:`${h}h${m[3]}`];
 return text.includes(m[1])&&times.some(t=>new RegExp('(^|\\D)'+t.replace(':','\\:')+'(?!\\d)').test(text));
}
const bookingRequest=(requestId:string)=>{const h=createHash('sha256').update('sdr-booking:'+requestId).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
export async function approveSdrReply(p:Principal,id:string,raw:unknown,deps:CalendarDeps={}):Promise<SdrTurnView>{
 requirePermission(p,'messages.reply');
 const b=approveSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Revise a resposta antes de aprovar.');
 const {turnId,text,reviewToken,requestId}=b.data;
 // A meeting the lead chose is booked before the confirmation is queued; a taken slot or a text without the date stops both.
 // A meeting is booked only while the turn still waits for approval; a replay or a stale turn goes straight to the reply, which decides.
 const pending=await tx(p,async c=>{const t=await ownTurn(c,id,turnId);if(t.state!=='pending-approval')return null;await c.query('SELECT app.sdr_check_approval($1)',[turnId]);return t.proposal as SdrProposal|null;});
 const proposal=pending;
 if(proposal?.kind==='meeting'){
  if(!mentionsSlot(text,proposal.slot.start,proposal.timezone))throw new AppError(422,'O texto não traz mais a data e a hora da reunião marcada. Revise antes de aprovar.');
  const {bookSdrProposal}=await import('./business-actions.ts');
  await bookSdrProposal(p,id,turnId,bookingRequest(requestId),deps);
 }
 // One transaction: the turn is checked, the message queued and the unit consumed together. A replay of the same request skips the hooks.
 try{await confirmReply(p,id,{content:{kind:'text',text},requestId,reviewToken},{before:async c=>{await ownTurn(c,id,turnId);await c.query('SELECT app.sdr_check_approval($1)',[turnId]);},after:(c,m)=>c.query('SELECT app.sdr_approve_turn($1,$2,$3)',[turnId,m.id,text])});}
 catch(e){throw sdrError(e);}
 if(proposal?.kind==='meeting')await (await import('./business-actions.ts')).scheduleSdrReminders(p,id);
 return tx(p,async c=>turnView(await ownTurn(c,id,turnId)));
}
