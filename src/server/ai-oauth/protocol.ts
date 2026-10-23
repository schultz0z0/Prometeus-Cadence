import {createHash,randomBytes} from 'node:crypto';
import {createLocalJWKSet,createRemoteJWKSet,jwtVerify,type JSONWebKeySet} from 'jose';
import {ProviderError} from '../prospecting/providers/transport.ts';
import {validTokens} from '../prospecting/ai/openai.ts';
const issuer='https://auth.openai.com',resource='https://api.openai.com/v1';
const jwks=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks.json'),{timeoutDuration:10000});
export const planScopes=['openid','profile','email','offline_access','resource.invoke','chatgpt.tokens.use.direct'];
export function createAuthorization(hostId:string,redirectUri:string,registration?:{clientId:string}){
 const callback=new URL(redirectUri);if(callback.protocol!=='http:'||callback.hostname!=='127.0.0.1'||callback.search||callback.hash||!hostId.startsWith('urn:uuid:'))throw Error('Local OAuth requires an exact loopback callback');
 const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
 const params=new URLSearchParams({client_id:registration?.clientId??'dynamic_agent_client',ext_agent_host_id:hostId,response_type:'code',redirect_uri:redirectUri,scope:planScopes.join(' '),resource,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
 if(!registration)params.set('agent_name_hint','Prometeus Cadence');
 return {url:issuer+'/api/accounts/authorize?'+params,state,nonce,verifier,redirectUri};
}
export async function verifyIdentity(token:string,clientId:string,nonce:string,keys?:JSONWebKeySet){
 const {payload}=await jwtVerify(token,keys?createLocalJWKSet(keys):jwks,{issuer,audience:clientId,algorithms:['RS256','ES256'],requiredClaims:['sub','exp','nonce']});
 if(payload.nonce!==nonce||!payload.sub||typeof payload.email!=='string'||payload.email.length>320||(Array.isArray(payload.aud)&&payload.aud.length>1&&payload.azp!==clientId))throw Error('Invalid ChatGPT identity');
 return {subject:payload.sub,email:payload.email};
}
export async function oauthToken(fields:Record<string,string>,fetcher:typeof fetch=fetch){
 const response=await fetcher(issuer+'/api/accounts/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,resource}),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!response.ok)throw Error(response.status===400||response.status===401?'CHATGPT_RECONNECT_REQUIRED':'CHATGPT_AUTH_UNAVAILABLE');
 const value=await boundedJson(response);if(typeof value.access_token!=='string'||!value.access_token||typeof value.token_type!=='string'||value.token_type.toLowerCase()!=='bearer'||!Number.isInteger(value.expires_in)||value.expires_in<1||value.expires_in>2592000||['refresh_token','id_token','scope'].some(k=>value[k]!==undefined&&typeof value[k]!=='string'))throw Error('CHATGPT_AUTH_INVALID');return value as {access_token:string;refresh_token?:string;id_token?:string;scope?:string;expires_in:number;token_type:string};
}
export async function boundedJson(response:Response):Promise<Record<string,any>>{
 const reader=response.body?.getReader();if(!reader)throw Error('CHATGPT_RESPONSE_INVALID');const parts:Uint8Array[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1048576)throw Error('CHATGPT_RESPONSE_TOO_LARGE');parts.push(part.value);}const result=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!result||typeof result!=='object'||Array.isArray(result))throw Error('CHATGPT_RESPONSE_INVALID');return result;}finally{await reader.cancel().catch(()=>{});}
}
export async function accountModels(token:string,fetcher:typeof fetch=fetch){
 const response=await fetcher(resource+'/models',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok)throw Error('CHATGPT_CATALOG_UNAVAILABLE');const raw=await boundedJson(response);
 if(!Array.isArray(raw.models))throw Error('CHATGPT_CATALOG_INVALID');return raw.models.filter((m:any)=>m.visibility==='list'&&typeof m.slug==='string'&&/^[a-zA-Z0-9._-]{1,120}$/.test(m.slug)&&typeof m.display_name==='string').slice(0,100).map((m:any)=>({id:m.slug as string,name:m.display_name.slice(0,200) as string}));
}
export async function revokeToken(refreshToken:string,clientId:string,fetcher:typeof fetch=fetch){const r=await fetcher(issuer+'/api/accounts/oauth/revoke',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:refreshToken,token_type_hint:'refresh_token',client_id:clientId}),signal:AbortSignal.timeout(10000),redirect:'error'});return r.ok;}
export async function chatgptJson(token:string,model:string,prompt:string,schema:unknown,signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<{value:unknown;inputTokens?:number;outputTokens?:number}>{
 const combined=AbortSignal.any([signal,AbortSignal.timeout(90000)]);let response:Response;
 try{response=await fetcher(resource+'/responses',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({model,store:false,stream:true,input:[{role:'user',content:prompt}],text:{format:{type:'json_schema',name:'cadence_result',strict:true,schema}}}),signal:combined,redirect:'error'});}catch{throw new ProviderError('CHATGPT_RESPONSE_UNCERTAIN',0,true);}
 if(!response.ok)throw new ProviderError(response.status===429?'CHATGPT_QUOTA_EXCEEDED':response.status===401?'CHATGPT_RECONNECT_REQUIRED':'CHATGPT_REQUEST_FAILED',0,response.status>=500);
 const reader=response.body?.getReader();if(!reader)throw new ProviderError('CHATGPT_RESPONSE_UNCERTAIN',0,true);
 const decoder=new TextDecoder();let buffer='',bytes=0,completed:any=null;
 try{
  while(true){combined.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>2097152)throw Error('limit');buffer=(buffer+decoder.decode(part.value,{stream:true})).replace(/\r\n/g,'\n');
   let boundary:number;while((boundary=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=event.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')continue;const value=JSON.parse(data);
    if(value.type==='response.failed'){const code=value.response?.error?.code;if(['subscription_sharing_usage_limit_exceeded','subscription_sharing_usage_unavailable'].includes(code))throw new ProviderError('CHATGPT_QUOTA_EXCEEDED');throw Error('failed');}
    if(value.type==='response.incomplete'||value.type==='error')throw Error('incomplete');if(value.type==='response.completed')completed=value.response;
   }
  }
  if(completed?.status!=='completed'||!Array.isArray(completed.output))throw Error('incomplete');let text='';for(const item of completed.output){if(item.type==='reasoning')continue;if(item.type!=='message'||!Array.isArray(item.content))throw Error('invalid');for(const part of item.content){if(part.type!=='output_text'||typeof part.text!=='string')throw Error('invalid');text+=part.text;}}
  return {value:JSON.parse(text),inputTokens:validTokens(completed.usage?.input_tokens),outputTokens:validTokens(completed.usage?.output_tokens)};
 }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError('CHATGPT_RESPONSE_UNCERTAIN',0,true);}finally{await reader.cancel().catch(()=>{});}
}
