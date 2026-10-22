import 'server-only';
import type {SyncLease} from '../../../domain/mail.ts';
import type {MailAdapter,MailDeps} from '../providers/contracts.ts';
import {createGmailAdapter} from '../providers/gmail.ts';
import {createSmtpImapAdapter} from '../providers/smtp-imap.ts';
import {ensureSyncGmailAccess,heartbeatMailboxSync,failMailboxSync} from './repository.ts';
import {ingestMailBatch} from '../ingestion.ts';
import {recoverGmailBatch} from './gmail.ts';
import {recoverImapBatch} from './imap.ts';
export async function runMailboxSync(lease:SyncLease,deps:MailDeps&{adapter?:MailAdapter;maxMessages?:number;maxPages?:number}={}):Promise<{messages:number;complete:boolean;gap:boolean}> {
 const maxMessages=deps.maxMessages??100,maxPages=deps.maxPages??5;if(!Number.isInteger(maxMessages)||maxMessages<1||maxMessages>100||!Number.isInteger(maxPages)||maxPages<1||maxPages>5)throw Error("INVALID_SYNC_BUDGET");
 let heartbeatError=false;const timer=setInterval(()=>{void heartbeatMailboxSync(lease).catch(()=>{heartbeatError=true;});},15000);timer.unref();
 try{
  const config=await ensureSyncGmailAccess(lease,deps),adapter=deps.adapter??(config.mailbox.provider==='gmail'?createGmailAdapter(deps):createSmtpImapAdapter(deps));
  let batch;
  if(config.cursor?.recovery)batch=config.cursor.kind==='gmail'?await recoverGmailBatch(config,config.cursor,deps):await recoverImapBatch(config,config.cursor,{...deps,adapter});
  else try{batch=await adapter.readBatch(config,config.cursor,{maxMessages,maxPages});}catch(error){
   if(config.cursor?.kind==='gmail'&&error instanceof Error&&error.message==='GMAIL_HISTORY_EXPIRED')batch=await recoverGmailBatch(config,config.cursor,deps);
   else if(config.cursor?.kind==='imap'&&error instanceof Error&&error.message==='IMAP_UIDVALIDITY_CHANGED')batch=await recoverImapBatch(config,config.cursor,{...deps,adapter});
   else throw error;
  }
  if(heartbeatError)throw Error('STALE_SYNC_LEASE');
  await ingestMailBatch(lease,batch);return {messages:batch.messages.length,complete:batch.complete,gap:batch.gap||batch.messages.some(m=>m.truncated||m.classification==='ambiguous')};
 }catch(error){
  const code=error instanceof Error?error.message:'EMAIL_SYNC_FAILED',recovery=['GMAIL_HISTORY_EXPIRED','IMAP_UIDVALIDITY_CHANGED'].includes(code);
  await failMailboxSync(lease,recovery,recovery?code:'EMAIL_SYNC_FAILED');return {messages:0,complete:false,gap:recovery};
 }finally{clearInterval(timer);}
}
