import {parseRetryAfter} from '../../domain/integration-delivery.ts';
import {unipileSourcesState,type LinkedinAccountState} from '../../domain/linkedin-connection.ts';
import {AppError} from '../errors.ts';
import {readBoundedBody} from '../channels/providers/http.ts';
// The platform's Unipile account (one key, DSN host:port). Customer accounts are only ids in that account.
export interface UnipileDeps{fetch?:typeof fetch;now?:()=>number}
type Env=Record<string,string|undefined>;
export function unipileSettings(env:Env=process.env){
 const dsn=env.UNIPILE_DSN,key=env.UNIPILE_API_KEY;
 if(!dsn||!key||!/^[a-z0-9-]+(\.[a-z0-9-]+)+:\d{2,5}$/i.test(dsn))throw new AppError(503,'A conexão com o LinkedIn ainda não está configurada neste ambiente.','LINKEDIN_NOT_CONFIGURED');
 return {base:'https://'+dsn,key};
}
/** The account is gone at the vendor (deleted, or not a LinkedIn account). */
export class UnipileMissing extends Error{}
/** Network, timeout, quota or a vendor/platform failure: retry later, never infer a customer change. */
export class UnipileRetry extends Error{readonly retryAfterMs?:number;readonly status?:number;readonly type?:string;constructor(message:string,retryAfterMs?:number,status?:number,type?:string){super(message);this.retryAfterMs=retryAfterMs;this.status=status;this.type=type;}}
/** One call to the platform's Unipile account. Network failures carry no status: the effect is unknown. */
export async function unipileRequest(method:'GET'|'POST'|'DELETE',path:string,body:unknown,deps:UnipileDeps,env:Env=process.env):Promise<any>{
 const s=unipileSettings(env);let r:Response;
 try{r=await(deps.fetch??fetch)(s.base+path,{method,headers:{'x-api-key':s.key,accept:'application/json',...(body===undefined||body instanceof FormData?{}:{'content-type':'application/json'})},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});}
 catch{throw new UnipileRetry('Sem resposta do fornecedor do LinkedIn (rede ou tempo esgotado).');}
 if(r.status===404)throw new UnipileMissing('A conta não existe mais no fornecedor.');
 // 401/403 are the platform key, not the customer's account.
 if(!r.ok){const err=await r.json().catch(()=>null);throw new UnipileRetry(`O fornecedor do LinkedIn respondeu ${r.status}.`,r.status===429||r.status===503?parseRetryAfter(r.headers.get('retry-after')??undefined,(deps.now??Date.now)()):undefined,r.status,typeof err?.type==='string'?err.type.slice(0,80):undefined);}
 try{return JSON.parse(Buffer.from(await readBoundedBody(r,1048576)).toString('utf8'));}catch{throw new UnipileRetry('A resposta do fornecedor do LinkedIn não pôde ser lida.');}
}
export async function hostedLink(i:{type:'create'|'reconnect';reconnectAccount?:string;name:string;notifyUrl:string;successUrl:string;failureUrl:string;expiresOn:string},deps:UnipileDeps={},env:Env=process.env):Promise<string>{
 const data=await unipileRequest('POST','/api/v1/hosted/accounts/link',{type:i.type,...(i.reconnectAccount?{reconnect_account:i.reconnectAccount}:{}),providers:['LINKEDIN'],api_url:unipileSettings(env).base,expiresOn:i.expiresOn,
  notify_url:i.notifyUrl,name:i.name,success_redirect_url:i.successUrl,failure_redirect_url:i.failureUrl},deps,env);
 const url=typeof data?.url==='string'?URL.parse(data.url):null;
 if(!url||url.protocol!=='https:')throw new UnipileRetry('O fornecedor do LinkedIn não devolveu um link de conexão válido.');
 return url.toString();
}
export async function unipileAccount(id:string,deps:UnipileDeps={},env:Env=process.env):Promise<{name:string;memberId:string;state:LinkedinAccountState}>{
 const a=await unipileRequest('GET','/api/v1/accounts/'+encodeURIComponent(id),undefined,deps,env);
 if(a?.type!=='LINKEDIN')throw new UnipileMissing('A conta do fornecedor não é uma conta LinkedIn.');
 const memberId=String(a.connection_params?.im?.id??a.connection_params?.im?.publicIdentifier??'');
 if(!memberId)throw new UnipileRetry('O fornecedor não identificou o membro LinkedIn.');
 return {name:String(a.name||'Conta LinkedIn').slice(0,120),memberId:memberId.slice(0,200),state:unipileSourcesState(Array.isArray(a.sources)?a.sources.map((s:{status?:unknown})=>String(s?.status)):[])};
}
/** Ends the session at the vendor; an account already gone counts as removed. */
export async function deleteUnipileAccount(id:string,deps:UnipileDeps={},env:Env=process.env){
 try{await unipileRequest('DELETE','/api/v1/accounts/'+encodeURIComponent(id),undefined,deps,env);}catch(e){if(!(e instanceof UnipileMissing))throw e;}
}
