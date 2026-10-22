import type {MailAdapter,MailConfig,MailDeps} from '../providers/contracts.ts';
import type {SyncCursor,SyncBatch} from '../../../domain/mail.ts';
import {createSmtpImapAdapter} from '../providers/smtp-imap.ts';
export async function recoverImapBatch(config:MailConfig,cursor:Extract<SyncCursor,{kind:'imap'}>,deps:MailDeps&{adapter?:MailAdapter;maxMessages?:number}={}):Promise<SyncBatch> {
 const adapter=deps.adapter??createSmtpImapAdapter(deps),since=cursor.recovery?.since??new Date(Date.parse(cursor.watermark)-300000).toISOString();
 let start=cursor;
 if(!cursor.recovery){const baseline=await adapter.readBatch(config,null,{maxMessages:deps.maxMessages??100,maxPages:1});if(baseline.next.kind!=='imap')throw Error('IMAP_RECOVERY_FAILED');start={...baseline.next,lastUid:0,watermark:cursor.watermark};}
 const batch=await adapter.readBatch(config,start,{maxMessages:100,maxPages:1});if(batch.next.kind!=='imap')throw Error('IMAP_RECOVERY_FAILED');
 return {...batch,messages:batch.messages.filter(m=>Date.parse(m.receivedAt)>=Date.parse(since)),gap:true,next:{...batch.next,watermark:cursor.watermark,...(!batch.complete?{recovery:{since}}:{})}};
}
