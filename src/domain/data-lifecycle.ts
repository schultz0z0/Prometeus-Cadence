import{z}from'zod';
// Strong identities only; the reference refuses name+city and site because different companies share them.
export const identityKinds=['cnpj','email','phone'] as const;
export type IdentityKind=typeof identityKinds[number];
export type MergeInput={targetId:string;sourceIds:string[];expectedRevision:number;fieldChoices:Record<string,string>};
export type MergeView={id:string;state:'merged'|'undone'|'conflict';undoUntil:string};
export type DataRequest={kind:'export'|'delete'|'retention';leadIds:string[];requestId:string;retentionDays?:number};
export type RetentionPolicy={active:boolean;sentDays:number;replyDays:number};
export function normalizeIdentity(kind:IdentityKind,value:string|undefined|null):string|null{
 const raw=(value??'').trim();
 if(kind==='email'){const v=raw.toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)?v:null;}
 if(kind==='cnpj'){const v=raw.toUpperCase().replace(/[./\s-]/g,'');return /^[A-Z0-9]{12}[0-9]{2}$/.test(v)?v:null;}
 let v=raw.replace(/\D/g,'');if((v.length===12||v.length===13)&&v.startsWith('55'))v=v.slice(2);return v.length===10||v.length===11?v:null;
}
export function duplicateIdentityMatch(input:{emailA:string;emailB:string;companyA:string;companyB:string}):boolean{
 const a=normalizeIdentity('email',input.emailA);return a!==null&&a===normalizeIdentity('email',input.emailB);
}
const sent=[30,60,90,180,365,730,1095,1825],reply=[90,180,365,730,1095,1825];
export function retentionChoices(kind:'sent'|'reply'){return kind==='sent'?[...sent]:[...reply];}
export function retentionLabel(days:number){if(days>=365&&days%365===0){const y=days/365;return y===1?'1 ano':`${y} anos`;}return`${days} dias`;}
// Turning deletion on or shortening a deadline erases more text, so it needs the typed confirmation.
export function retentionNeedsTypedConfirmation(before:RetentionPolicy,next:RetentionPolicy){
 return next.active&&(!before.active||next.sentDays<before.sentDays||next.replyDays<before.replyDays);
}
const id=z.string().min(1).max(120);
export const mergeGroupSchema=z.strictObject({targetId:id,sourceIds:z.array(id).min(1).max(50),kind:z.enum(identityKinds),value:z.string().min(1).max(254)}).refine(g=>!g.sourceIds.includes(g.targetId)&&new Set(g.sourceIds).size===g.sourceIds.length);
export const mergePrepareSchema=z.strictObject({groups:z.array(mergeGroupSchema).min(1).max(100)});
export const mergeConfirmSchema=z.strictObject({groups:z.array(mergeGroupSchema).min(1).max(100),token:z.string().min(1).max(8192),requestId:z.uuid()});
export const undoSchema=z.strictObject({requestId:z.uuid()});
export const privacyPolicySchema=z.strictObject({active:z.boolean(),sentDays:z.number().int().refine(v=>sent.includes(v)),replyDays:z.number().int().refine(v=>reply.includes(v)),expectedRevision:z.number().int().min(0),confirm:z.literal('APAGAR').optional()});
export type MergeGroup=z.infer<typeof mergeGroupSchema>;
