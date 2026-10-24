import 'server-only';
import type {DispatchLease,SendOutcome,PreparedSend} from '../../domain/whatsapp.ts';
import type {ProviderAdapter,ProviderConfig} from '../channels/providers/contracts.ts';
import {decryptCredential} from '../channels/crypto.ts';
import {senderView} from '../channels/repository.ts';
import {providerAdapter} from '../channels/connections.ts';
import {channelCallbackUrl} from '../channels/webhook-auth.ts';
import {leaseArgs,heartbeatDispatch} from './lease.ts';
import {dispatchPool} from './worker-db.ts';
import {dispatchBlocker} from './guard.ts';
import {recordDispatchReceipt} from './receipts.ts';
import {dispatchTimeAllowed,nextStepAt} from './schedule.ts';
import {dispatchEmail} from './email-dispatch.ts';
import type {MailAdapter,MailDeps} from '../mail/providers/contracts.ts';
export async function dispatchOne(lease:DispatchLease,deps:{adapter?:ProviderAdapter;mailAdapter?:MailAdapter;mailDeps?:MailDeps;now:()=>string}):Promise<void>{
 try{await heartbeatDispatch(lease);}catch{return;}
 const ctx=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS context',leaseArgs(lease))).rows[0].context;if(!ctx)return;
 if(ctx.outbox?.prepared_send?.channel==='EMAIL'){await dispatchEmail(lease,ctx,{...deps.mailDeps,now:deps.now,adapter:deps.mailAdapter});return;}
 let blocker=dispatchBlocker(ctx,deps.now()),config:ProviderConfig|undefined,callback:string|undefined;
 if(!blocker&&ctx.publication?.id){
  const settings=ctx.publication.snapshot.cadence.settings,now=deps.now();
  if(!dispatchTimeAllowed(now,{...settings,holidayDates:null})){
   const next=nextStepAt({anchorAt:ctx.outbox.next_at,delayDays:0,now,...settings,holidayDates:null});
   await dispatchPool().query('SELECT app.defer_message_dispatch($1,$2,$3,$4,$5)',[...leaseArgs(lease),next]);return;
  }
 }
 if(!blocker){try{
  const connection=ctx.connection,send=ctx.outbox.prepared_send as PreparedSend;
  const credentials=decryptCredential(ctx.credentialEnvelope,{workspaceId:lease.workspaceId,connectionId:connection.id,provider:connection.provider,revision:send.connectionRevision});
  config={provider:connection.provider,connectionId:connection.id,revision:Number(connection.revision),identifiers:connection.identifiers,credentials,sender:senderView(ctx.sender),templates:ctx.template?[ctx.template]:[]};
  if(connection.provider!=='openwa'){callback=channelCallbackUrl(connection.provider,connection.public_id,'status');if(connection.provider==='twilio')callback+='?attempt='+encodeURIComponent(lease.attemptId);}
 }catch{blocker='CREDENTIAL_OR_CALLBACK_UNAVAILABLE';}}
 if(blocker){await dispatchPool().query('SELECT app.block_message_dispatch($1,$2,$3,$4,$5)',[...leaseArgs(lease),blocker]);return;}
 const gate=(await dispatchPool().query('SELECT app.begin_message_dispatch($1,$2,$3,$4,$5,$6,$7)',[lease.workspaceId,lease.messageId,lease.attemptId,lease.token,lease.fence,ctx.guard,deps.now()])).rows[0].begin_message_dispatch;if(!gate?.allowed)return;
 let outcome:SendOutcome;
 try{outcome=await (deps.adapter??providerAdapter(config!.provider)).sendOnce(config!,{...ctx.outbox.prepared_send,traceId:lease.attemptId},callback!);}catch{outcome={kind:'uncertain',code:'TRANSPORT_RESPONSE_MISSING'};}
 await recordDispatchReceipt(lease,{attemptId:lease.attemptId,outcome,costUsd:null,costKind:'unknown'},deps.now());
}
