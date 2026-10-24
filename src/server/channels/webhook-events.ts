import {createHash} from 'node:crypto';
import type {WebhookEvent} from '../../domain/whatsapp.ts';
import {AppError} from '../errors.ts';
import type {IngressContext} from './ingress-contracts.ts';
import {templateStatus} from './providers/http.ts';
function bounded(value:unknown,max=512){return typeof value==='string'&&value.length<=max?value:null;}
function key(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function timestamp(value:unknown){const n=Number(value);if(value===undefined||value===null||!Number.isFinite(n)||n<0||n>253402300799)return null;return new Date(n*1000).toISOString();}
export function normalizeMetaEvents(data:any,ctx:IngressContext):WebhookEvent[]{
 if(data?.object!=='whatsapp_business_account'||!Array.isArray(data.entry)||data.entry.length>1000)throw new AppError(422,'Evento Meta inválido.');
 const events:WebhookEvent[]=[];
 for(const entry of data.entry){
  if(String(entry.id)!==ctx.externalAccountId)throw new AppError(403,'Conta do callback divergente.');
  if(!Array.isArray(entry.changes))throw new AppError(422,'Evento Meta inválido.');
  for(const change of entry.changes){
   const v=change.value??{};
   if(change.field==='messages'){
    const sender=String(v.metadata?.phone_number_id??'');if(sender!==ctx.identifiers.phoneNumberId||!ctx.senders.some(s=>s.externalId===sender))throw new AppError(403,'Remetente do callback divergente.');
    for(const m of v.messages??[]){
     const id=bounded(m.id),from=bounded(m.from);if(!id||!from)throw new AppError(422,'Mensagem Meta inválida.');
     const phone=/^[1-9]\d{6,14}$/.test(from)?'+'+from:null;
     const text=m.type==='text'?bounded(m.text?.body,4096):m.type==='button'?bounded(m.button?.text,4096):m.type==='interactive'?bounded(m.interactive?.button_reply?.title??m.interactive?.list_reply?.title,4096):null;
     events.push({kind:'inbound',dedupKey:key(['inbound',id]),accountId:ctx.externalAccountId!,senderExternalId:sender,occurredAt:timestamp(m.timestamp),remoteId:id,identity:{scope:'meta:'+ctx.externalAccountId,externalId:from,phone},text,mediaKind:text===null?bounded(m.type,80)??'unknown':null});
    }
    for(const s of v.statuses??[]){
     const id=bounded(s.id),status=bounded(s.status,80);if(!id||!status)throw new AppError(422,'Status Meta inválido.');
     const trace=bounded(s.biz_opaque_callback_data,36);
     events.push({kind:'status',dedupKey:key(['status',id,status]),accountId:ctx.externalAccountId!,senderExternalId:sender,occurredAt:timestamp(s.timestamp),remoteId:id,status,errorCode:s.errors?.[0]?.code===undefined?null:String(s.errors[0].code).slice(0,80),...(trace&&/^[a-f0-9-]{36}$/.test(trace)?{traceId:trace}:{})});
    }
    if(!(v.messages?.length||v.statuses?.length))events.push({kind:'unknown',dedupKey:key(change),accountId:ctx.externalAccountId!,senderExternalId:sender,occurredAt:null,eventType:'messages-other'});
   }else if(change.field==='message_template_status_update'){
    const id=bounded(String(v.message_template_id??''));if(!id)throw new AppError(422,'Template Meta inválido.');
    events.push({kind:'template',dedupKey:key(change),accountId:ctx.externalAccountId!,senderExternalId:null,occurredAt:timestamp(entry.time),remoteId:id,status:templateStatus(v.event)});
   }else events.push({kind:'unknown',dedupKey:key(change),accountId:ctx.externalAccountId!,senderExternalId:null,occurredAt:null,eventType:bounded(change.field,80)??'unknown'});
   if(events.length>2000)throw new AppError(413,'Batch excede o limite de eventos.');
  }
 }
 return events;
}
