import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {calendarSetupSchema,cancelReservationSchema,candidateSlots,freeSlots,reserveSchema,slotQuerySchema,type CalendarConfig,type CalendarReservationView,type CalendarSlot} from '../../domain/connector-capabilities.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {decryptCredential,encryptCredential,type EncryptedCredential} from '../channels/crypto.ts';
import {connectorError} from './connections.ts';
import {GoogleAttention,GoogleRequestError,GoogleRetry,finishGoogleAuthorization,google,googleAad,googleCallbackHttp,openTokens,sealTokens,startGoogleAuthorization,withAccess,type GoogleDeps} from './google.ts';
export {CALENDAR_SCOPES} from './google.ts';
const KIND='google-calendar',API='https://www.googleapis.com/calendar/v3',SLOT_TTL=300000,MAX_RANGE=14*86400000;
const texts={missing:'A agenda principal não foi encontrada. Reconecte a conta Google.',forbidden:'A conta Google perdeu acesso à agenda. Reconecte a conta Google.'};
export type CalendarDeps=GoogleDeps;
const failures:Record<string,[number,string]>={
 CALENDAR_ACCESS:[403,'Somente proprietário, administrador ou operador consulta e reserva horários.'],
 CONNECTION_CHANGED:[409,'A agenda mudou. Consulte os horários de novo.'],
 SLOT_EXPIRED:[409,'Este horário venceu. Consulte os horários de novo.'],
 SLOT_TAKEN:[409,'Este horário acabou de ser reservado. Escolha outro.'],
 REQUEST_REUSED:[409,'Este pedido já foi usado para outra reserva.'],
 RESERVATION_CHANGED:[409,'A reserva mudou em outra aba. Recarregue antes de continuar.'],
 LEAD_NOT_FOUND:[404,'Lead não encontrado.'],
};
const calendarError=(e:unknown)=>{
 const k=e instanceof Error?failures[e.message]:undefined;if(k)return new AppError(k[0],k[1],e instanceof Error?e.message:undefined);
 if(e instanceof GoogleAttention)return new AppError(e.attention==='reconnect'?409:422,e.message,'CALENDAR_'+e.attention.toUpperCase());
 if(e instanceof GoogleRetry)return new AppError(503,e.message+' Tente de novo em instantes.','CALENDAR_UNAVAILABLE');
 return connectorError(e);
};

// --- OAuth ---
export const startCalendarAuthorization=(p:Principal,sessionId:string)=>startGoogleAuthorization(KIND,p,sessionId);
export const finishCalendarAuthorization=(p:Principal,sessionId:string,url:URL,deps:CalendarDeps={})=>finishGoogleAuthorization(KIND,p,sessionId,url,deps);
export const calendarCallbackHttp=(request:Request,deps:CalendarDeps={})=>googleCallbackHttp(KIND,request,deps);

// --- Access to the customer's grant, for this request only ---
type Access={id:string;revision:number;state:string;config:CalendarConfig|null;configRevision:number;attention:string|null;secret:EncryptedCredential};
const access=(p:Principal)=>withWorkspaceTransaction(p,async c=>{const a=(await c.query('SELECT app.calendar_access() v')).rows[0].v;return{...a,revision:Number(a.revision),configRevision:Number(a.configRevision)} as Access;});
async function call<T>(p:Principal,a:Access,fn:(token:string)=>Promise<T>,deps:CalendarDeps):Promise<T>{
 try{
  const tokens=openTokens(KIND,a.secret,p.workspaceId,a.id,a.revision);
  return await withAccess(KIND,tokens,t=>withWorkspaceTransaction(p,c=>c.query('SELECT app.save_calendar_tokens($1,$2,$3,$4)',[a.id,a.revision,sealTokens(KIND,t,p.workspaceId,a.id,a.revision),t.expiresAt])),fn,deps);
 }catch(e){
  // The grant itself failed: the page shows the reconnect action until a person fixes it.
  if(e instanceof GoogleAttention)await withWorkspaceTransaction(p,c=>c.query('SELECT app.calendar_attention($1,$2,$3,$4)',[a.id,a.revision,e.attention,e.message]));
  throw e;
 }
}
async function busy(token:string,config:Pick<CalendarConfig,'calendarId'|'timezone'>,from:number,to:number,deps:CalendarDeps){
 const d=await google('POST',`${API}/freeBusy`,token,{timeMin:new Date(from).toISOString(),timeMax:new Date(to).toISOString(),timeZone:config.timezone,items:[{id:config.calendarId}]},deps,texts);
 const cal=d?.calendars?.[config.calendarId]??Object.values(d?.calendars??{})[0] as any;
 if(!cal)throw new GoogleRetry('O Google não devolveu a disponibilidade.');
 if(Array.isArray(cal.errors)&&cal.errors.length)throw cal.errors.some((x:any)=>x?.reason==='notFound')?new GoogleAttention('missing',texts.missing):new GoogleRetry('O Google não devolveu a disponibilidade.');
 return(Array.isArray(cal.busy)?cal.busy:[]).map((b:any)=>({start:Date.parse(b.start),end:Date.parse(b.end)})).filter((b:{start:number;end:number})=>Number.isFinite(b.start)&&Number.isFinite(b.end));
}
const eventUrl=(calendarId:string,eventId?:string)=>`${API}/calendars/${encodeURIComponent(calendarId)}/events`+(eventId?'/'+eventId:'');
async function findEvent(token:string,calendarId:string,eventId:string,deps:CalendarDeps){
 try{const e=await google('GET',eventUrl(calendarId,eventId),token,undefined,deps,texts);return e&&e.status!=='cancelled'?e:null;}
 catch(err){if(err instanceof GoogleAttention&&err.attention==='missing')return null;throw err;}
}

// --- Availability (owner/admin) ---
export async function configureCalendar(p:Principal,raw:unknown,deps:CalendarDeps={}){
 const parsed=calendarSetupSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Revise o fuso, os dias, o horário e a duração.');
 const {expectedRevision,...rules}=parsed.data,config:CalendarConfig={calendarId:'primary',...rules};
 try{
  await withWorkspaceTransaction(p,c=>c.query('SELECT app.connector_actor()'));
  const a=await access(p);
  if(a.configRevision!==expectedRevision)throw new AppError(409,'A conexão mudou em outra aba. Recarregue antes de continuar.','CONNECTION_CONFLICT');
  // Saving proves the grant reaches the calendar.
  const now=(deps.now??Date.now)();await call(p,a,t=>busy(t,config,now,now+86400000,deps),deps);
  const configRevision=await withWorkspaceTransaction(p,async c=>Number((await c.query('SELECT app.configure_calendar($1,$2,$3,$4) v',[a.id,a.revision,expectedRevision,config])).rows[0].v));
  return{config,configRevision};
 }catch(e){throw calendarError(e);}
}

// --- Slots and reservations (owner, admin or operator) ---
// A slot id is sealed with this workspace's AAD: it cannot be read, forged or replayed elsewhere, and it names the reviewed configuration.
type Slot={c:string;r:number;v:number;s:number;e:number;z:string;x:number};
const slotAad=(workspaceId:string)=>googleAad(KIND,workspaceId,'slot',0);
const sealSlot=(workspaceId:string,v:Slot)=>Buffer.from(JSON.stringify(encryptCredential(Object.fromEntries(Object.entries(v).map(([k,x])=>[k,String(x)])),slotAad(workspaceId)))).toString('base64url');
function openSlot(workspaceId:string,id:string):Slot{
 try{const o=decryptCredential(JSON.parse(Buffer.from(id,'base64url').toString('utf8')),slotAad(workspaceId));return{c:o.c,r:Number(o.r),v:Number(o.v),s:Number(o.s),e:Number(o.e),z:o.z,x:Number(o.x)};}
 catch{throw new AppError(422,'Horário inválido. Consulte os horários de novo.','SLOT_INVALID');}
}
export async function readCalendarSlots(p:Principal,raw:unknown,deps:CalendarDeps={}):Promise<{timezone:string;slots:CalendarSlot[]}>{
 const q=slotQuerySchema.safeParse(raw??{});if(!q.success)throw new AppError(422,'Período inválido.');
 try{
  const a=await access(p),config=a.config;
  if(a.state!=='ready'||!config)throw new AppError(409,'Configure a disponibilidade da agenda primeiro.','CALENDAR_SETUP');
  if(a.attention)throw new AppError(409,'A agenda precisa de atenção. Reconecte a conta Google.','CALENDAR_ATTENTION');
  const now=(deps.now??Date.now)(),from=q.data.from?Date.parse(q.data.from):now,to=q.data.to?Date.parse(q.data.to):from+7*86400000;
  if(!(to>from)||to-from>MAX_RANGE)throw new AppError(422,'Consulte no máximo 14 dias por vez.');
  const candidates=candidateSlots(config,from,to,now);if(!candidates.length)return{timezone:config.timezone,slots:[]};
  const lo=candidates[0].start,hi=candidates.at(-1)!.end;
  const remote=await call(p,a,t=>busy(t,config,lo,hi,deps),deps);
  // Local holds cover reservations Google does not show yet; an unconfirmed hold lapses after 10 minutes.
  const held=await withWorkspaceTransaction(p,async c=>(await c.query(`SELECT start_at,end_at FROM app.calendar_reservation WHERE connection_id=$1 AND end_at>$2 AND start_at<$3
   AND (state='accepted' OR (state IN('prepared','uncertain') AND updated_at>now()-interval '10 minutes'))`,[a.id,new Date(lo),new Date(hi)])).rows.map(r=>({start:(r.start_at as Date).getTime(),end:(r.end_at as Date).getTime()})));
  return{timezone:config.timezone,slots:freeSlots(freeSlots(candidates,remote),held).map(s=>({id:sealSlot(p.workspaceId,{c:a.id,r:a.revision,v:a.configRevision,s:s.start,e:s.end,z:config.timezone,x:now+SLOT_TTL}),
   start:new Date(s.start).toISOString(),end:new Date(s.end).toISOString(),available:true}))};
 }catch(e){throw calendarError(e);}
}
type Row={id:string;connection_id:string;lead_id:string;start_at:string|Date;end_at:string|Date;event_id:string;state:CalendarReservationView['state'];revision:number|string;last_error:string|null};
const view=(r:Row):CalendarReservationView=>({id:r.id,connectionId:r.connection_id,leadId:r.lead_id,start:new Date(r.start_at).toISOString(),end:new Date(r.end_at).toISOString(),
 externalId:r.state==='accepted'?r.event_id:null,state:r.state,revision:Number(r.revision)});
const finish=(p:Principal,id:string,revision:number,state:'accepted'|'uncertain'|'cancelled'|'failed',error:string|null)=>
 withWorkspaceTransaction(p,async c=>Number((await c.query('SELECT app.finish_calendar_reservation($1,$2,$3,$4) v',[id,revision,state,error])).rows[0].v));
export async function reserveCalendarSlot(p:Principal,raw:unknown,deps:CalendarDeps={}):Promise<CalendarReservationView>{
 const parsed=reserveSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Escolha um horário e um lead.');const input=parsed.data;
 const slot=openSlot(p.workspaceId,input.slotId),id=randomUUID();
 try{
  const a=await access(p);
  const r=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.begin_calendar_reservation($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) v',
   [id,slot.c,slot.r,slot.v,input.leadId,input.requestId,new Date(slot.s),new Date(slot.e),slot.z,'cadence'+id.replaceAll('-',''),new Date(slot.x)])).rows[0].v) as Row&{replay:boolean;leadName:string|null;companyName:string|null};
  if(r.state==='accepted'||r.state==='cancelled')return view(r);
  if(r.state==='failed')throw new AppError(409,failures.SLOT_TAKEN[1],'SLOT_TAKEN');
  if(r.connection_id!==a.id)throw new AppError(409,failures.CONNECTION_CHANGED[1],'CONNECTION_CHANGED');
  const calendarId=a.config?.calendarId??'primary',revision=Number(r.revision);
  const event={id:r.event_id,summary:`Reunião com ${r.leadName||'lead'}`+(r.companyName?` · ${r.companyName}`:''),description:'Reunião reservada pelo Prometeus Cadence.',
   start:{dateTime:new Date(slot.s).toISOString(),timeZone:slot.z},end:{dateTime:new Date(slot.e).toISOString(),timeZone:slot.z},extendedProperties:{private:{cadenceReservation:r.id}}};
  let outcome:'accepted'|'failed';
  try{
   outcome=await call(p,a,async token=>{
    // A repeated request first asks Google: the event may exist from the attempt whose answer was lost.
    if(r.replay&&await findEvent(token,calendarId,r.event_id,deps))return'accepted';
    if((await busy(token,{calendarId,timezone:slot.z},slot.s,slot.e,deps)).length)return'failed';
    // The event id is fixed by the reservation: a second create answers 409 instead of booking twice.
    try{await google('POST',eventUrl(calendarId)+'?sendUpdates=none',token,event,deps,texts);return'accepted';}
    catch(e){if(e instanceof GoogleRequestError&&e.status===409)return await findEvent(token,calendarId,r.event_id,deps)?'accepted':'failed';throw e;}
   },deps);
  }catch(e){
   // No answer: the event may exist. The reservation stays uncertain until a repeat or a cancel asks Google.
   await finish(p,r.id,revision,e instanceof GoogleRetry?'uncertain':'failed',e instanceof Error?e.message:null);
   throw e;
  }
  const next=await finish(p,r.id,revision,outcome,outcome==='failed'?'O horário foi ocupado na agenda.':null);
  if(outcome==='failed')throw new AppError(409,failures.SLOT_TAKEN[1],'SLOT_TAKEN');
  return view({...r,state:'accepted',revision:next});
 }catch(e){throw calendarError(e);}
}
export async function cancelCalendarReservation(p:Principal,id:string,raw:unknown,deps:CalendarDeps={}):Promise<CalendarReservationView>{
 const parsed=cancelReservationSchema.safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 try{
  const r=await withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.calendar_actor()');return(await c.query('SELECT id,connection_id,lead_id,start_at,end_at,event_id,state,revision,last_error FROM app.calendar_reservation WHERE id=$1',[id])).rows[0] as Row|undefined;});
  if(!r)throw new AppError(404,'Reserva não encontrada.','RESERVATION_NOT_FOUND');
  // Already settled: answer from the local record, with no second call to Google.
  if(r.state==='cancelled'||r.state==='failed')return view(r);
  if(Number(r.revision)!==parsed.data.expectedRevision)throw Error('RESERVATION_CHANGED');
  if(r.state==='prepared')throw new AppError(409,'A reserva ainda está sendo criada. Tente de novo em instantes.','RESERVATION_PENDING');
  const a=await access(p);
  if(a.id!==r.connection_id)throw new AppError(409,'A conta Google desta reserva foi desconectada. Apague o evento direto na agenda.','CALENDAR_DISCONNECTED');
  // Delete is the authoritative check for an uncertain reservation: 404/410 means no event exists.
  await call(p,a,async token=>{
   try{await google('DELETE',eventUrl(a.config?.calendarId??'primary',r.event_id)+'?sendUpdates=none',token,undefined,deps,texts);}
   catch(e){if(e instanceof GoogleAttention&&e.attention==='missing')return;if(e instanceof GoogleRequestError&&e.status===410)return;throw e;}
  },deps);
  return view({...r,state:'cancelled',revision:await finish(p,r.id,Number(r.revision),'cancelled',null)});
 }catch(e){throw calendarError(e);}
}
