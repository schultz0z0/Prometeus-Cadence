import {z} from 'zod';
import type {UsageEstimate} from './prospecting.ts';
import type {Reviewed} from './reviewed-operation.ts';
export const brazilianStates={AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'} as const;
const registryScope=z.strictObject({cnae:z.string().trim().regex(/^\d{7}$/),city:z.string().trim().min(2).max(120).refine(city=>!city.includes(',')),uf:z.enum(Object.keys(brazilianStates) as (keyof typeof brazilianStates)[])});
export const journeyInputSchema=z.strictObject({brief:z.string().trim().min(2).max(4000),location:z.string().trim().min(2).max(200),limit:z.number().int().min(1).max(500),destinationListId:z.string().min(1).max(120).optional(),funding:z.enum(['plan','credits']).optional(),registry:registryScope.optional()}).transform(input=>input.registry?{...input,location:input.registry.city+", "+input.registry.uf}:input);
export type JourneyInput=z.infer<typeof journeyInputSchema>;
export type JourneyStage='discover'|'research'|'people'|'qualify'|'review'|'cadence';
export type JourneyState='running'|'paused'|'blocked'|'review'|'ready';
export interface JourneyView{id:string;revision:number;state:JourneyState;input:JourneyInput;stages:{name:JourneyStage;jobId:string|null;state:string;missing:string[];companies:number}[];listId:string|null;proposalJobId:string|null;cadenceId:string|null;missing:number;excluded?:number;reason:string|null}
export type JourneyReview=Reviewed<JourneyInput>&{usage:UsageEstimate[];effects:string[];extractionRemaining?:number|null};
export function nextJourneyStage(input:{research:string;qualification:string;cadenceApproved:boolean}):'research'|'qualify'|'review'|'ready'{
 if(!['completed','partial'].includes(input.research))return 'research';
 if(!['completed','partial'].includes(input.qualification))return 'qualify';
 return input.cadenceApproved?'ready':'review';
}
export function journeyRetryIds(companies:{leadId:string;state:string}[]):string[]{
 const completed=new Set(companies.filter(c=>c.state==='completed').map(c=>c.leadId));
 return [...new Set(companies.filter(c=>['partial','failed','cancelled','unavailable'].includes(c.state)&&!completed.has(c.leadId)).map(c=>c.leadId))];
}
