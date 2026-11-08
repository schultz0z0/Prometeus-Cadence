import {z} from 'zod';
import type {UsageEstimate} from './prospecting.ts';
import type {Reviewed} from './reviewed-operation.ts';
export const journeyInputSchema=z.strictObject({brief:z.string().trim().min(2).max(4000),location:z.string().trim().min(2).max(200),limit:z.number().int().min(1).max(500),destinationListId:z.string().min(1).max(120).optional(),funding:z.enum(['plan','credits']).optional()});
export type JourneyInput=z.infer<typeof journeyInputSchema>;
export type JourneyStage='discover'|'research'|'people'|'qualify'|'review'|'cadence';
export type JourneyState='running'|'paused'|'blocked'|'review'|'ready';
export interface JourneyView{id:string;revision:number;state:JourneyState;input:JourneyInput;stages:{name:JourneyStage;jobId:string|null;state:string;missing:string[];companies:number}[];listId:string|null;proposalJobId:string|null;cadenceId:string|null;missing:number;excluded?:number;reason:string|null}
export type JourneyReview=Reviewed<JourneyInput>&{usage:UsageEstimate[];effects:string[]};
export function nextJourneyStage(input:{research:string;qualification:string;cadenceApproved:boolean}):'research'|'qualify'|'review'|'ready'{
 if(!['completed','partial'].includes(input.research))return 'research';
 if(!['completed','partial'].includes(input.qualification))return 'qualify';
 return input.cadenceApproved?'ready':'review';
}
export function journeyRetryIds(companies:{leadId:string;state:string}[]):string[]{
 const completed=new Set(companies.filter(c=>c.state==='completed').map(c=>c.leadId));
 return [...new Set(companies.filter(c=>['partial','failed','cancelled','unavailable'].includes(c.state)&&!completed.has(c.leadId)).map(c=>c.leadId))];
}
