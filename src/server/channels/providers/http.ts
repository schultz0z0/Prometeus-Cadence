import {createHash} from 'node:crypto';
import type {TemplateStatus,TemplateView} from '../../../domain/whatsapp.ts';
import {ChannelProviderError} from './contracts.ts';
export const allowedApiHosts=new Set(['graph.facebook.com','api.twilio.com','messaging.twilio.com','content.twilio.com']);
export function safeApiUrl(url:string,host?:string,path?:string):URL {
 const u=new URL(url);
 if(u.protocol!=='https:'||u.username||u.password||u.port||!allowedApiHosts.has(u.hostname)||(host&&u.hostname!==host)||(path&&u.pathname!==path))throw new ChannelProviderError('API_URL_REJECTED');return u;
}
export async function readBoundedBody(response:Response,limit:number):Promise<Uint8Array>{
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new ChannelProviderError('RESPONSE_TOO_LARGE');}
 if(!response.body)return new Uint8Array();const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new ChannelProviderError('RESPONSE_TOO_LARGE');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function channelRequest(url:string,headers:HeadersInit,init:RequestInit={},fetcher:typeof fetch=fetch){
 safeApiUrl(url);const response=await fetcher(url,{...init,headers,redirect:'error',signal:AbortSignal.timeout(30000)});
 const text=new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBody(response,2097152));let data:any;
 try{data=JSON.parse(text);}catch{throw new ChannelProviderError('INVALID_API_RESPONSE');}
 const retry=response.headers.get('retry-after');let retryAfterMs:number|null=null;
 if(retry){const seconds=Number(retry);retryAfterMs=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retry)-Date.now());if(!Number.isFinite(retryAfterMs))retryAfterMs=null;}
 return {ok:response.ok,status:response.status,data,retryAfterMs};
}
export function requireOk(result:{ok:boolean;data:any}){if(!result.ok||!result.data||typeof result.data!=='object')throw new ChannelProviderError('API_VERIFICATION_FAILED');return result.data;}
export function templateStatus(value:unknown):TemplateStatus{
 const status=String(value??'').toLowerCase();return ['approved','pending','rejected','paused','disabled'].includes(status)?status as TemplateStatus:'unknown';
}
export function templateHash(value:unknown){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export function makeTemplate(base:Omit<TemplateView,'hash'|'id'|'revision'>):TemplateView{return {...base,id:base.remoteId,revision:1,hash:templateHash(base)};}
