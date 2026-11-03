import {z} from 'zod';
export type ConnectorKind='apollo'|'google-sheets'|'funnelsflow'|'meetflow';
// Only connectors with an official, documented contract and a working adapter are available; the rest stay visible but closed.
export const connectorCatalog:{kind:ConnectorKind;available:boolean;capabilities:string[];barrier:string}[]=[
 {kind:'apollo',available:true,capabilities:['companies.search'],barrier:''},
 {kind:'google-sheets',available:true,capabilities:['leads.export'],barrier:''},
 {kind:'funnelsflow',available:false,capabilities:['crm.upsert'],barrier:'O FunnelsFlow não publica documentação oficial de API; sem contrato documentado o conector não é oferecido.'},
 {kind:'meetflow',available:false,capabilities:['meetings.read'],barrier:'O MeetFlow não publica documentação oficial de API; sem contrato documentado o conector não é oferecido.'},
];
export interface SheetConfig{spreadsheetId:string;spreadsheetName:string;sheetTitle:string;columns:SheetColumn[];events:SheetEvent[]}
export type SheetAttention='schema'|'missing'|'reconnect'|'forbidden';
export interface ConnectionView{id:string;kind:ConnectorKind;name:string;state:'ready'|'attention'|'setup';capabilities:string[];revision:number;verifiedAt:string|null;lastError:string|null;
 config?:SheetConfig|null;configRevision?:number;active?:boolean;attention?:SheetAttention|null;lastSuccessAt?:string|null;queue?:{pending:number;failed:number}}
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
