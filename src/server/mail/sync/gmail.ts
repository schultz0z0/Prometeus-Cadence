import type {MailConfig,MailDeps} from '../providers/contracts.ts';
import type {SyncCursor,SyncBatch,MailMessage} from '../../../domain/mail.ts';
import {gmailRequest,readGmailRaw} from '../providers/gmail.ts';
export async function recoverGmailBatch(config:MailConfig,cursor:Extract<SyncCursor,{kind:'gmail'}>,deps:MailDeps&{maxMessages?:number}={}):Promise<SyncBatch> {
 const maxMessages=deps.maxMessages??100;
 const since=cursor.recovery?.since??new Date(Date.parse(cursor.watermark)-300000).toISOString();
 let historyId=cursor.recovery?.historyId;
 if(!historyId){const r=await gmailRequest('profile',config,deps);if(!r.ok||!/^\d{1,40}$/.test(r.data.historyId))throw Error('GMAIL_RECOVERY_FAILED');historyId=r.data.historyId as string;}
 const query=new URLSearchParams({q:'in:inbox after:'+Math.floor(Date.parse(since)/1000),maxResults:String(maxMessages)});if(cursor.recovery?.pageToken)query.set('pageToken',cursor.recovery.pageToken);
 const result=await gmailRequest('messages?'+query,config,deps);if(!result.ok||!Array.isArray(result.data.messages??[]))throw Error('GMAIL_RECOVERY_FAILED');
 const messages:MailMessage[]=[];if((result.data.messages??[]).length>maxMessages)throw Error('GMAIL_RECOVERY_BUDGET');
 for(const item of result.data.messages??[]){if(typeof item.id!=='string')throw Error('GMAIL_RECOVERY_FAILED');const message=await readGmailRaw(config,item.id,deps);if(message.labels.includes('INBOX'))messages.push(message);}
 const pageToken=typeof result.data.nextPageToken==='string'?result.data.nextPageToken:null,complete=!pageToken;
 return {messages,complete,gap:true,next:{kind:'gmail',historyId:complete?historyId:cursor.historyId,pageToken:null,watermark:cursor.watermark,...(!complete?{recovery:{since,historyId,pageToken}}:{})}};
}
