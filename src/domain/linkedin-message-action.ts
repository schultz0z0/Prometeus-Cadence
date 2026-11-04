import {z} from 'zod';
// 07A.3a: people, pipeline and conversations of LinkedIn campaigns.
export type PipelineStage='queued'|'warming'|'invited'|'accepted'|'replied';
// The reference's columns (EV-243 copy). "Aquecida" stays empty while warming has no executor.
export const PIPELINE_COLUMNS:[PipelineStage,string][]=[['queued','Na fila'],['warming','Aquecida'],['invited','Convidada'],['accepted','Aceitou'],['replied','Respondeu']];
/** The stage shown, from real states only. A manual mark can add a reply that happened outside LinkedIn, never hide a real one. */
export function pipelineStage(p:{state:string;repliedAt:string|null;stageOverride:string|null}):PipelineStage|null{
 if(p.state==='queued'||p.state==='sending')return 'queued';
 if(p.state==='invited'||p.state==='uncertain')return 'invited';
 if(p.state!=='accepted')return null;
 return p.repliedAt||p.stageOverride==='replied'?'replied':'accepted';
}
/** Only after the acceptance: an invite or an acceptance is never faked by hand. */
export const canMoveStage=(from:string,to:string)=>['accepted','replied'].includes(from)&&['accepted','replied'].includes(to)&&from!==to;
export const REPLY_WINDOW_MS=60000;
// A reply goes to a conversation, or to a person who has none yet (07A.3b: it starts the chat with a 1st-degree relation).
const replyBody=z.string().trim().min(1).max(8000);
export const replyInputSchema=z.union([z.strictObject({threadId:z.uuid(),body:replyBody}),z.strictObject({personId:z.uuid(),body:replyBody})]);
const confirmFields={body:z.string().trim().min(1).max(8000),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),requestId:z.uuid()};
export const confirmReplySchema=z.union([z.strictObject({threadId:z.uuid(),...confirmFields}),z.strictObject({personId:z.uuid(),...confirmFields})]);
export interface LinkedinPersonView{id:string;name:string;headline:string|null;company:string|null;location:string|null;campaign:{id:string;name:string};stage:PipelineStage|null;state:string;stageRevision:number;manualReply:boolean;threadId:string|null;draft:string|null;lastActivityAt:string;optedOut:boolean}
export interface LinkedinMessageView{id:string;direction:'in'|'out';body:string;sentAt:string}
