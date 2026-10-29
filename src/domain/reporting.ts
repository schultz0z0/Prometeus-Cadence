import {z} from 'zod';
import {localDateAt,wallTimeToUtc} from './schedule.ts';
export const reportMetricDefinitions={
 sent:{unit:'unique-message',description:'Uma mensagem aceita pelo provedor; tentativas não são somadas.'},
 replies:{unit:'human-inbound-message',description:'Mensagem recebida humana; DSN e resposta automática são excluídos.'},
 failed:{unit:'unique-message',description:'Mensagem em falha definitiva; incerteza e retry não são falhas definitivas.'},
 pending:{unit:'unique-message',description:'Mensagem atualmente na fila ou em transmissão, criada no período.'},
 bounces:{unit:'outbound-message',description:'Uma mensagem de e-mail com bounce correlacionado, mesmo com DSNs repetidos.'},
 optouts:{unit:'channel-identity',description:'Identidade suprimida no período por motivo diferente de hard bounce.'},
 leads:{unit:'lead',description:'Contato criado no período; base atual não substitui data de captação.'},
 qualified:{unit:'lead',description:'Contatos do período que estão qualificados atualmente; não é histórico da data de qualificação.'},
 leadPending:{unit:'lead',description:'Contatos criados no período atualmente pendentes de qualificação.'},
 leadWarning:{unit:'lead',description:'Contatos criados no período atualmente com atenção na qualificação.'},
 leadDisqualified:{unit:'lead',description:'Contatos criados no período atualmente desqualificados.'},
 enrolled:{unit:'lead',description:'Contatos inscritos em publicações criadas no período, sem duplicar o mesmo contato.'},
 executions:{unit:'job',description:'Execuções criadas no período, sem somar tentativas do provedor.'},
} as const;
export type ReportMetric=keyof typeof reportMetricDefinitions;
export type ReportPeriod={from:string;to:string;timezone:string};
export interface ReportQuery extends ReportPeriod{view:'dashboard'|'cadences'|'executions'|'funnel';cadenceId?:string;cursor?:string;metric?:ReportMetric}
export interface ReportItem{id:string;kind:string;occurredAt:string;channel:string|null;cadenceId:string|null;stepIndex:number|null;state:string;href:string}
export interface ReportView{period:ReportPeriod;totals:Record<string,number|null>;series:{date:string;values:Record<string,number|null>}[];items:ReportItem[];nextCursor:string|null;asOf:string;stale:boolean;checkpoint:string;definitions:typeof reportMetricDefinitions;cadences:{id:string;name:string;values:Record<string,number|null>}[];steps:{cadenceId:string;publicationId:string;stepIndex:number;values:Record<string,number|null>}[];recentExecutions:{id:string;kind:string;state:string;createdAt:string;counts:Record<string,number>}[];attribution:'last-preceding-accepted-message'}
const absolute=z.iso.datetime({offset:true}).max(40);
const validZone=(value:string)=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}};
const querySchema=z.strictObject({view:z.enum(['dashboard','cadences','executions','funnel']),from:absolute,to:absolute,timezone:z.string().min(1).max(100).refine(validZone),cadenceId:z.string().min(1).max(200).optional(),cursor:z.string().min(1).max(2048).optional(),metric:z.enum(Object.keys(reportMetricDefinitions) as [ReportMetric,...ReportMetric[]]).optional()}).refine(v=>Date.parse(v.to)>Date.parse(v.from)&&Date.parse(v.to)-Date.parse(v.from)<=93*86400000);
export function parseReportQuery(raw:unknown):ReportQuery{const value=querySchema.parse(raw);return{...value,from:new Date(value.from).toISOString(),to:new Date(value.to).toISOString()};}
export function supportedMetric(input:{supported:boolean;value:number}):number|null{if(!input.supported)return null;if(!Number.isFinite(input.value)||input.value<0)throw Error('Valor de métrica inválido.');return input.value;}
export function reportRate(numerator:number|null,denominator:number|null){return numerator===null||denominator===null||!Number.isFinite(numerator)||!Number.isFinite(denominator)||numerator<0||denominator<=0||numerator>denominator?null:numerator/denominator*100;}
export function reportPeriodForDays(days:number,timezone:string,now=new Date().toISOString()):ReportPeriod{
 if(!Number.isInteger(days)||days<1||days>93||!validZone(timezone))throw Error('Período inválido.');const today=localDateAt(now,timezone),day=Date.parse(today+'T00:00:00Z'),date=(n:number)=>new Date(day+n*86400000).toISOString().slice(0,10);
 return{from:wallTimeToUtc(date(1-days),'00:00',timezone),to:wallTimeToUtc(date(1),'00:00',timezone),timezone};
}
export function reportSqlTimezone(timezone:string){const zone=new Intl.DateTimeFormat('en',{timeZone:timezone}).resolvedOptions().timeZone;return/^[+-]\d{2}:\d{2}$/.test(zone)?'UTC'+(zone[0]==='+'?'-':'+')+zone.slice(1):zone;}
export function reportPeriodFromSelection(selection:string,timezone:string,now?:string):ReportPeriod{
 const days:Record<string,number>={'Hoje':1,'7 dias':7,'15 dias':15,'30 dias':30,'60 dias':60,'90 dias':90};
 if(days[selection])return reportPeriodForDays(days[selection],timezone,now);
 const dates=selection.split('/');if(dates.length!==2||dates.some(date=>!z.iso.date().safeParse(date).success)||dates[0]>dates[1])throw Error('Escolha um período válido de até 93 dias.');
 const next=new Date(Date.parse(dates[1]+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const {from,to}=parseReportQuery({view:'dashboard',from:wallTimeToUtc(dates[0],'00:00',timezone),to:wallTimeToUtc(next,'00:00',timezone),timezone});return{from,to,timezone};
}
