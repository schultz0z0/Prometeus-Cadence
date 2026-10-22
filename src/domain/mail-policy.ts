import type {MailContent,MailPolicyInput} from './mail.ts';

export function normalizeMailAddress(value:string):string {
 if(typeof value!=='string'||value!==value.trim()||/[\s<>\r\n,;\\/\x00-\x1f\x7f]/.test(value))throw Error('Endereço de e-mail inválido.');
 const parts=value.split('@');if(parts.length!==2)throw Error('Endereço de e-mail inválido.');
 const [local,domain]=parts;
 if(!local||local.length>64||! /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~.]+$/.test(local)||local.startsWith('.')||local.endsWith('.')||local.includes('..'))throw Error('Endereço de e-mail inválido.');
 let ascii:string;try{const url=new URL('https://'+domain);if(url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();ascii=url.hostname;}catch{throw Error('Domínio de e-mail inválido.');}
 if(ascii.length>253||!ascii.includes('.')||ascii.endsWith('.')||ascii.split('.').some(label=>! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))||/^\d+(\.\d+){3}$/.test(ascii))throw Error('Domínio de e-mail inválido.');
 const result=local+'@'+ascii;if(result.length>254)throw Error('Endereço de e-mail inválido.');return result;
}

export function validateMailContent(content:MailContent):string[] {
 const blockers:string[]=[],bytes=(s:string)=>new TextEncoder().encode(s).length;
 if(typeof content.subject!=='string'||!content.subject.trim()||content.subject.length>200||/[\r\n\x00]/.test(content.subject))blockers.push('EMAIL_SUBJECT_INVALID');
 if(typeof content.text!=='string'||!content.text.trim()||bytes(content.text)>65536||content.text.includes('\0'))blockers.push('EMAIL_TEXT_INVALID');
 if(typeof content.signature!=='string'||bytes(content.signature)>4096||content.signature.includes('\0'))blockers.push('EMAIL_SIGNATURE_INVALID');
 return blockers;
}

export function evaluateMailPolicy(input:MailPolicyInput):{allowed:boolean;blockers:string[]} {
 const blockers:string[]=[],now=Date.parse(input.now),synced=input.lastSyncedAt?Date.parse(input.lastSyncedAt):NaN;
 if(!Number.isFinite(now))blockers.push('INVALID_CLOCK');
 if(!input.sendReady)blockers.push('SENDER_UNAVAILABLE');
 if(input.suppressed)blockers.push('CONTACT_SUPPRESSED');
 if(input.purpose==='service'&&!input.hasInbound)blockers.push('EMAIL_INBOUND_REQUIRED');
 if(input.purpose!=='service'&&!input.authorized)blockers.push('EMAIL_AUTHORIZATION_REQUIRED');
 if(input.purpose==='campaign'&&(input.syncState!=='ready'||!Number.isFinite(synced)||synced>now||now-synced>300000))blockers.push('EMAIL_SYNC_REQUIRED');
 return {allowed:blockers.length===0,blockers};
}
export function renderMailBody(content:MailContent,unsubscribeUrl:string|null=null):string{
 return content.text+(content.signature?'\n\n'+content.signature:'')+(unsubscribeUrl?'\n\nPara não receber mais e-mails: '+unsubscribeUrl:'');
}
export function validateRenderedMail(content:MailContent,unsubscribeUrl:string|null=null):string[]{
 const body=renderMailBody(content,unsubscribeUrl),bytes=(value:string)=>new TextEncoder().encode(value).length;
 return [...new Set([...validateMailContent(content),...(bytes(body)>65536||bytes(content.subject+'\n\n'+body)>65536?['EMAIL_TEXT_INVALID']:[])])];
}
