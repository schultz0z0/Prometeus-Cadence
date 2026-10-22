import nodemailer,{type Transporter,type SMTPTransportOptions,type SMTPSentMessageInfo} from 'nodemailer';
import {ImapFlow,type ImapFlowOptions} from 'imapflow';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import type {MailAdapter,MailConfig,MailDeps} from './contracts.ts';
import type {MailSend,MailMessage} from '../../../domain/mail.ts';
import type {SmtpImapConfig} from '../contracts.ts';
import {composeMail,parseMail} from '../mime.ts';
import {resolveMailEndpoint,pinnedMailSocketOptions} from '../network.ts';
import {normalizeMailAddress} from '../../../domain/mail-policy.ts';
export interface SmtpImapDeps extends MailDeps {
 smtpTransport?:(options:SMTPTransportOptions)=>Transporter<SMTPSentMessageInfo>;
 imapClient?:(options:ImapFlowOptions)=>ImapFlow;
}
function settings(config:MailConfig):SmtpImapConfig {if(config.mailbox.provider!=='smtp-imap'||!('smtpHost'in config.config))throw Error('SMTP_CONFIG_INVALID');return config.config as SmtpImapConfig;}
export function createMailboxChallenge(connectionId:string,revision:number){
 const nonce=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(JSON.stringify([connectionId,revision,nonce])).digest('hex');
 return {nonce,hash,text:'Confirmação da caixa Prometeus Cadence\n\n'+nonce+'\n\nEsta mensagem confirma somente a conexão da própria caixa.'};
}
export function matchMailboxChallenge(mail:MailMessage,expected:{connectionId:string;revision:number;address:string;hash:string;nonce:string}):boolean {
 if(!/^[a-f0-9]{64}$/.test(expected.hash)||! /^[A-Za-z0-9_-]{43}$/.test(expected.nonce))return false;
 const hash=createHash('sha256').update(JSON.stringify([expected.connectionId,expected.revision,expected.nonce])).digest();
 return timingSafeEqual(hash,Buffer.from(expected.hash,'hex'))&&mail.direction==='inbound'&&!mail.truncated&&mail.to.includes(expected.address)&&mail.from===expected.address&&mail.text.split(/\s+/).includes(expected.nonce);
}
export function createSmtpImapAdapter(deps:SmtpImapDeps={}):MailAdapter {
 const now=()=>deps.now?.()??new Date().toISOString();
 async function smtp(config:MailConfig){
  const s=settings(config),endpoint=await resolveMailEndpoint(s.smtpHost,s.smtpPort,'smtp',deps.network),{host,port,...tls}=pinnedMailSocketOptions(endpoint);
  const options:SMTPTransportOptions={host,port,secure:s.smtpPort===465,requireTLS:s.smtpPort===587,auth:{user:s.smtpUser,pass:config.credentials.smtpPassword},tls,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,pool:false};
  return deps.smtpTransport?.(options)??nodemailer.createTransport(options);
 }
 async function imap(config:MailConfig){
  const s=settings(config),endpoint=await resolveMailEndpoint(s.imapHost,s.imapPort,'imap',deps.network),{host,port,...tls}=pinnedMailSocketOptions(endpoint);
  const options:ImapFlowOptions={host,port,servername:endpoint.servername,secure:true,tls,auth:{user:s.imapUser,pass:config.credentials.imapPassword,loginMethod:'LOGIN'},logger:false,logRaw:false,disableAutoIdle:true,disableCompression:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:30000,maxLockHoldTime:30000};
  const client=deps.imapClient?.(options)??new ImapFlow(options);client.on('error',()=>{});
  try{await client.connect();return client;}catch(error){client.close();throw error;}
 }
 const logout=async(client:ImapFlow)=>{try{await client.logout();}catch{client.close();}};
 const readFolder:MailAdapter['readBatch']=async(config,cursor,budget)=>{
   if(!Number.isInteger(budget.maxMessages)||budget.maxMessages<1||budget.maxMessages>100)throw Error('IMAP_SYNC_BUDGET_INVALID');
   const client=await imap(config),folder=settings(config).inbox;
   try{
    const lock=await client.getMailboxLock(folder,{readOnly:true,acquireTimeout:10000});
    try{
     const box=client.mailbox;if(!box)throw Error('IMAP_MAILBOX_UNAVAILABLE');const validity=String(box.uidValidity),high=Math.max(0,Number(box.uidNext)-1);
     if(!cursor)return {messages:[],next:{kind:'imap',path:folder,uidValidity:validity,lastUid:high,watermark:now()},complete:true,gap:false};
     if(cursor.kind!=='imap'||cursor.path!==folder)throw Error('IMAP_CURSOR_INVALID');if(cursor.uidValidity!==validity)throw Error('IMAP_UIDVALIDITY_CHANGED');
     const end=Math.min(high,cursor.lastUid+budget.maxMessages),messages:MailMessage[]=[];
     if(end>cursor.lastUid){
      const found=[];for await(const item of client.fetch((cursor.lastUid+1)+':'+end,{uid:true,size:true,internalDate:true,envelope:true},{uid:true}))found.push(item);
      for(const item of found){
       if(item.uid<=cursor.lastUid||item.uid>end)continue;const remoteId=folder+':'+validity+':'+item.uid,receivedAt=item.internalDate instanceof Date?item.internalDate.toISOString():now();
       if(Number(item.size)>2097152){messages.push({remoteId,remoteThreadId:null,rfcMessageId:item.envelope?.messageId??null,inReplyTo:null,references:[],from:item.envelope?.from?.[0]?.address??'',to:(item.envelope?.to??[]).map(a=>a.address??''),subject:item.envelope?.subject??'',text:'Mensagem acima do limite de processamento.',receivedAt,direction:'inbound',classification:'ambiguous',attachments:[],truncated:true});continue;}
       const download=await client.download(item.uid,undefined,{uid:true,maxBytes:2097153});if(!download.content)throw Error('IMAP_DOWNLOAD_MISSING');messages.push(await parseMail(download.content,{remoteId,remoteThreadId:null,receivedAt,direction:'inbound'}));
      }
     }
     const complete=end>=high;return {messages,next:{kind:'imap',path:folder,uidValidity:validity,lastUid:Math.max(cursor.lastUid,end),watermark:complete?now():cursor.watermark},complete,gap:false};
    }finally{lock.release();}
   }finally{await logout(client);}
 };
 return {
  async verify(config){const transport=await smtp(config);try{await transport.verify();}finally{transport.close();}const client=await imap(config);try{const lock=await client.getMailboxLock(settings(config).inbox,{readOnly:true,acquireTimeout:10000});lock.release();}finally{await logout(client);}return {address:normalizeMailAddress(config.mailbox.address??''),send:true,read:true};},
  async sendOnce(config,send){
   const bytes=await composeMail(send);let transport:Transporter<SMTPSentMessageInfo>;
   try{transport=await smtp(config);}catch{return {kind:'not_accepted',code:'MAIL_DESTINATION_UNAVAILABLE',retryable:false,retryAfterMs:null};}
   try{
    const result=await transport.sendMail({envelope:{from:normalizeMailAddress(send.address),to:[normalizeMailAddress(send.to)]},raw:bytes,disableFileAccess:true,disableUrlAccess:true});
    if(result.accepted?.length===1&&String(result.accepted[0])===send.to)return {kind:'accepted',remoteId:send.rfcMessageId,acceptedAt:now()};
    return {kind:'uncertain',code:'SMTP_ACCEPTANCE_UNCONFIRMED'};
   }catch(error){
    const e=error as {responseCode?:number;command?:string;code?:string};
    if(e.responseCode&&e.responseCode>=400&&e.responseCode<600)return {kind:'not_accepted',code:'SMTP_'+e.responseCode,retryable:e.responseCode<500,retryAfterMs:null};
    return {kind:'uncertain',code:'SMTP_SEND_RESULT_MISSING'};
   }finally{transport.close();}
  },
  async readBatch(config,cursor,budget){
   const conf=settings(config),sent=conf.sentFolder;
   if(!sent||sent===conf.inbox)return readFolder(config,cursor,budget);
   if(budget.maxMessages<2)throw Error('IMAP_SYNC_BUDGET_INVALID');
   const inbox=await readFolder(config,cursor,{...budget,maxMessages:Math.ceil(budget.maxMessages/2)});
   const sentCursor=cursor?.kind==='imap'?cursor.sent??null:null;
   const sentBatch=await readFolder({...config,config:{...conf,inbox:sent,sentFolder:null}},sentCursor,{...budget,maxMessages:Math.floor(budget.maxMessages/2)});
   if(inbox.next.kind!=='imap'||sentBatch.next.kind!=='imap')throw Error('IMAP_CURSOR_INVALID');
   return {messages:[...inbox.messages,...sentBatch.messages.map(m=>({...m,direction:'outbound' as const}))],next:{...inbox.next,sent:sentBatch.next},complete:inbox.complete&&sentBatch.complete,gap:inbox.gap||sentBatch.gap};
  },
  async findSent(config,send){
   const folder=settings(config).sentFolder;if(!folder)return null;const client=await imap(config);
   try{const lock=await client.getMailboxLock(folder,{readOnly:true,acquireTimeout:10000});try{
    const found=await client.search({header:{'Message-ID':send.rfcMessageId}},{uid:true});if(!found)return null;
    for(const uid of found.slice(0,10)){const meta=await client.fetchOne(uid,{size:true,internalDate:true},{uid:true});if(!meta||Number(meta.size)>2097152)continue;const data=await client.download(uid,undefined,{uid:true,maxBytes:2097153});
     if(!data.content)throw Error('IMAP_DOWNLOAD_MISSING');const mail=await parseMail(data.content,{remoteId:send.rfcMessageId,remoteThreadId:null,receivedAt:meta.internalDate instanceof Date?meta.internalDate.toISOString():now(),direction:'outbound'});
     if(!mail.truncated&&mail.rfcMessageId===send.rfcMessageId&&mail.from===send.address&&mail.to.length===1&&mail.to[0]===send.to)return {kind:'accepted',remoteId:send.rfcMessageId,acceptedAt:mail.receivedAt};
    }return null;
   }finally{lock.release();}}finally{await logout(client);}
  },
 };
}
