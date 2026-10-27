import nodemailer from 'nodemailer';
import {MailParser} from 'mailparser';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseFragment} from 'parse5';
import type {MailSend,MailMessage} from '../../domain/mail.ts';
import {normalizeMailAddress,validateMailContent,renderMailBody} from '../../domain/mail-policy.ts';
export interface MailSource {remoteId:string;remoteThreadId:string|null;receivedAt:string;direction:'inbound'|'outbound'}
const maxBytes=2097152;
const rfcId=(value:string)=>/^<[^<>\s\x00-\x1f]{1,500}@[^<>\s\x00-\x1f]{1,253}>$/.test(value);
export async function composeMail(send:MailSend):Promise<Buffer> {
 if(validateMailContent(send.content).length||!rfcId(send.rfcMessageId))throw Error('MAIL_CONTENT_INVALID');
 const from=normalizeMailAddress(send.address),to=normalizeMailAddress(send.to),thread=send.thread;
 if(thread&&[thread.inReplyTo,...thread.references].some(v=>v!==null&&!rfcId(v)))throw Error('MAIL_REFERENCES_INVALID');
 if(thread&&thread.references.length>100)throw Error('MAIL_REFERENCES_INVALID');
 let text=renderMailBody(send.content);
 const headers:Record<string,string>={};
 if(send.purpose==='campaign'){
  if(!send.unsubscribeUrl)throw Error('MAIL_UNSUBSCRIBE_REQUIRED');
  const url=new URL(send.unsubscribeUrl);if(url.protocol!=='https:'||url.username||url.password||/[\r\n<>]/.test(send.unsubscribeUrl))throw Error('MAIL_UNSUBSCRIBE_INVALID');
  const token=url.pathname.match(/^\/unsubscribe\/([A-Za-z0-9_-]{43})$/)?.[1];if(!token||url.search||url.hash)throw Error('MAIL_UNSUBSCRIBE_INVALID');
  text=renderMailBody(send.content,url.toString());
  headers['List-Unsubscribe']='<'+new URL('/api/mail-unsubscribe/'+token+'/one-click',url).toString()+'>';
  headers['List-Unsubscribe-Post']='List-Unsubscribe=One-Click';
 }
 if(Buffer.byteLength(text)>65536)throw Error('MAIL_CONTENT_TOO_LARGE');
 const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows',disableFileAccess:true,disableUrlAccess:true});
 const attachments=send.resolvedAttachments??[];if(attachments.length>5||attachments.some(a=>!a.content.length||a.content.length>10485760||/[\r\n\\/]/.test(a.filename))||attachments.reduce((sum,a)=>sum+a.content.length,0)>20971520)throw Error('MAIL_ATTACHMENT_LIMIT');
 const result=await transport.sendMail({from,to,subject:send.content.subject,text,messageId:send.rfcMessageId,attachments:attachments.map(a=>({...a,content:Buffer.from(a.content)})),...(thread?.inReplyTo?{inReplyTo:thread.inReplyTo,references:thread.references}:{}),headers,disableFileAccess:true,disableUrlAccess:true});
 if(!Buffer.isBuffer(result.message)||result.message.length>30*1024*1024)throw Error('MAIL_MIME_TOO_LARGE');return result.message;
}
function plainHtml(html:string):string {
 const walk=(node:any):string=>{
  if(['script','style','head','img','iframe','object','svg'].includes(node.tagName))return '';
  if(node.nodeName==='#text')return node.value??'';
  return (node.childNodes??[]).map(walk).join(' ');
 };return walk(parseFragment(html)).replace(/\s+/g,' ').trim();
}
function boundUtf8(value:string,limit:number){const b=Buffer.from(value);if(b.length<=limit)return value;let end=limit;while(end>0&&(b[end]&192)===128)end--;return b.subarray(0,end).toString('utf8');}
export async function parseMail(source:AsyncIterable<Uint8Array>|Iterable<Uint8Array>,meta:MailSource):Promise<MailMessage> {
 const parser=new MailParser({skipTextToHtml:true,skipImageLinks:true,skipHtmlToText:true,keepDeliveryStatus:true,maxHtmlLengthToParse:maxBytes});
 let headers=new Map<string,any>(),text='',html='',limited=false,total=0,headerBytes=0,headersDone=false,headerTail='',deliveryStatus='';const originalIds:string[]=[];
 const attachments:MailMessage['attachments']=[];
 parser.on('headers',h=>{headers=h;if(h.size>200)limited=true;});
 parser.on('data',part=>{
  if(part.type==='attachment'){
   if(attachments.length<100)attachments.push({name:part.filename?boundUtf8(String(part.filename),255):null,type:boundUtf8(String(part.contentType??'application/octet-stream'),200),size:null});else limited=true;
   const report:Buffer[]=[];let reportSize=0;const isDsn=part.contentType==='message/delivery-status',isOriginal=['text/rfc822-headers','message/rfc822'].includes(part.contentType);
   if(isDsn||isOriginal)part.content.on('data',(chunk:Buffer)=>{if(reportSize<8192)report.push(Buffer.from(chunk.subarray(0,8192-reportSize)));reportSize+=chunk.length;if(isDsn&&reportSize>8192)limited=true;});
   const release=part.release;part.content.on('error',()=>{});part.content.once('end',()=>{if(report.length){const value=Buffer.concat(report).toString('utf8');if(isDsn)deliveryStatus=value;else if(isOriginal){const boundary=value.search(/\r?\n\r?\n/),header=boundary>=0?value.slice(0,boundary):value;if(boundary<0&&reportSize>8192)limited=true;const ids=header.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/).filter(line=>/^message-id:/i.test(line)).map(line=>line.slice(line.indexOf(':')+1).trim());if(ids.length!==1||!rfcId(ids[0]))limited=true;else originalIds.push(ids[0]);}}release?.();});part.content.resume();
  }else{if(part.text)text=part.text;if(typeof part.html==='string')html=part.html;}
 });
 const bound=new Transform({transform(chunk:Buffer,_encoding,done){
  total+=chunk.length;
  if(!headersDone){const combined=headerTail+chunk.toString('latin1'),index=combined.indexOf('\r\n\r\n'),lf=combined.indexOf('\n\n');headersDone=index>=0||lf>=0;headerBytes+=headersDone?Math.min(index<0?Infinity:index+4,lf<0?Infinity:lf+2)-headerTail.length:chunk.length;headerTail=combined.slice(-3);}
  if(total>maxBytes||headerBytes>65536){limited=true;done(Error('MAIL_LIMIT'));return;}done(null,chunk);
 }});
 try{await pipeline(Readable.from(source),bound,parser,{signal:AbortSignal.timeout(30000)});}catch{limited=true;}
 const addresses=(value:any):string[]=>{
  const result:string[]=[];for(const entry of value?.value??[])try{result.push(normalizeMailAddress(entry.address));}catch{limited=true;}
  return result;
 };
 const from=addresses(headers.get('from')),to=addresses(headers.get('to'));
 if(from.length!==1||!to.length)limited=true;
 text=text||plainHtml(html);if(Buffer.byteLength(text)>65536)limited=true;
 const references=headers.get('references'),refArray=typeof references==='string'?references.match(/<[^<>]+>/g)??[]:Array.isArray(references)?references:[];
 const refs=refArray.filter((v:unknown)=>typeof v==='string'&&rfcId(v));if(refs.length>100)limited=true;
 const facts:Record<string,string>={};for(const key of ['auto-submitted','precedence','x-autoreply','x-autorespond','content-type']){const value=headers.get(key);if(value)facts[key]=boundUtf8(typeof value==='string'?value:String(value.value??''),1000);}
 if(deliveryStatus&&originalIds.length){if(originalIds.length!==1||!/^multipart\/report\b/i.test(facts['content-type']??''))limited=true;else{const declared=deliveryStatus.match(/^original-message-id:[ \t]*(.+)$/gim)?.map(line=>line.slice(line.indexOf(':')+1).trim())??[];if(declared.length&&!(declared.length===1&&declared[0]===originalIds[0]))limited=true;else if(!declared.length){deliveryStatus+='\r\nOriginal-Message-ID: '+originalIds[0];if(Buffer.byteLength(deliveryStatus)>8192)limited=true;}}}
 return {...meta,rfcMessageId:typeof headers.get('message-id')==='string'?headers.get('message-id'):null,inReplyTo:typeof headers.get('in-reply-to')==='string'?headers.get('in-reply-to'):null,references:refs.slice(-100),from:from[0]??'',to,subject:boundUtf8(String(headers.get('subject')??''),1000),text:boundUtf8(text,65536),classification:limited?'ambiguous':'human',attachments,truncated:limited,headers:facts,...(deliveryStatus?{deliveryStatus}:{})};
}
