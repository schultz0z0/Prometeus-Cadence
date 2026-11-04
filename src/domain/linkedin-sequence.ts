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
const delayDays=z.number().int().min(0).max(60);
export const messageStepSchema=z.strictObject({kind:z.literal('message').optional(),delayDays,body:z.string().trim().min(1).max(8000).refine(tokens,tokenMessage)});
// 07A.3c: the AI writes a comment on the person's latest post; it waits for approval before it is published.
export const commentStepSchema=z.strictObject({kind:z.literal('comment'),delayDays,guidance:z.string().trim().max(300).optional()});
export const sequenceStepSchema=z.union([commentStepSchema,messageStepSchema]);
export type LinkedinSequenceStep=z.infer<typeof sequenceStepSchema>;
export const isCommentStep=(s:LinkedinSequenceStep):s is z.infer<typeof commentStepSchema>=>s.kind==='comment';
export const COMMENT_POST_MAX_DAYS=30;
export interface CommentPost{socialId:string;text:string;url:string|null;date:string}
/** The latest own post with text, open to comments, from the last 30 days; anything malformed is ignored. */
export function pickCommentPost(items:unknown,now:number):CommentPost|null{
 if(!Array.isArray(items))return null;
 const ok=items.flatMap((x:any)=>{const t=Date.parse(x?.parsed_datetime);
  if(typeof x?.social_id!=='string'||!x.social_id||typeof x?.text!=='string'||!x.text.trim()||x?.is_repost===true||x?.permissions?.can_post_comments===false||!Number.isFinite(t)||t>now+864e5||now-t>COMMENT_POST_MAX_DAYS*864e5)return [];
  return [{socialId:x.social_id.slice(0,300),text:x.text.trim().slice(0,3000),url:typeof x.share_url==='string'&&x.share_url.startsWith('https://')?x.share_url.slice(0,1000):null,date:new Date(t).toISOString(),t}];});
 ok.sort((a,b)=>b.t-a.t);const top=ok[0];return top?{socialId:top.socialId,text:top.text,url:top.url,date:top.date}:null;
}
// No links and no meeting ask: a comment is a public reply to the post, not a pitch.
export const commentOutputSchema=z.strictObject({comment:z.string().trim().min(1).max(600)
 .refine(c=>!/(https?:\/\/|www\.)/i.test(c),'Sem links.').refine(c=>!/\b(reuni[aã]o|agendar|agenda|call|demo)\b/i.test(c),'Sem pedido de reunião.')});
export const commentOutputJsonSchema={type:'object',additionalProperties:false,required:['comment'],properties:{comment:{type:'string',maxLength:600}}};
export const sequenceDraftSchema=z.strictObject({name:z.string().trim().min(1).max(100),campaignId:z.uuid(),steps:z.array(sequenceStepSchema).min(1).max(10)});
export type LinkedinTemplate=z.infer<typeof templateSchema>;
export type LinkedinSequenceDraft=z.infer<typeof sequenceDraftSchema>;
/** Automatic only when the platform attests automatic sending; assisted turns each step into a draft a person sends; null blocks. */
export function sequenceMode(c:LinkedinCapabilities):'automatic'|'assisted'|null{
 return c.sendMessage==='automatic'?'automatic':c.sendMessage==='assisted'?'assisted':null;
}
export interface LinkedinTemplateView extends LinkedinTemplate{id:string;revision:number;updatedAt:string}
export interface LinkedinSequenceView{id:string;name:string;campaign:{id:string;name:string};steps:LinkedinSequenceStep[];state:'draft'|'active'|'paused'|'archived';revision:number;counts:Record<string,number>;updatedAt:string}
