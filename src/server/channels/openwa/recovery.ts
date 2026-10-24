import 'server-only';import {randomUUID} from 'node:crypto';
import {dispatchPool} from '../../messaging/worker-db.ts';import {decryptCredential} from '../crypto.ts';import {createOpenwaClient,OpenwaClientError} from './client.ts';import {normalizeOpenwaEvents} from './events.ts';import type {IngressContext} from '../ingress-contracts.ts';import type {OpenwaRemoteMessage,OpenwaTickOptions} from '../../../domain/openwa.ts';import type {WebhookEvent} from '../../../domain/whatsapp.ts';
interface Lease {workspaceId:string;connectionId:string;revision:number;token:string;fence:number}
const args=(lease:Lease)=>[lease.workspaceId,lease.connectionId,lease.token,lease.fence];
function normalizeRead(message:OpenwaRemoteMessage,ctx:IngressContext):WebhookEvent[]{
 if(!/^\d{6,20}@(c\.us|s\.whatsapp\.net|lid)$/.test(message.chatId))return [];
 if(message.timestamp===null)throw new OpenwaClientError('OPENWA_RECOVERY_GAP');
 if(!message.fromMe&&(!message.from||!message.to||!message.type))throw new OpenwaClientError('OPENWA_RECOVERY_GAP');
 if(message.fromMe&&!['delivered','read','failed'].includes(message.status))return [];
 return normalizeOpenwaEvents({event:message.fromMe?'message.ack':'message.received',sessionId:message.sessionId,timestamp:new Date(message.timestamp*1000).toISOString(),deliveryId:randomUUID(),idempotencyKey:'gateway-read',data:message.fromMe?{id:message.remoteId,messageId:message.remoteId,chatId:message.chatId,status:message.status}:{id:message.remoteId,chatId:message.chatId,from:message.from,to:message.to,body:message.body,type:message.type,fromMe:false,isGroup:false,timestamp:message.timestamp}},ctx);
}
export async function runOpenwaRecoveryTick(options:OpenwaTickOptions&{maxMessages:number}){
 if(!Number.isFinite(Date.parse(options.now))||!Number.isInteger(options.maxConnections)||options.maxConnections<1||options.maxConnections>5||!Number.isInteger(options.maxMessages)||options.maxMessages<1||options.maxMessages>20)throw Error('Invalid OpenWA recovery scope');
 let processed=0,failed=0,remaining=options.maxMessages;
 for(let index=0;index<options.maxConnections&&!options.signal?.aborted;index++){
  const lease:Lease|null=(await dispatchPool().query('SELECT app.claim_openwa_recovery($1) AS value',[options.now])).rows[0].value;if(!lease)break;
  try{
   const scope=(await dispatchPool().query('SELECT app.read_openwa_recovery($1,$2,$3,$4,$5) AS value',[...args(lease),remaining])).rows[0].value,r=scope.recovery,c=scope.connection;
   if(Date.parse(r.window_until)-Date.parse(r.checkpoint)>900000)throw new OpenwaClientError('OPENWA_RECOVERY_GAP');
   const credentials=decryptCredential(scope.envelope,{workspaceId:lease.workspaceId,connectionId:lease.connectionId,provider:'openwa',revision:Number(lease.revision)}),origin=process.env.OPENWA_API_ORIGIN;
   if(!origin||!credentials.apiKey)throw new OpenwaClientError('OPENWA_CONFIG_INVALID');
   const deadline=AbortSignal.timeout(45000),signal=options.signal?AbortSignal.any([options.signal,deadline]):deadline;
   const client=createOpenwaClient({origin,apiKey:credentials.apiKey,fetchImpl:(url,init)=>fetch(url,{...init,signal:init?.signal?AbortSignal.any([signal,init.signal]):signal})});
   const ctx:IngressContext={id:lease.connectionId,workspaceId:lease.workspaceId,publicId:c.public_id,provider:'openwa',revision:Number(lease.revision),state:'ready',externalAccountId:c.external_account_id,identifiers:c.identifiers,senders:scope.senders,credentialVersions:[]};
   const page=await client.readMessages(c.identifiers.sessionId,{limit:20,since:Date.parse(r.checkpoint),until:Date.parse(r.window_until),...(r.cursor?{after:r.cursor}:{})});
   if(page.unknownTimestampTotal>0||page.nextCursor&&(r.pages>=4||page.nextCursor===r.cursor))throw new OpenwaClientError('OPENWA_RECOVERY_GAP');
   const events:WebhookEvent[]=[];
   for(const message of page.items){if(message.timestamp===null||message.timestamp*1000<Date.parse(r.checkpoint)||message.timestamp*1000>Date.parse(r.window_until))throw new OpenwaClientError('OPENWA_RECOVERY_GAP');events.push(...normalizeRead(message,ctx));}
   for(const receipt of scope.receipts){if(signal.aborted)break;remaining--;const found=await client.readRemoteMessage(c.identifiers.sessionId,receipt.remote_id);if(found&&found.fromMe&&found.chatId===receipt.external_id)events.push(...normalizeRead(found,ctx));}
   if(options.signal?.aborted)break;
   const result=(await dispatchPool().query('SELECT app.finish_openwa_recovery($1,$2,$3,$4,$5) AS value',[...args(lease),JSON.stringify({kind:'page',events,cursor:page.nextCursor})])).rows[0].value;if(result)processed++;
  }catch(error){if(options.signal?.aborted)break;failed++;try{await dispatchPool().query('SELECT app.finish_openwa_recovery($1,$2,$3,$4,$5)',[...args(lease),JSON.stringify({kind:'failure',code:error instanceof OpenwaClientError?error.code:'OPENWA_RECOVERY_FAILED'})]);}catch{/* Stale responses have no authority. */}}
 }
 return {processed,failed};
}
