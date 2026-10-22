import nodemailer from 'nodemailer';
import {MailParser} from 'mailparser';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parseFragment} from 'parse5';
import type {MailSend,MailMessage} from '../../domain/mail.ts';
import {normalizeMailAddress,validateMailContent} from '../../domain/mail-policy.ts';
export interface MailSource {remoteId:string;remoteThreadId:string|null;receivedAt:string;direction:'inbound'|'outbound'}
const maxBytes=2097152;
const rfcId=(value:string)=>/^<[^<>\s\x00-\x1f]{1,500}@[^<>\s\x00-\x1f]{1,253}>$/.test(value);
export async function composeMail(send:MailSend):Promise<Buffer> {
 if(validateMailContent(send.content).length||!rfcId(send.rfcMessageId))throw Error('MAIL_CONTENT_INVALID');
 const from=normalizeMailAddress(send.address),to=normalizeMailAddress(send.to),thread=send.thread;
 if(thread&&[thread.inReplyTo,...thread.references].some(v=>v!==null&&!rfcId(v)))throw Error('MAIL_REFERENCES_INVALID');
 if(thread&&thread.references.length>100)throw Error('MAIL_REFERENCES_INVALID');
 let text=send.content.text+(send.content.signature?'\n\n'+send.content.signature:'');
 const headers:Record<string,string>={};
 if(send.purpose==='campaign'){
  if(!send.unsubscribeUrl)throw Error('MAIL_UNSUBSCRIBE_REQUIRED');
  const url=new URL(send.unsubscribeUrl);if(url.protocol!=='https:'||url.username||url.password||/[\r\n<>]/.test(send.unsubscribeUrl))throw Error('MAIL_UNSUBSCRIBE_INVALID');
  text+='\n\nPara não receber mais e-mails: '+url.toString();
  headers['List-Unsubscribe']='<'+url.toString().replace(/\/$/,'')+'/one-click>';
  headers['List-Unsubscribe-Post']='List-Unsubscribe=One-Click';
 }
 if(Buffer.byteLength(text)>65536)throw Error('MAIL_CONTENT_TOO_LARGE');
 const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'windows',disableFileAccess:true,disableUrlAccess:true});
 const result=await transport.sendMail({from,to,subject:send.content.subject,text,messageId:send.rfcMessageId,...(thread?.inReplyTo?{inReplyTo:thread.inReplyTo,references:thread.references}:{}),headers,disableFileAccess:true,disableUrlAccess:true});
 if(!Buffer.isBuffer(result.message)||result.message.length>maxBytes)throw Error('MAIL_MIME_TOO_LARGE');return result.message;
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
 let headers=new Map<string,any>(),text='',html='',limited=false,total=0,headerBytes=0,headersDone=false,headerTail='',deliveryStatus='';
 const attachments:MailMessage['attachments']=[];
 parser.on('headers',h=>{headers=h;if(h.size>200)limited=true;});
 parser.on('data',part=>{
  if(part.type==='attachment'){
   if(attachments.length<100)attachments.push({name:part.filename?boundUtf8(String(part.filename),255):null,type:boundUtf8(String(part.contentType??'application/octet-stream'),200),size:null});else limited=true;
   const report:Buffer[]=[];let reportSize=0;
   if(part.contentType==='message/delivery-status')part.content.on('data',(chunk:Buffer)=>{reportSize+=chunk.length;if(reportSize<=8192)report.push(Buffer.from(chunk));else limited=true;});
   const release=part.release;part.content.on('error',()=>{});part.content.once('end',()=>{if(report.length)deliveryStatus=Buffer.concat(report).toString('utf8');release?.();});part.content.resume();
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
 return {...meta,rfcMessageId:typeof headers.get('message-id')==='string'?headers.get('message-id'):null,inReplyTo:typeof headers.get('in-reply-to')==='string'?headers.get('in-reply-to'):null,references:refs.slice(-100),from:from[0]??'',to,subject:boundUtf8(String(headers.get('subject')??''),1000),text:boundUtf8(text,65536),classification:limited?'ambiguous':'human',attachments,truncated:limited,headers:facts,...(deliveryStatus?{deliveryStatus}:{})};
}
