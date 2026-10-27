import 'server-only';
import {setTimeout as delay} from 'node:timers/promises';
import type {DispatchLease,SendOutcome} from '../../domain/whatsapp.ts';
import type {MailSend} from '../../domain/mail.ts';
import type {MailConfig} from '../mail/contracts.ts';
import type {MailDeps,MailAdapter} from '../mail/providers/contracts.ts';
import {createGmailAdapter} from '../mail/providers/gmail.ts';
import {createSmtpImapAdapter} from '../mail/providers/smtp-imap.ts';
import {decryptCredential,encryptCredential} from '../channels/crypto.ts';
import {gmailOAuthSettings} from '../mail/oauth-protocol.ts';
import {tokenRequest} from '../mail/oauth.ts';
import {leaseArgs,heartbeatDispatch} from './lease.ts';
import {dispatchPool} from './worker-db.ts';
import {dispatchBlocker} from './guard.ts';
import {recordDispatchReceipt} from './receipts.ts';
import {dispatchTimeAllowed,nextStepAt} from './schedule.ts';
import {resolveDispatchFiles} from './dispatch-files.ts';
export type MailDispatchContext=Record<string,any>;
export function mailConfigFromDispatch(ctx:MailDispatchContext,workspaceId:string):MailConfig{
 const m=ctx.mailbox,c=ctx.connection,s=ctx.sender;
 return {mailbox:{id:m.id,senderId:s.id,provider:c.provider,name:c.name,address:m.address,revision:Number(c.revision),state:m.state,hasSecrets:true,sendVerified:m.send_verified,readVerified:m.read_verified,lastSyncedAt:m.last_synced_at,syncState:m.sync_state,dailyLimit:s.daily_limit,signature:m.signature,lastError:m.last_error},config:c.identifiers.config,credentials:decryptCredential(ctx.credentialEnvelope,{workspaceId,connectionId:c.id,provider:c.provider,revision:Number(c.revision)}),cursor:null};
}
export async function refreshDispatchMail(lease:DispatchLease,ctx:MailDispatchContext,deps:MailDeps={}):Promise<MailDispatchContext>{
 let config=mailConfigFromDispatch(ctx,lease.workspaceId);if(config.mailbox.provider!=='gmail')return ctx;
 const fresh=()=>config.credentials.accessToken&&Date.parse(config.credentials.expiresAt)>Date.parse(deps.now?.()??new Date().toISOString())+30000;
 const apply=async(action:string,envelope:unknown=null,expires:string|null=null,error:string|null=null)=>(await dispatchPool().query('SELECT app.dispatch_mail_refresh($1,$2,$3,$4,$5,$6,$7,$8,$9) AS ok',[...leaseArgs(lease),config.mailbox.revision,action,envelope,expires,error])).rows[0].ok;
 const read=async()=>{ctx=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS ctx',leaseArgs(lease))).rows[0].ctx;config=mailConfigFromDispatch(ctx,lease.workspaceId);};
 for(let n=0;n<100;n++){
  if(fresh())return ctx;if(!await apply('claim')){await delay(50);await read();continue;}
  await read();if(fresh()){await apply('failure',null,null,'already_fresh');return ctx;}
  let data:any;try{const settings=gmailOAuthSettings();data=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:settings.clientId,client_secret:settings.clientSecret,refresh_token:config.credentials.refreshToken}),deps);}
  catch(error){await apply('failure',null,null,error instanceof Error&&error.message==='GMAIL_INVALID_GRANT'?'invalid_grant':'refresh_failed');throw Error('GMAIL_REFRESH_FAILED');}
  const expiresAt=new Date(Date.parse(deps.now?.()??new Date().toISOString())+data.expires_in*1000).toISOString(),credentials={...config.credentials,accessToken:data.access_token,expiresAt,...(data.refresh_token?{refreshToken:data.refresh_token}:{})};
  const envelope=encryptCredential(credentials,{workspaceId:lease.workspaceId,connectionId:config.mailbox.id,provider:'gmail',revision:config.mailbox.revision});
  if(!await apply('commit',envelope,expiresAt))throw Error('STALE_DISPATCH_LEASE');await read();return ctx;
 }throw Error('GMAIL_REFRESH_BUSY');
}
export async function dispatchEmail(lease:DispatchLease,initial:MailDispatchContext,deps:MailDeps&{adapter?:MailAdapter}={}):Promise<void>{
 const now=()=>deps.now?.()??new Date().toISOString();let ctx=initial;
 try{ctx=await refreshDispatchMail(lease,ctx,deps);}catch{await dispatchPool().query('SELECT app.block_message_dispatch($1,$2,$3,$4,$5)',[...leaseArgs(lease),'MAIL_CREDENTIAL_UNAVAILABLE']);return;}
 const blocker=dispatchBlocker(ctx,now());if(blocker){await dispatchPool().query('SELECT app.block_message_dispatch($1,$2,$3,$4,$5)',[...leaseArgs(lease),blocker]);return;}
 if(ctx.publication?.id&&!dispatchTimeAllowed(now(),{...ctx.publication.snapshot.cadence.settings,holidayDates:null})){
  const next=nextStepAt({anchorAt:ctx.outbox.next_at,delayDays:0,now:now(),...ctx.publication.snapshot.cadence.settings,holidayDates:null});await dispatchPool().query('SELECT app.defer_message_dispatch($1,$2,$3,$4,$5)',[...leaseArgs(lease),next]);return;
 }
 const config=mailConfigFromDispatch(ctx,lease.workspaceId),adapter=deps.adapter??(config.mailbox.provider==='gmail'?createGmailAdapter(deps):createSmtpImapAdapter(deps));
 let resolvedAttachments:Awaited<ReturnType<typeof resolveDispatchFiles>>;try{resolvedAttachments=await resolveDispatchFiles(lease);}catch{await dispatchPool().query('SELECT app.block_message_dispatch($1,$2,$3,$4,$5)',[...leaseArgs(lease),'ATTACHMENT_UNAVAILABLE']);return;}
 const gate=(await dispatchPool().query('SELECT app.begin_message_dispatch($1,$2,$3,$4,$5,$6,$7)',[lease.workspaceId,lease.messageId,lease.attemptId,lease.token,lease.fence,ctx.guard,now()])).rows[0].begin_message_dispatch;if(!gate?.allowed)return;
 const heartbeat=setInterval(()=>{void heartbeatDispatch(lease).catch(()=>{});},15000);heartbeat.unref();
 let outcome:SendOutcome;try{outcome=await adapter.sendOnce(config,{...ctx.outbox.prepared_send,resolvedAttachments} as MailSend);}catch{outcome={kind:'uncertain',code:'MAIL_SEND_RESULT_MISSING'};}finally{clearInterval(heartbeat);}
 await recordDispatchReceipt(lease,{attemptId:lease.attemptId,outcome,costUsd:null,costKind:'unknown'},now());
}
