import {z} from 'zod';
export type ConnectorKind='apollo'|'google-sheets'|'google-calendar'|'funnelsflow'|'meetflow';
// Only connectors with an official, documented contract and a working adapter are available; the rest stay visible but closed.
export const connectorCatalog:{kind:ConnectorKind;available:boolean;capabilities:string[];barrier:string}[]=[
 {kind:'apollo',available:true,capabilities:['companies.search'],barrier:''},
 {kind:'google-sheets',available:true,capabilities:['leads.export'],barrier:''},
 {kind:'google-calendar',available:true,capabilities:['calendar.read','calendar.reserve'],barrier:''},
 {kind:'funnelsflow',available:false,capabilities:['crm.upsert'],barrier:'O FunnelsFlow não publica documentação oficial de API; sem contrato documentado o conector não é oferecido.'},
 {kind:'meetflow',available:false,capabilities:['meetings.read'],barrier:'O MeetFlow não publica documentação oficial de API; sem contrato documentado o conector não é oferecido.'},
];
export interface SheetConfig{spreadsheetId:string;spreadsheetName:string;sheetTitle:string;columns:SheetColumn[];events:SheetEvent[]}
export type SheetAttention='schema'|'missing'|'reconnect'|'forbidden';
export interface ConnectionView{id:string;kind:ConnectorKind;name:string;state:'ready'|'attention'|'setup';capabilities:string[];revision:number;verifiedAt:string|null;lastError:string|null;
 config?:SheetConfig|null;calendar?:CalendarConfig|null;configRevision?:number;active?:boolean;attention?:SheetAttention|null;lastSuccessAt?:string|null;queue?:{pending:number;failed:number}}
export function connectorActionAllowed(input:{action:string;capabilities:string[];connected:boolean}){
 return input.connected&&input.action.length>0&&input.capabilities.includes(input.action);
}
const available=z.enum(['apollo']);
export const credentialInputSchema=z.strictObject({kind:available,secret:z.string().trim().min(20).max(200)});
export const connectInputSchema=z.strictObject({kind:available,name:z.string().trim().min(1).max(60),credentialRef:z.uuid(),expectedRevision:z.number().int().min(0)});
// Google Sheets: column A is the technical lead id; the rest are declared lead fields only (no expressions).
export const sheetColumns={name:'Nome',companyName:'Empresa',email:'E-mail',phone:'Telefone',whatsapp:'WhatsApp',site:'Site',city:'Cidade',state:'UF',cnpj:'CNPJ',
 linkedin:'LinkedIn',instagram:'Instagram',qualification:'Qualificação',source:'Origem',list:'Lista',createdAt:'Criado em',event:'Último evento',exportedAt:'Exportado em'} as const;
export type SheetColumn=keyof typeof sheetColumns;
export const sheetEvents={'lead.created':'Lead gerado','lead.qualified':'Lead qualificado','lead.connected':'Lead respondeu'} as const;
export type SheetEvent=keyof typeof sheetEvents;
export const SHEET_ID_HEADER='ID Cadence';
export const sheetHeaders=(columns:SheetColumn[])=>[SHEET_ID_HEADER,...columns.map(c=>sheetColumns[c])];
const qualificationLabel:Record<string,string>={qualified:'Qualificado',pending:'Pendente',warning:'Atenção',disqualified:'Desqualificado'};
export function sheetRow(lead:Record<string,unknown>,columns:SheetColumn[],meta:{list:string|null;event:SheetEvent;channel?:string|null;exportedAt:string}):string[]{
 const text=(v:unknown)=>typeof v==='string'?v.slice(0,5000):typeof v==='number'?String(v):'';
 const value=(c:SheetColumn)=>c==='list'?meta.list??'':c==='event'?sheetEvents[meta.event]+(meta.channel?` (${meta.channel==='EMAIL'?'e-mail':meta.channel==='WHATSAPP'?'WhatsApp':meta.channel})`:''):c==='exportedAt'?meta.exportedAt
  :c==='qualification'?qualificationLabel[text(lead.qualification)]??text(lead.qualification):text(lead[c]);
 return [text(lead.id),...columns.map(value)];
}
const columnKeys=Object.keys(sheetColumns) as [SheetColumn,...SheetColumn[]],eventKeys=Object.keys(sheetEvents) as [SheetEvent,...SheetEvent[]];
// Sheet titles are quoted in A1 ranges; letters, digits, spaces, dashes and underscores keep them unambiguous.
export const sheetSetupSchema=z.strictObject({
 spreadsheetName:z.string().trim().min(1).max(100),sheetTitle:z.string().trim().min(1).max(50).regex(/^[\p{L}\p{N} _-]+$/u),
 columns:z.array(z.enum(columnKeys)).min(1).max(columnKeys.length).refine(a=>new Set(a).size===a.length),
 events:z.array(z.enum(eventKeys)).min(1).max(eventKeys.length).refine(a=>new Set(a).size===a.length),
 expectedRevision:z.number().int().min(0)});
export const sheetActionSchema=z.strictObject({action:z.enum(['pause','activate','retry','repair']),expectedRevision:z.number().int().min(1)});

// Google Agenda: availability rules in the customer's zone; busy time comes from Google free/busy.
export interface CalendarConfig{calendarId:'primary';timezone:string;weekdays:number[];start:string;end:string;durationMinutes:15|30|45|60;noticeHours:number;horizonDays:number}
export interface CalendarSlot{id:string;start:string;end:string;available:boolean}
export type CalendarReservationState='prepared'|'accepted'|'uncertain'|'cancelled'|'failed';
export interface CalendarReservationView{id:string;connectionId:string;leadId:string;start:string;end:string;externalId:string|null;state:CalendarReservationState;revision:number}
const hm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const validZone=(tz:string)=>{try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true;}catch{return false;}};
export const calendarSetupSchema=z.strictObject({
 timezone:z.string().min(1).max(64).refine(validZone),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(a=>new Set(a).size===a.length),
 start:hm,end:hm,durationMinutes:z.union([z.literal(15),z.literal(30),z.literal(45),z.literal(60)]),noticeHours:z.number().int().min(0).max(72),horizonDays:z.number().int().min(1).max(60),
 expectedRevision:z.number().int().min(0)}).refine(v=>v.start<v.end);
export const slotQuerySchema=z.strictObject({from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional()});
export const reserveSchema=z.strictObject({slotId:z.string().min(20).max(2000),leadId:z.string().min(1).max(200),requestId:z.uuid()});
export const cancelReservationSchema=z.strictObject({expectedRevision:z.number().int().min(1)});
// Offset of the zone at an instant, in ms (local wall clock minus UTC).
function zoneOffset(ms:number,timeZone:string){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(ms).map(x=>[x.type,x.value]));
 return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-Math.floor(ms/1000)*1000;
}
/** The instant a wall-clock date and time happen in a zone. */
export function zonedTime(ymd:string,time:string,timeZone:string):Date{
 const [y,m,d]=ymd.split('-').map(Number),[h,mi]=time.split(':').map(Number),guess=Date.UTC(y,m-1,d,h,mi);
 const first=guess-zoneOffset(guess,timeZone);return new Date(guess-zoneOffset(first,timeZone));
}
const localDate=(ms:number,timeZone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(ms);
export function candidateSlots(c:Pick<CalendarConfig,'timezone'|'weekdays'|'start'|'end'|'durationMinutes'|'noticeHours'|'horizonDays'>,from:number,to:number,now:number){
 const lo=Math.max(from,now+c.noticeHours*3600000),hi=Math.min(to,now+c.horizonDays*86400000),step=c.durationMinutes*60000,out:{start:number;end:number}[]=[];
 if(hi<=lo)return out;
 let day=Date.parse(localDate(lo,c.timezone)+'T00:00:00Z');
 for(const last=Date.parse(localDate(hi,c.timezone)+'T00:00:00Z');day<=last;day+=86400000){
  const ymd=new Date(day).toISOString().slice(0,10);if(!c.weekdays.includes(new Date(day).getUTCDay()))continue;
  const close=zonedTime(ymd,c.end,c.timezone).getTime();
  for(let t=zonedTime(ymd,c.start,c.timezone).getTime();t+step<=close;t+=step)if(t>=lo&&t+step<=hi)out.push({start:t,end:t+step});
 }
 return out;
}
export const freeSlots=(slots:{start:number;end:number}[],busy:{start:number;end:number}[])=>slots.filter(s=>!busy.some(b=>b.start<s.end&&b.end>s.start));
