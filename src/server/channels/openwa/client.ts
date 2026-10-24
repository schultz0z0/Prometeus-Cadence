import {z} from 'zod';
import {openwaId,openwaRawMessageId,parseOpenwaSession,parseOpenwaQr,parseOpenwaRemoteMessage} from './wire.ts';

export class OpenwaClientError extends Error {
 readonly status:number;readonly code:string;
 constructor(code:string,status=0){super(code);this.name='OpenwaClientError';this.code=code;this.status=status;}
}
export const openwaEvents=['message.received','message.sent','message.ack','message.failed','session.status','session.authenticated','session.disconnected','session.reconnect_loop','session.restriction'];
const safeName=z.string().min(3).max(100).regex(/^[a-zA-Z0-9-]+$/);
const keySchema=z.object({id:openwaId,name:z.string().min(3).max(100),role:z.enum(['admin','operator','viewer']),allowedSessions:z.array(openwaId).max(1000).nullish(),isActive:z.boolean()});
const hookSchema=z.object({id:openwaId,url:z.string().url().max(2048),events:z.array(z.string().max(100)).max(100),active:z.boolean()});
export function privateOpenwaCallback(publicId:string){
 if(!/^[A-Za-z0-9_-]{8,100}$/.test(publicId))throw new OpenwaClientError('OPENWA_CONFIG_INVALID');
 return 'http://channel-ingress:3214/api/channel-webhooks/openwa/'+publicId;
}
export function createOpenwaClient({origin,apiKey,fetchImpl=fetch}:{origin:string;apiKey:string;fetchImpl?:typeof fetch}){
 let base:URL;
 try{base=new URL(origin);if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.pathname!=='/'||base.search||base.hash||!apiKey||apiKey.length>1024)throw Error();}
 catch{throw new OpenwaClientError('OPENWA_CONFIG_INVALID');}
 async function call(method:string,path:string,body?:unknown,timeout=10000,signal?:AbortSignal):Promise<unknown>{
  try{
   const response=await fetchImpl(new URL('/api'+path,base),{method,redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout),headers:{'x-api-key':apiKey,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(response.status===204)return null;
   if(Number(response.headers.get('content-length'))>1048576)throw new OpenwaClientError('OPENWA_PROTOCOL_INVALID',response.status);
   const reader=response.body?.getReader();let length=0;const chunks:Uint8Array[]=[];
   if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1048576)throw new OpenwaClientError('OPENWA_PROTOCOL_INVALID',response.status);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
   let json:unknown;try{const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{if(response.ok)throw new OpenwaClientError('OPENWA_PROTOCOL_INVALID',response.status);}
   if(!response.ok){
    const code=z.object({code:z.string().regex(/^[A-Z0-9_]{1,100}$/)}).safeParse(json);
    throw new OpenwaClientError(code.success?code.data.code:'OPENWA_HTTP_'+response.status,response.status);
   }
   return json;
  }catch(error){if(error instanceof OpenwaClientError)throw error;throw new OpenwaClientError('OPENWA_UNAVAILABLE');}
 }
 const parse=<T>(fn:()=>T):T=>{try{return fn();}catch{throw new OpenwaClientError('OPENWA_PROTOCOL_INVALID');}};
 const sessionPath=(id:string)=>'/sessions/'+parse(()=>openwaId.parse(id));
 const checkedSession=(value:unknown,id?:string)=>parse(()=>{const s=parseOpenwaSession(value);if(id&&s.id!==id)throw Error();return s;});
 async function readMessagePage(id:string,query:{after?:string;limit:number;remoteId?:string;since?:number}){
  const path=sessionPath(id),params=new URLSearchParams({limit:String(z.number().int().min(1).max(100).parse(query.limit)),inlineMedia:'false'});
  if(query.after)params.set('after',openwaId.parse(query.after));if(query.remoteId)params.set('messageId',openwaRawMessageId.parse(query.remoteId));
  if(query.since!==undefined)params.set('since',String(z.number().int().min(0).max(253402300799000).parse(query.since)));
  const data=await call('GET',path+'/messages?'+params);
  return parse(()=>{
   const page=z.object({messages:z.array(z.unknown()).max(query.limit),total:z.number().int().nonnegative(),unknownTimestampTotal:z.number().int().nonnegative().optional()}).parse(data);
   const items=page.messages.map(value=>{const item=parseOpenwaRemoteMessage(value);if(item.sessionId!==id)throw Error();return item;});
   return {items,nextCursor:items.length===query.limit?items.at(-1)!.gatewayId:null,unknownTimestampTotal:page.unknownTimestampTotal??0};
  });
 }
 return {
  async findOwnedSession(name:string){safeName.parse(name);const value=await call('GET','/sessions?'+new URLSearchParams({name,limit:'2'}));return parse(()=>{const rows=z.array(z.unknown()).max(1).parse(value);if(!rows.length)return null;const row=checkedSession(rows[0]);if(row.name!==name)throw Error();return row;});},
  async createSession(name:string){safeName.max(50).parse(name);return checkedSession(await call('POST','/sessions',{name,config:{autoRejectCalls:true,maxReconnectAttempts:5,reconnectBaseDelay:5000}}));},
  async readSession(id:string){return checkedSession(await call('GET',sessionPath(id)),id);},
  async startSession(id:string,signal?:AbortSignal){await call('POST',sessionPath(id)+'/start',undefined,45000,signal);},
  async stopSession(id:string){await call('POST',sessionPath(id)+'/stop');},
  async readQr(id:string){const value=await call('GET',sessionPath(id)+'/qr');return parse(()=>parseOpenwaQr(value));},
  async listScopedKeys(){const value=await call('GET','/auth/api-keys');return parse(()=>z.array(keySchema).max(1000).parse(value));},
  async createScopedKey(id:string,name:string){
   openwaId.parse(id);safeName.parse(name);const value=await call('POST','/auth/api-keys',{name,role:'operator',allowedSessions:[id]});
   return parse(()=>{const key=keySchema.extend({apiKey:z.string().min(16).max(1024)}).parse(value);if(key.role!=='operator'||key.allowedSessions?.length!==1||key.allowedSessions[0]!==id||!key.isActive||key.name!==name)throw Error();return key;});
  },
  async revokeScopedKey(id:string){try{await call('DELETE','/auth/api-keys/'+openwaId.parse(id));}catch(e){if(!(e instanceof OpenwaClientError&&e.status===404))throw e;}},
  async listWebhooks(id:string){const value=await call('GET',sessionPath(id)+'/webhooks');return parse(()=>z.array(hookSchema).max(100).parse(value));},
  async createWebhook(id:string,publicId:string,secret:string){
   z.string().length(64).regex(/^[a-f0-9]+$/).parse(secret);
   const value=await call('POST',sessionPath(id)+'/webhooks',{url:privateOpenwaCallback(publicId),events:openwaEvents,secret,retryCount:5});return parse(()=>hookSchema.parse(value));
  },
  async updateWebhook(id:string,hookId:string,publicId:string,secret:string){const value=await call('PUT',sessionPath(id)+'/webhooks/'+openwaId.parse(hookId),{url:privateOpenwaCallback(publicId),events:openwaEvents,secret,active:true,retryCount:5});return parse(()=>hookSchema.parse(value));},
  async logoutSession(id:string){await call('POST',sessionPath(id)+'/logout');},
  async readRemoteMessage(id:string,remoteId:string){const page=await readMessagePage(id,{limit:2,remoteId});if(page.items.some(i=>i.remoteId!==remoteId)||page.items.length>1)throw new OpenwaClientError('OPENWA_PROTOCOL_INVALID');return page.items[0]??null;},
  readMessages:(id:string,query:{after?:string;limit:number;since?:number})=>readMessagePage(id,query),
 };
}
export type OpenwaClient=ReturnType<typeof createOpenwaClient>;
