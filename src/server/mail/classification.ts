import type {MailMessage} from '../../domain/mail.ts';
import {normalizeMailAddress} from '../../domain/mail-policy.ts';
export interface DsnFacts {messageId:string;recipient:string;status:string;action:string}
export interface MailAssessment {kind:'human'|'automatic'|'hard-bounce'|'soft-bounce'|'ambiguous';correlationId:string|null;recipient?:string;stopRequested:boolean}
export function parseDsnFacts(value:string|undefined):DsnFacts|null{
 if(!value||Buffer.byteLength(value)>8192)return null;
 const fields=new Map<string,string[]>();for(const line of value.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/)){const index=line.indexOf(':');if(index<1)continue;const key=line.slice(0,index).trim().toLowerCase(),v=line.slice(index+1).trim();fields.set(key,[...(fields.get(key)??[]),v]);}
 const one=(key:string)=>fields.get(key)?.length===1?fields.get(key)![0]:null;
 const messageId=one('original-message-id'),recipient=one('final-recipient')?.replace(/^rfc822;\s*/i,''),status=one('status'),action=one('action')?.toLowerCase();
 if(!messageId||!/^<[^<>\s]{1,500}>$/.test(messageId)||!recipient||!status||! /^[245]\.\d{1,3}\.\d{1,3}$/.test(status)||!action)return null;
 try{return {messageId,recipient:normalizeMailAddress(recipient),status,action};}catch{return null;}
}
export function classifyMail(message:MailMessage,headers:Record<string,string>,dsn:DsnFacts|null):MailAssessment{
 const base={correlationId:null,stopRequested:false};if(message.truncated||!message.from||message.to.length!==1)return {kind:'ambiguous',...base};
 if(dsn){const kind=dsn.status.startsWith('5.')&&dsn.action==='failed'?'hard-bounce':dsn.status.startsWith('4.')&&dsn.action==='delayed'?'soft-bounce':'ambiguous';return {kind,correlationId:dsn.messageId,recipient:dsn.recipient,stopRequested:false};}
 if(message.deliveryStatus)return {kind:'ambiguous',...base};
 const normalized=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),v.toLowerCase().trim()]));
 if((normalized['auto-submitted']&&normalized['auto-submitted']!=='no')||['bulk','junk','list'].includes(normalized.precedence)||normalized['x-autoreply']||normalized['x-autorespond'])return {kind:'automatic',...base};
 const text=message.text.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 const stopRequested=/^(sair|parar|remover|unsubscribe|stop)[.!\s]*$/.test(text)||/^nao quero receber (mais )?(mensagens|emails|e-mails)[.!\s]*$/.test(text);
 return {kind:'human',correlationId:message.inReplyTo,stopRequested};
}
