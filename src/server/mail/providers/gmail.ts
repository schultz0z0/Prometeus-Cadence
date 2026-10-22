import type {MailAdapter,MailConfig,MailDeps} from './contracts.ts';
import type {MailSend,MailMessage,SyncCursor} from '../../../domain/mail.ts';
import {composeMail,parseMail} from '../mime.ts';
import {normalizeMailAddress} from '../../../domain/mail-policy.ts';
import {readBoundedBody} from '../../channels/providers/http.ts';
const root='https://gmail.googleapis.com/gmail/v1/users/me';
export async function gmailRequest(path:string,config:MailConfig,deps:MailDeps,init:RequestInit={}){
 const u=new URL(path,root+'/');if(u.origin!=='https://gmail.googleapis.com'||!u.pathname.startsWith('/gmail/v1/users/me/')||u.username||u.password)throw Error('GMAIL_URL_REJECTED');
 const response=await(deps.fetch??fetch)(u.toString(),{...init,redirect:'error',signal:AbortSignal.timeout(30000),headers:{authorization:'Bearer '+config.credentials.accessToken,'content-type':'application/json',...init.headers}});
 let data:any;try{data=JSON.parse(Buffer.from(await readBoundedBody(response,4194304)).toString('utf8'));}catch{throw Error('GMAIL_RESPONSE_INVALID');}
 const retry=Number(response.headers.get('retry-after')),retryDate=Date.parse(response.headers.get('retry-after')??'');
 return {data,status:response.status,ok:response.ok,retryAfterMs:response.headers.has('retry-after')?(Number.isFinite(retry)?Math.max(0,retry*1000):Number.isFinite(retryDate)?Math.max(0,retryDate-Date.now()):null):null};
}
function requireSuccess(r:{ok:boolean;status:number;data:any}){if(!r.ok)throw Error(r.status===404?'GMAIL_HISTORY_EXPIRED':'GMAIL_API_FAILED');return r.data;}
export async function readGmailRaw(config:MailConfig,id:string,deps:MailDeps):Promise<MailMessage&{labels:string[]}>{
 const placeholder=async()=>{
  const q=new URLSearchParams({format:'metadata'});for(const name of ['From','To','Subject','Message-ID','In-Reply-To','References'])q.append('metadataHeaders',name);
  const data=requireSuccess(await gmailRequest('messages/'+encodeURIComponent(id)+'?'+q,config,deps)),hs=data.payload?.headers;
  if(!Number.isFinite(data.sizeEstimate)||data.sizeEstimate<=2097152||!/^\d{1,20}$/.test(String(data.internalDate))||!Array.isArray(hs)||hs.length>200)throw Error('GMAIL_MESSAGE_INVALID');
  const allowed=new Set(['from','to','subject','message-id','in-reply-to','references']);const headers=hs.filter((h:any)=>typeof h.name==='string'&&allowed.has(h.name.toLowerCase()));if(headers.some((h:any)=>typeof h.value!=='string'||/[\r\n\x00]/.test(h.value)))throw Error('GMAIL_MESSAGE_INVALID');
  const raw=headers.map((h:any)=>h.name+': '+h.value).join('\r\n');if(Buffer.byteLength(raw)>65536)throw Error('GMAIL_MESSAGE_INVALID');
  const labels=Array.isArray(data.labelIds)?data.labelIds:[],parsed=await parseMail([Buffer.from(raw+'\r\n\r\nConteúdo acima do limite de leitura. Confira a mensagem original na caixa.')],{remoteId:id,remoteThreadId:typeof data.threadId==='string'?data.threadId:null,receivedAt:new Date(Number(data.internalDate)).toISOString(),direction:labels.includes('SENT')?'outbound':'inbound'});
  return {...parsed,truncated:true,classification:'ambiguous' as const,labels};
 };
 let data:any;try{data=requireSuccess(await gmailRequest('messages/'+encodeURIComponent(id)+'?format=raw',config,deps));}catch(error){if(error instanceof Error&&error.message==='GMAIL_RESPONSE_INVALID')return placeholder();throw error;}
 if(typeof data.raw!=='string'||!/^\d{1,20}$/.test(String(data.internalDate)))throw Error('GMAIL_MESSAGE_INVALID');if(data.raw.length>2796204)return placeholder();
 const labels=Array.isArray(data.labelIds)?data.labelIds:[],bytes=Buffer.from(data.raw,'base64url');
 if(bytes.length>2097152)return placeholder();
 const parsed=await parseMail([bytes],{remoteId:id,remoteThreadId:typeof data.threadId==='string'?data.threadId:null,receivedAt:new Date(Number(data.internalDate)).toISOString(),direction:labels.includes('SENT')?'outbound':'inbound'});
 return {...parsed,labels};
}
export function createGmailAdapter(deps:MailDeps={}):MailAdapter {
 const now=()=>deps.now?.()??new Date().toISOString();
 return {
  async verify(config){const profile=requireSuccess(await gmailRequest('profile',config,deps)),address=normalizeMailAddress(profile.emailAddress);if(config.mailbox.address&&address!==config.mailbox.address)throw Error('GMAIL_ACCOUNT_CHANGED');requireSuccess(await gmailRequest('messages?maxResults=1',config,deps));return {address,send:true,read:true};},
  async sendOnce(config,send){
   const bytes=await composeMail(send);
   try{
    const r=await gmailRequest('messages/send',config,deps,{method:'POST',body:JSON.stringify({raw:bytes.toString('base64url'),...(send.thread?.remoteThreadId?{threadId:send.thread.remoteThreadId}:{})})});
    if(r.ok&&typeof r.data.id==='string'&&r.data.id)return {kind:'accepted',remoteId:r.data.id,acceptedAt:now()};
    if([400,401,403,404,413,429].includes(r.status))return {kind:'not_accepted',code:'GMAIL_HTTP_'+r.status,retryable:r.status===429||(r.status===403&&r.data.error?.errors?.some((e:any)=>['rateLimitExceeded','userRateLimitExceeded'].includes(e.reason))),retryAfterMs:r.retryAfterMs};
    return {kind:'uncertain',code:'GMAIL_SEND_RESULT_MISSING'};
   }catch{return {kind:'uncertain',code:'GMAIL_SEND_RESULT_MISSING'};}
  },
  async readBatch(config,cursor,budget){
   if(!Number.isInteger(budget.maxMessages)||budget.maxMessages<1||budget.maxMessages>100||!Number.isInteger(budget.maxPages)||budget.maxPages<1||budget.maxPages>5)throw Error('GMAIL_SYNC_BUDGET_INVALID');
   if(!cursor){const profile=requireSuccess(await gmailRequest('profile',config,deps));if(!/^\d{1,40}$/.test(profile.historyId))throw Error('GMAIL_HISTORY_INVALID');return {messages:[],next:{kind:'gmail',historyId:profile.historyId,pageToken:null,watermark:now()},complete:true,gap:false};}
   if(cursor.kind!=='gmail')throw Error('GMAIL_CURSOR_INVALID');
   const messages:MailMessage[]=[],seen=new Set<string>();let page=cursor.pageToken,historyId=cursor.historyId,complete=false,pending=cursor.pending,readCount=0;
   for(let n=0;n<budget.maxPages;n++){
    const q=new URLSearchParams({startHistoryId:cursor.historyId,maxResults:String(budget.maxMessages),historyTypes:'messageAdded'});if(page)q.set('pageToken',page);
    const data=pending?{historyId:pending.historyId,nextPageToken:pending.pageToken,history:[{messagesAdded:pending.ids.map(id=>({message:{id}}))}]}:requireSuccess(await gmailRequest('history?'+q,config,deps));pending=undefined;
    const ids:string[]=[];for(const h of data.history??[])for(const item of h.messagesAdded??[]){const id=item.message?.id;if(typeof id!=='string'||seen.has(id))continue;if(id.length>100||ids.length>=500)throw Error('GMAIL_HISTORY_RECORD_TOO_LARGE');seen.add(id);ids.push(id);}
    if(typeof data.historyId!=='string'||!/^\d{1,40}$/.test(data.historyId))throw Error('GMAIL_HISTORY_INVALID');historyId=data.historyId;
    page=typeof data.nextPageToken==='string'?data.nextPageToken:null;
    const take=Math.min(ids.length,budget.maxMessages-readCount);
    for(const id of ids.slice(0,take)){const mail=await readGmailRaw(config,id,deps);readCount++;if(mail.labels.includes('INBOX')||mail.labels.includes('SENT'))messages.push(mail);}
    if(take<ids.length){pending={ids:ids.slice(take),historyId,pageToken:page};break;}
    if(!page){complete=true;break;}if(readCount>=budget.maxMessages)break;
   }
   return {messages,next:{kind:'gmail',historyId:complete?historyId:cursor.historyId,pageToken:page,watermark:complete?now():cursor.watermark,...(pending?{pending}:{})},complete,gap:false};
  },
  async findSent(config,send){
   const profile=requireSuccess(await gmailRequest('profile',config,deps));if(normalizeMailAddress(profile.emailAddress)!==send.address)return null;
   const q=new URLSearchParams({q:'in:sent rfc822msgid:'+send.rfcMessageId,maxResults:'10'}),found=requireSuccess(await gmailRequest('messages?'+q,config,deps));
   for(const item of found.messages??[]){if(typeof item.id!=='string')continue;const mail=await readGmailRaw(config,item.id,deps);if(mail.labels.includes('SENT')&&mail.rfcMessageId===send.rfcMessageId&&mail.from===send.address&&mail.to.length===1&&mail.to[0]===send.to)return {kind:'accepted',remoteId:item.id,acceptedAt:mail.receivedAt};}
   return null;
  },
 };
}
