import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {requirePermission} from '../auth/permissions.ts';
import {createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {cancelCalendarReservation,readCalendarSlots,reserveCalendarSlot,type CalendarDeps} from '../integrations/calendar.ts';
// 07B.3: a person acts on the agent's suggestions. The calendar service owns slots, double booking and uncertain outcomes.
const failures:Record<string,[number,string]>={
 SDR_ACCESS:[403,'Você não tem mais acesso a este workspace.'],
 SDR_NOT_FOUND:[404,'Não encontrado nesta conversa.'],
 SDR_STATE:[409,'A conversa mudou. Recarregue e tente de novo.'],
 SDR_QUOTE:[422,'A autorização precisa ser o trecho que o agente identificou na mensagem do contato.'],
 SDR_FOLLOWUP_META:[409,'No WhatsApp oficial o retorno exige um template aprovado, que ainda não está disponível aqui.'],
 SDR_FOLLOWUP_OFF:[409,'O agente desta conversa não está com o follow-up ligado.'],
 SDR_BOOKING_ACTIVE:[409,'Esta conversa já tem uma reunião. Cancele antes de marcar outra.'],
};
const sdrError=(e:unknown)=>{const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{throw sdrError(e);});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
async function conversation(c:PoolClient,id:string){
 const r=(await c.query(`SELECT cc.lead_id,l.payload->>'name' lead,EXISTS(SELECT 1 FROM app.contact_suppression s WHERE s.workspace_id=cc.workspace_id AND s.identity_id=cc.identity_id AND s.scope IN('all','service')) suppressed
  FROM app.channel_conversation cc LEFT JOIN app.lead l ON l.workspace_id=cc.workspace_id AND l.id=cc.lead_id WHERE cc.id=$1`,[id])).rows[0];
 if(!r)throw new AppError(404,failures.SDR_NOT_FOUND[1],'SDR_NOT_FOUND');return r as {lead_id:string|null;lead:string|null;suppressed:boolean};
}
export async function sdrSlots(p:Principal,id:string,deps:CalendarDeps={}){
 requirePermission(p,'messages.reply');
 await tx(p,c=>conversation(c,id));
 try{return await readCalendarSlots(p,{},deps);}
 catch(e){if(e instanceof AppError&&e.status===404)throw new AppError(409,'Conecte o Google Agenda em Configurações → CRM e apps para ver os horários.','CALENDAR_SETUP');throw e;}
}
const slotSchema=z.string().min(20).max(2000),prepareSchema=z.strictObject({slotId:slotSchema}),confirmSchema=prepareSchema.extend({token:z.string().min(1).max(8192),requestId:z.uuid()});
async function bookingState(c:PoolClient,p:Principal,id:string,slotId:string,requestId:string|null){
 const r=await conversation(c,id),blockers:string[]=[];
 if(!r.lead_id)blockers.push('Vincule esta conversa a um contato antes de marcar a reunião.');
 if(r.suppressed)blockers.push('Este contato pediu para não receber mensagens.');
 if((await c.query('SELECT app.sdr_booking_active($1,$2) v',[id,requestId])).rows[0].v)blockers.push('Esta conversa já tem uma reunião. Cancele antes de marcar outra.');
 return {leadId:r.lead_id,lead:r.lead,blockers,proof:{purpose:'sdr-booking',userId:p.userId,workspaceId:p.workspaceId,conversationId:id,slotId,leadId:r.lead_id}};
}
export async function prepareSdrBooking(p:Principal,id:string,raw:unknown){
 requirePermission(p,'messages.reply');
 const b=prepareSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Escolha um horário.');
 return tx(p,async c=>{const s=await bookingState(c,p,id,b.data.slotId,null);return {lead:s.lead,blockers:s.blockers,token:createReviewToken(s.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString()};});
}
async function reserve(p:Principal,id:string,slotId:string,leadId:string,requestId:string,deps:CalendarDeps,invite?:{attendeeEmail?:string|null;meet:boolean}){
 try{return await reserveCalendarSlot(p,{slotId,leadId,requestId},deps,invite);}
 // Refused before any reservation existed: nothing is in flight. An uncertain reservation stays.
 catch(e){await tx(p,c=>c.query('SELECT app.sdr_booking_abort($1,$2)',[id,requestId])).catch(()=>{});throw e;}
}
export async function confirmSdrBooking(p:Principal,id:string,raw:unknown,deps:CalendarDeps={}){
 requirePermission(p,'messages.reply');
 const b=confirmSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Revise a reunião antes de confirmar.');const {slotId,token,requestId}=b.data;
 const leadId=await tx(p,async c=>{
  const s=await bookingState(c,p,id,slotId,requestId);verifyReviewToken(token,s.proof,secret());
  if(s.blockers.length)throw new AppError(409,s.blockers[0],'SDR_BOOKING_BLOCKED');
  await c.query('SELECT app.sdr_booking_begin($1,$2,$3,$4)',[id,requestId,s.leadId,slotId]);return s.leadId!;
 });
 return reserve(p,id,slotId,leadId,requestId,deps);
}
/** An uncertain booking asks the calendar again with the same request: it finds the event or creates it once. */
export async function recheckSdrBooking(p:Principal,id:string,deps:CalendarDeps={}){
 requirePermission(p,'messages.reply');
 const a=await tx(p,async c=>{
  const r=await conversation(c,id),v=(await c.query('SELECT app.sdr_booking_view($1) v',[id])).rows[0].v as {id:string;start:string;end:string;state:'prepared'|'accepted'|'uncertain'|'cancelled'|'failed';revision:number;timezone:string}|null;
  const row=(await c.query('SELECT request_id,lead_id,slot_id FROM app.sdr_business_action WHERE conversation_id=$1 ORDER BY created_at DESC,id LIMIT 1',[id])).rows[0];
  if(!v||!row)throw new AppError(404,failures.SDR_NOT_FOUND[1],'SDR_NOT_FOUND');
  return {r,v,row};
 });
 // Settled: answer locally. Open: never create at a past time or for a contact who opted out meanwhile; cancelling is the way out.
 if(!['prepared','uncertain'].includes(a.v.state))return {...a.v,connectionId:'',leadId:a.row.lead_id,externalId:null};
 if(a.r.suppressed||Date.parse(a.v.start)<=Date.now())throw new AppError(409,'Este horário não pode mais ser confirmado. Cancele a reunião para liberar a conversa.','SDR_BOOKING_STALE');
 return reserveCalendarSlot(p,{slotId:a.row.slot_id,leadId:a.row.lead_id,requestId:a.row.request_id},deps);
}
const cancelSchema=z.strictObject({reservationId:z.uuid(),expectedRevision:z.number().int().min(1)});
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
/** 16/11/2026: approving the agent's confirmation books the slot the lead chose, with the lead invited and a Meet link. Event first, message after. */
export async function bookSdrProposal(p:Principal,id:string,turnId:string,requestId:string,deps:CalendarDeps={}):Promise<{start:string;end:string;meetUrl:string|null}>{
 requirePermission(p,'messages.reply');
 const proposal=await tx(p,async c=>(await c.query('SELECT proposal FROM app.sdr_turn WHERE id=$1 AND conversation_id=$2',[turnId,id])).rows[0]?.proposal) as {kind:string;slot?:{start:string;end:string}}|undefined;
 if(proposal?.kind!=='meeting'||!proposal.slot)throw new AppError(409,failures.SDR_STATE[1],'SDR_STATE');
 const free=await readCalendarSlots(p,{from:proposal.slot.start,to:proposal.slot.end},deps),slot=free.slots.find(x=>x.start===proposal.slot!.start);
 if(!slot)throw new AppError(409,'Este horário acabou de ser ocupado. O agente vai oferecer outros.','SLOT_TAKEN');
 const s=await tx(p,async c=>{
  const st=await bookingState(c,p,id,slot.id,requestId);if(st.blockers.length)throw new AppError(409,st.blockers[0],'SDR_BOOKING_BLOCKED');
  await c.query('SELECT app.sdr_booking_begin($1,$2,$3,$4)',[id,requestId,st.leadId,slot.id]);
  const email=String((await c.query("SELECT payload->>'email' e FROM app.lead WHERE id=$1",[st.leadId])).rows[0]?.e??'').trim();
  return {leadId:st.leadId!,email:EMAIL.test(email)?email:null};
 });
 const booked=await reserve(p,id,slot.id,s.leadId,requestId,deps,{attendeeEmail:s.email,meet:true});
 if(booked.state==='accepted')await tx(p,c=>c.query('SELECT app.sdr_set_stage($1,$2)',[id,'done']));
 return {start:booked.start,end:booked.end,meetUrl:(booked as {meetUrl?:string|null}).meetUrl??null};
}
export async function cancelSdrBooking(p:Principal,id:string,raw:unknown,deps:CalendarDeps={}){
 requirePermission(p,'messages.reply');
 const b=cancelSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Operação inválida.');
 const current=await tx(p,async c=>(await c.query('SELECT app.sdr_booking_view($1) v',[id])).rows[0].v as {id:string}|null);
 if(current?.id!==b.data.reservationId)throw new AppError(404,failures.SDR_NOT_FOUND[1],'SDR_NOT_FOUND');
 const r=await cancelCalendarReservation(p,b.data.reservationId,{expectedRevision:b.data.expectedRevision},deps);
 // A cancelled meeting reopens the conversation for a new offer.
 await tx(p,c=>c.query('SELECT app.sdr_set_stage($1,$2)',[id,'qualified']));
 return r;
}
const consentSchema=z.strictObject({turnId:z.uuid(),quote:z.string().min(3).max(500),days:z.number().int().min(1).max(30)});
export async function recordSdrFollowup(p:Principal,id:string,raw:unknown){
 requirePermission(p,'consents.manage');
 const b=consentSchema.safeParse(raw);if(!b.success)throw new AppError(422,'A autorização vale de 1 a 30 dias e precisa do trecho da mensagem.');
 return tx(p,async c=>{const f=(await c.query('SELECT * FROM app.sdr_followup_record($1,$2,$3,$4)',[id,b.data.turnId,b.data.quote,b.data.days])).rows[0];return {id:f.id as string,expiresAt:f.expires_at as Date};});
}
const revokeSchema=z.strictObject({id:z.uuid()});
export async function revokeSdrFollowup(p:Principal,id:string,raw:unknown){
 requirePermission(p,'messages.reply');
 const b=revokeSchema.safeParse(raw);if(!b.success)throw new AppError(422,'Operação inválida.');
 await tx(p,c=>c.query('SELECT app.sdr_followup_revoke($1,$2)',[id,b.data.id]));
 return {state:'ended'};
}
