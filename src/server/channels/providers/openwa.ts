import {z} from 'zod';
import type {PreparedSend,SendOutcome} from '../../../domain/whatsapp.ts';
import type {ProviderAdapter,ProviderConfig} from './contracts.ts';import {ChannelProviderError} from './contracts.ts';
import {createOpenwaClient} from '../openwa/client.ts';import {openwaId,parseOpenwaSend} from '../openwa/wire.ts';import {readBoundedBody} from './http.ts';
function gateway(config:ProviderConfig,fetchImpl:typeof fetch){
 const origin=process.env.OPENWA_API_ORIGIN;if(!origin||config.provider!=='openwa'||!config.credentials.apiKey)throw new ChannelProviderError('OPENWA_CONFIG_INVALID');
 const sessionId=openwaId.parse(config.identifiers.sessionId),client=createOpenwaClient({origin,apiKey:config.credentials.apiKey,fetchImpl});return {origin,sessionId,client};
}
const refused=(code:string):SendOutcome=>({kind:'not_accepted',code,retryable:false,retryAfterMs:null});
export function createOpenwaAdapter(fetchImpl:typeof fetch=fetch):ProviderAdapter{return {
 async verifyAssets(config){const {client,sessionId}=gateway(config,fetchImpl),session=await client.readSession(sessionId);if(session.status!=='ready'||!session.engineLoaded||!session.phone||session.restriction)throw new ChannelProviderError('OPENWA_SESSION_UNAVAILABLE');return {externalAccountId:sessionId,tokenExpiresAt:null,senders:[{externalId:'+'+session.phone,address:'+'+session.phone,identityScope:'openwa:'+config.connectionId,capabilities:{supportsText:true,supportsOfficialTemplates:false,requiresServiceWindow:false}}]};},
 async listTemplates(){return [];},
 async sendOnce(config,send:PreparedSend):Promise<SendOutcome>{
  let remote:ReturnType<typeof gateway>;
  try{remote=gateway(config,fetchImpl);}catch{return refused('OPENWA_CONFIG_INVALID');}
  if(!send.traceId||!z.uuid().safeParse(send.traceId).success||send.connectionId!==config.connectionId||send.connectionRevision!==config.revision||send.senderId!==config.sender?.id||send.identity.scope!=='openwa:'+config.connectionId||!config.sender.ready)return refused('OPENWA_SEND_SCOPE_INVALID');
  if(send.content.kind!=='text'||!send.content.text.trim()||send.content.text.length>4096||/\{\{[^{}]*\}\}/.test(send.content.text))return refused('OPENWA_TEXT_REQUIRED');
  const chatId=send.identity.externalId;
  if(!/^\d{6,20}@(c\.us|s\.whatsapp\.net|lid)$/.test(chatId))return refused('OPENWA_RECIPIENT_INVALID');
  try{
   const response=await fetchImpl(new URL(`/api/sessions/${remote.sessionId}/messages/send-text`,remote.origin),{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000),headers:{'x-api-key':config.credentials.apiKey,'idempotency-key':send.traceId,'content-type':'application/json'},body:JSON.stringify({chatId,text:send.content.text})});
   const bytes=await readBoundedBody(response,1048576);const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   if(response.status===201){const accepted=parseOpenwaSend(body);return {kind:'accepted',remoteId:accepted.messageId,acceptedAt:new Date(accepted.timestamp*1000).toISOString()};}
   // Only explicit validation/authentication refusals are proven pre-send. Engine failures can carry 4xx.
   if(response.status===400&&body?.code==='IDEMPOTENCY_KEY_INVALID')return refused('OPENWA_REQUEST_INVALID');
   if(response.status===401)return refused('OPENWA_AUTH_REJECTED');
   if(response.status===400&&body?.error==='Bad Request'&&typeof body.message==='string'&&body.message===`WhatsApp could not resolve the recipient ${chatId}. Either the number is not on WhatsApp, or this session has no existing chat with it — message it once from the phone, then retry.`)return refused('OPENWA_RECIPIENT_UNREACHABLE');
   const code=typeof body?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(body.code)?body.code:'OPENWA_RESPONSE_UNCERTAIN';
   return {kind:'uncertain',code};
  }catch{return {kind:'uncertain',code:'OPENWA_RESPONSE_MISSING'};}
 },
 async lookupMessage(config,remoteId){
  try{const {sessionId,client}=gateway(config,fetchImpl),message=await client.readRemoteMessage(sessionId,remoteId);
   if(!message||!message.fromMe||message.timestamp===null||!config.sender?.address||!/^\d{6,20}@(c\.us|s\.whatsapp\.net|lid)$/.test(message.chatId))return null;
   return {kind:'accepted',remoteId:message.remoteId,acceptedAt:new Date(message.timestamp*1000).toISOString(),evidence:{accountId:sessionId,from:config.sender.address,to:message.chatId,status:message.status}};
  }catch{return null;}
 },
};}
