import type {CadenceStep,Channel,Template} from './model.ts';
export const authoringVariables=['nome','email','telefone','site','cidade','razaoSocial','cnpj'] as const;
export interface ContentStep{id:string;channel:Channel;body:string;subject?:string;variant?:'A'|'B';attachmentIds:string[]}
export interface ContentDraft{cadenceId:string;expectedRevision:number;steps:ContentStep[];requestId?:string}
export interface ContentPublication{cadenceId:string;contentRevision:number}
export interface AttachmentUpload{name:string;mime:string;bytes:Uint8Array}
export interface AttachmentView{id:string;name:string;mime:string;size:number;state:'pending'|'ready'|'rejected'}
export interface FrozenAttachment extends AttachmentView{hash:string}
export function validateAuthoringVariables(input:{body:string;allowed:readonly string[]}){const allowed=new Set(input.allowed),unknown=[...new Set([...input.body.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(m=>m[1]).filter(k=>!allowed.has(k)))];return{valid:!unknown.length,unknown};}
export function chooseMessageVariant(enrollmentId:string,completeB:boolean):'A'|'B'{if(!completeB)return'A';let hash=2166136261;for(const ch of enrollmentId)hash=Math.imul(hash^ch.charCodeAt(0),16777619);return hash>>>0&1?'B':'A';}
export function copyTemplateToStep(step:CadenceStep,template:Template):CadenceStep{if(step.channel!==template.channel)throw Error('TEMPLATE_CHANNEL_MISMATCH');return{...step,subject:template.subject,body:template.body};}
export function inspectAttachment(file:AttachmentUpload):{state:'ready'|'rejected';reason?:string}{
 const reject=(reason:string)=>({state:'rejected' as const,reason}),b=file.bytes;
 if(!file.name.trim()||file.name.length>200||/[\\/\u0000-\u001f\u007f]/.test(file.name)||file.name==='.'||file.name==='..')return reject('INVALID_NAME');
 if(!b.length||b.length>10*1024*1024)return reject('FILE_SIZE');
 const head=new TextDecoder().decode(b.slice(0,10)),tail=new TextDecoder().decode(b.slice(-1024));let valid=false;
 if(file.mime==='application/pdf')valid=head.startsWith('%PDF-')&&tail.includes('%%EOF')&&!/\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b/.test(new TextDecoder().decode(b));
 else if(file.mime==='image/png')valid=b.length>=20&&[137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v)&&new TextDecoder().decode(b.slice(-8,-4))==='IEND';
 else if(file.mime==='image/jpeg')valid=b.length>4&&b[0]===255&&b[1]===216&&b[b.length-2]===255&&b[b.length-1]===217;
 else if(file.mime==='text/plain'){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(b);valid=!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)&&!/<(?:!doctype|html|script|svg)\b/i.test(text);}catch{}}
 return valid?{state:'ready'}:reject('UNSUPPORTED_OR_MISMATCHED_FILE');
}
