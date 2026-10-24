import {createHmac,createHash,timingSafeEqual} from 'node:crypto';import {z} from 'zod';
import type {AuthenticatedBatch,WebhookEvent} from '../../../domain/whatsapp.ts';
import type {IngressContext} from '../ingress-contracts.ts';import {AppError,errorResponse} from '../../errors.ts';
import {openwaId,openwaRawMessageId,openwaSeconds,openwaStatus} from './wire.ts';
const envelope=z.object({event:z.string().min(1).max(100),sessionId:openwaId,timestamp:z.string().datetime({offset:true}),idempotencyKey:z.string().min(1).max(1024),deliveryId:openwaId,data:z.record(z.string(),z.unknown())});
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse=<T>(action:()=>T)=>{try{return action();}catch(error){if(error instanceof AppError)throw error;throw new AppError(422,'Evento OpenWA inválido.','OPENWA_EVENT_INVALID');}};
const chat=z.string().min(1).max(256);
export function normalizeOpenwaEvents(body:unknown,ctx:IngressContext):WebhookEvent[]{
 return parse(()=>{
  const e=envelope.parse(body);if(ctx.provider!=='openwa'||e.sessionId!==ctx.identifiers.sessionId||e.sessionId!==ctx.externalAccountId)throw new AppError(403,'Sessão do callback divergente.');
  const base={accountId:e.sessionId,senderExternalId:null as string|null,occurredAt:e.timestamp};
  if(e.event==='message.received'){
   const m=z.object({id:openwaRawMessageId,chatId:chat,from:chat,to:chat,fromMe:z.boolean(),body:z.string().max(65536).nullish(),type:z.string().max(80),timestamp:openwaSeconds,isGroup:z.boolean(),isStatusBroadcast:z.boolean().optional()}).parse(e.data);
   if(m.fromMe||m.isGroup||m.isStatusBroadcast||!/^\d{6,20}@(c\.us|s\.whatsapp\.net|lid)$/.test(m.chatId)||!['text','chat','image','video','audio','voice','document','sticker','location','contact','poll','order','product','masked','unknown'].includes(m.type))return [];
   if(m.from!==m.chatId)throw new AppError(403,'Identidade de mensagem divergente.');
   const ownPhone=/^(\d{6,15})@(c\.us|s\.whatsapp\.net)$/.exec(m.to)?.[1];
   const sender=ctx.senders.find(s=>ownPhone&&s.address==='+'+ownPhone);if(!sender)throw new AppError(403,'Remetente do callback divergente.');
   const phone=/^(\d{6,15})@(c\.us|s\.whatsapp\.net)$/.exec(m.from)?.[1];
   const text=['text','chat'].includes(m.type)?(m.body??'').slice(0,4096):null;
   return [{...base,kind:'inbound',dedupKey:digest(['openwa-inbound',e.sessionId,m.id]),senderExternalId:sender.externalId,occurredAt:new Date(m.timestamp*1000).toISOString(),remoteId:m.id,identity:{scope:'openwa:'+ctx.id,externalId:m.from,phone:phone?'+'+phone:null},text,mediaKind:text===null?m.type:null}];
  }
  if(e.event==='message.ack'||e.event==='message.failed'){
   const m=z.object({messageId:openwaRawMessageId,status:z.enum(['pending','sent','delivered','read','failed']),chatId:chat.optional()}).parse(e.data);
   if(m.chatId&&!/^\d{6,20}@(c\.us|s\.whatsapp\.net|lid)$/.test(m.chatId))return [];
   if(!['delivered','read','failed'].includes(m.status))return [];
   return [{...base,kind:'status',dedupKey:digest(['openwa-status',e.sessionId,m.messageId,m.status]),remoteId:m.messageId,status:m.status,errorCode:m.status==='failed'?'OPENWA_DELIVERY_FAILED':null}];
  }
  if(['session.status','session.authenticated','session.disconnected','session.reconnect_loop','session.restriction'].includes(e.event)){
   if(e.data.sessionId!==e.sessionId)throw new AppError(403,'Sessão do evento divergente.');
   let phase:string='action_required',restricted=false,restrictionCode:string|null=null;
   if(e.event==='session.status')phase=openwaStatus.parse(e.data.status);
   if(e.event==='session.authenticated')phase='ready';
   if(e.event==='session.disconnected')phase='disconnected';
   if(e.event==='session.restriction'){
    restricted=z.boolean().parse(e.data.active);restrictionCode=z.string().min(1).max(128).parse(e.data.code);phase=restricted?'action_required':'observe';
   }
   return [{...base,kind:'session',dedupKey:digest(['openwa-session',e.sessionId,e.event,e.timestamp,phase,restricted,restrictionCode]),phase,restricted,restrictionCode}];
  }
  return [];
 });
}
export async function authenticateOpenwaWebhook(request:Request,publicId:string,deps:{lookup?:(id:string)=>Promise<IngressContext|null>;now?:()=>string}={}):Promise<AuthenticatedBatch>{
 if(Number(request.headers.get('content-length'))>1048576)throw new AppError(413,'Callback limitado a 1 MiB.');
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new AppError(415,'Tipo de callback inválido.');
 const chunks:Uint8Array[]=[];let length=0;const reader=request.body?.getReader();
 if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1048576)throw new AppError(413,'Callback limitado a 1 MiB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=Buffer.concat(chunks),signature=request.headers.get('x-openwa-signature')??'';
 if(!/^sha256=[a-fA-F0-9]{64}$/.test(signature))throw new AppError(403,'Assinatura inválida.');
 const ctx=await(deps.lookup??(await import('../ingress-db.ts')).lookupIngress)(publicId);if(!ctx)throw new AppError(404,'Conexão não encontrada.');if(ctx.provider!=='openwa')throw new AppError(403,'Provedor divergente.');
 let version:IngressContext['credentialVersions'][number]|undefined;
 for(const candidate of ctx.credentialVersions){
  if(!candidate.credentials.webhookSecret||!candidate.externalAccountId)continue;
  const expected='sha256='+createHmac('sha256',candidate.credentials.webhookSecret).update(bytes).digest('hex');
  if(timingSafeEqual(Buffer.from(expected),Buffer.from(signature.toLowerCase()))){version=candidate;break;}
 }
 if(!version)throw new AppError(403,'Assinatura inválida.');
 let body:unknown;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(422,'Callback JSON inválido.');}
 const effective={...ctx,externalAccountId:version.externalAccountId!,identifiers:version.identifiers??ctx.identifiers};
 return {connectionId:ctx.id,credentialRevision:version.revision,bodyHash:createHash('sha256').update(bytes).digest('hex'),receivedAt:deps.now?.()??new Date().toISOString(),events:normalizeOpenwaEvents(body,effective)};
}
export async function handleChannelIngress(request:Request):Promise<Response>{
 try{
  const url=new URL(request.url),match=/^\/api\/channel-webhooks\/openwa\/([A-Za-z0-9_-]{8,100})$/.exec(url.pathname);
  if(!match||url.search)return new Response(null,{status:404});if(request.method!=='POST')return new Response(null,{status:405});
  const batch=await authenticateOpenwaWebhook(request,match[1]),{ingressPool}=await import('../ingress-db.ts');
  await ingressPool().query('SELECT app.ingest_channel_batch($1)',[JSON.stringify(batch)]);
  return new Response(null,{status:200,headers:{'cache-control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
