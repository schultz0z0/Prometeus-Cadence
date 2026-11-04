import {z} from 'zod';
import type {LinkedinCapabilities} from './linkedin-capabilities.ts';
import {NOTE_TOKENS,renderLinkedinText} from './linkedin-campaign.ts';
// 07A.3b: LinkedIn templates and the post-accept sequence of a campaign.
export const SEQUENCE_DAILY_CAP=30;
export {renderLinkedinText};
const tokens=(t:string)=>(t.match(/\{[^}]*\}/g)??[]).every(x=>(NOTE_TOKENS as readonly string[]).includes(x));
const tokenMessage='Use só {nome}, {empresa}, {cargo}, {setor} ou {prova}.';
export const templateSchema=z.strictObject({name:z.string().trim().min(1).max(100),kind:z.enum(['invite','message']),body:z.string().trim().min(1).max(8000)})
 .refine(t=>tokens(t.body),tokenMessage).refine(t=>t.kind!=='invite'||t.body.length<=300,'O convite tem até 300 caracteres.');
export const sequenceStepSchema=z.strictObject({delayDays:z.number().int().min(0).max(60),body:z.string().trim().min(1).max(8000).refine(tokens,tokenMessage)});
export const sequenceDraftSchema=z.strictObject({name:z.string().trim().min(1).max(100),campaignId:z.uuid(),steps:z.array(sequenceStepSchema).min(1).max(10)});
export type LinkedinTemplate=z.infer<typeof templateSchema>;
export type LinkedinSequenceDraft=z.infer<typeof sequenceDraftSchema>;
/** Automatic only when the platform attests automatic sending; assisted turns each step into a draft a person sends; null blocks. */
export function sequenceMode(c:LinkedinCapabilities):'automatic'|'assisted'|null{
 return c.sendMessage==='automatic'?'automatic':c.sendMessage==='assisted'?'assisted':null;
}
export interface LinkedinTemplateView extends LinkedinTemplate{id:string;revision:number;updatedAt:string}
export interface LinkedinSequenceView{id:string;name:string;campaign:{id:string;name:string};steps:LinkedinSequenceDraft['steps'];state:'draft'|'active'|'paused'|'archived';revision:number;counts:Record<string,number>;updatedAt:string}
