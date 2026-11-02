import 'server-only';
import http from 'node:http';
import https from 'node:https';
import {createHmac,randomUUID} from 'node:crypto';
import {nextRetryDelay,parseRetryAfter,webhookRetryAllowed} from '../../domain/integration-delivery.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {decryptCredential,type EncryptedCredential} from '../channels/crypto.ts';
import {approvePublicUrl,resolvePublicDns,type ApprovedUrl,type ResolveDns} from '../prospecting/extraction/public-url.ts';
const MAX_BODY=262144,TIMEOUT=10000;
export interface WebhookResponse{status:number;retryAfter?:string}
export type WebhookRequest=(url:ApprovedUrl,body:string,headers:Record<string,string>,signal:AbortSignal)=>Promise<WebhookResponse>;
// The socket goes to the address approved this attempt (no second DNS lookup, so no rebinding); redirects are never followed.
export const postPinned:WebhookRequest=(approved,body,headers,signal)=>new Promise((resolve,reject)=>{
 const {url,address,family}=approved;
 const req=(url.protocol==='https:'?https:http).request(url,{method:'POST',signal,agent:false,headers:{...headers,'content-length':String(Buffer.byteLength(body))},
  lookup:(_h,o,cb)=>{if(typeof o==='object'&&o.all)cb(null,[{address,family}]);else cb(null,address,family);}},res=>{
  let size=0;res.on('data',c=>{size+=c.length;if(size>65536)res.destroy();});
  res.on('error',()=>resolve({status:res.statusCode??0,retryAfter:res.headers['retry-after'] as string|undefined}));
  res.on('end',()=>resolve({status:res.statusCode??0,retryAfter:res.headers['retry-after'] as string|undefined}));
  res.on('close',()=>resolve({status:res.statusCode??0,retryAfter:res.headers['retry-after'] as string|undefined}));
 });req.on('error',reject);req.end(body);
});
export const signBody=(secret:string,body:string)=>createHmac('sha256',secret).update(body).digest('hex');
type Claimed={workspace_id:string;id:string;attempts:number;destination_id:string;url:string;secret:EncryptedCredential|null;secret_revision:number;event:{id:string;type:string;occurredAt:string;entity:{kind:string;id:string};data:Record<string,unknown>}};
type Outcome={state:'delivered'|'pending'|'failed'|'held';status:number|null;error:string|null;next:Date|null;attention:string|null};
async function attempt(row:Claimed,deps:{request:WebhookRequest;resolve:ResolveDns;now:()=>number;signal:AbortSignal}):Promise<Outcome>{
 const now=deps.now(),age=now-Date.parse(row.event.occurredAt);
 const envelope={id:row.event.id,idempotencyKey:row.event.id,type:row.event.type,version:1,occurredAt:row.event.occurredAt,sentAt:new Date(now).toISOString(),entity:row.event.entity,data:row.event.data};
 const body=JSON.stringify(envelope);
 if(Buffer.byteLength(body)>MAX_BODY)return{state:'failed',status:null,error:'O evento passa de 256 KiB e não foi enviado.',next:null,attention:null};
 let approved:ApprovedUrl;
 try{approved=await approvePublicUrl(row.url,deps.resolve);}catch{return{state:'held',status:null,error:'O endereço não é público ou não resolve. Corrija a URL.',next:null,attention:'address'};}
 const headers:Record<string,string>={'content-type':'application/json','user-agent':'PrometeusCadence-Webhooks/1','x-webhook-id':row.event.id,'x-webhook-event':row.event.type,'x-webhook-timestamp':envelope.sentAt};
 if(row.secret){
  let value:string;try{value=decryptCredential(row.secret,{workspaceId:row.workspace_id,connectionId:row.destination_id,provider:'webhook',revision:row.secret_revision}).secret;}
  catch{return{state:'held',status:null,error:'O segredo não pôde ser lido. Gere um segredo novo.',next:null,attention:'unauthorized'};}
  headers['x-webhook-signature']=signBody(value,body);
 }
 let status=0,retryAfter:string|undefined;
 try{const r=await deps.request(approved,body,headers,AbortSignal.any([deps.signal,AbortSignal.timeout(TIMEOUT)]));status=r.status;retryAfter=r.retryAfter;}catch{status=0;}
 if(status>=200&&status<300)return{state:'delivered',status,error:null,next:null,attention:null};
 if(status>=300&&status<400)return{state:'held',status,error:'O destino respondeu com redirecionamento, que não é seguido. Use a URL final.',next:null,attention:'redirect'};
 if(status===401||status===403)return{state:'held',status,error:'O destino recusou a credencial. Confira o segredo e a autenticação do outro lado.',next:null,attention:'unauthorized'};
 if(status===410)return{state:'held',status,error:'O destino informou que não existe mais.',next:null,attention:'gone'};
 const label=status===0?'Sem resposta do destino (rede ou tempo esgotado); o resultado é incerto.':`O destino respondeu ${status}.`;
 if(!webhookRetryAllowed({status,attempt:row.attempts,ageHours:age/3600e3}))return{state:'failed',status:status||null,error:label,next:null,attention:null};
 const delay=nextRetryDelay({attempt:row.attempts,ageMs:age,retryAfterMs:status===429?parseRetryAfter(retryAfter,now):undefined});
 return delay===null?{state:'failed',status:status||null,error:label+' Prazo de 24 h esgotado.',next:null,attention:null}:{state:'pending',status:status||null,error:label,next:new Date(now+delay),attention:null};
}
export async function dispatchIntegrationTick(input:{limit:number;signal:AbortSignal},deps:{request?:WebhookRequest;resolve?:ResolveDns;now?:()=>number}={}):Promise<{sent:number;deferred:number}>{
 if(!Number.isInteger(input.limit)||input.limit<1||input.limit>100)throw Error('Invalid integration batch');
 const token=randomUUID(),rows=(await workerPool().query('SELECT * FROM app.claim_integration_deliveries($1,$2)',[input.limit,token])).rows as Claimed[];
 let sent=0,deferred=0;
 for(const row of rows){
  if(input.signal.aborted)break;
  const o=await attempt(row,{request:deps.request??postPinned,resolve:deps.resolve??resolvePublicDns,now:deps.now??Date.now,signal:input.signal});
  await workerPool().query('SELECT app.finish_integration_delivery($1,$2,$3,$4,$5,$6,$7,$8)',[row.workspace_id,row.id,token,o.state,o.status,o.error,o.next,o.attention]);
  if(o.state==='delivered')sent++;else deferred++;
 }
 return{sent,deferred};
}
