import 'server-only';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {Principal} from '../../domain/workspace.ts';
import {connectorCatalog,type SheetAttention} from '../../domain/connector-capabilities.ts';
import {parseRetryAfter} from '../../domain/integration-delivery.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {decryptCredential,encryptCredential,type EncryptedCredential} from '../channels/crypto.ts';
import {readBoundedBody} from '../channels/providers/http.ts';
import {gmailCallbackUrl} from '../mail/callback-url.ts';
import {tokenRequest} from '../mail/oauth.ts';
import {connectorError} from './connections.ts';
import {requirePrincipal} from '../auth/principal.ts';
// The customer's own Google account: one OAuth flow (PKCE, offline) shared by Sheets and Agenda, each with its own scopes and callback.
export type GoogleKind='google-sheets'|'google-calendar';
// drive.file reaches only files this app creates, never the rest of the customer's Drive.
export const SHEETS_SCOPE='https://www.googleapis.com/auth/drive.file';
export const CALENDAR_SCOPES=['https://www.googleapis.com/auth/calendar.freebusy','https://www.googleapis.com/auth/calendar.events.owned'];
const products:Record<GoogleKind,{prefix:string;env:string;label:string;scopes:string[];page:string;scopeDenied:string;offlineDenied:string}>={
 'google-sheets':{prefix:'SHEETS',env:'GOOGLE_SHEETS',label:'Google Sheets',scopes:[SHEETS_SCOPE],page:'/settings/apps/google-sheets',
  scopeDenied:'Autorize o acesso às planilhas criadas pelo Prometeus Cadence.',offlineDenied:'Autorize o acesso contínuo para exportar os leads.'},
 'google-calendar':{prefix:'CALENDAR',env:'GOOGLE_CALENDAR',label:'Google Agenda',scopes:CALENDAR_SCOPES,page:'/settings/apps/google-calendar',
  scopeDenied:'Autorize ver a disponibilidade e criar eventos na sua agenda.',offlineDenied:'Autorize o acesso contínuo para consultar e reservar horários.'},
};
export interface GoogleDeps{fetch?:typeof fetch;now?:()=>number}
export interface Tokens{accessToken:string;refreshToken:string;expiresAt:string}
export const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export const googleAad=(kind:GoogleKind,workspaceId:string,connectionId:string,revision:number)=>({workspaceId,connectionId,provider:kind,revision});
export function googleOAuthSettings(kind:GoogleKind,env:Record<string,string|undefined>=process.env){
 const g=products[kind],clientId=env[g.env+'_CLIENT_ID'],clientSecret=env[g.env+'_CLIENT_SECRET'],redirectUri=env[g.env+'_REDIRECT_URI'];
 if(!clientId||!clientSecret||!redirectUri)throw new AppError(503,`O ${g.label} ainda não está configurado neste ambiente.`,g.prefix+'_NOT_CONFIGURED');
 const u=new URL(redirectUri);
 if(u.username||u.password||u.hash||u.search||u.pathname!==`/api/integration-oauth/${kind}/callback`||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))
  throw new AppError(503,`O retorno OAuth do ${g.label} está mal configurado.`,g.prefix+'_NOT_CONFIGURED');
 return {clientId,clientSecret,redirectUri};
}
/** Failures a person must fix (reconnect, a changed or lost destination). */
export class GoogleAttention extends Error{readonly attention:SheetAttention;constructor(attention:SheetAttention,message:string){super(message);this.attention=attention;}}
export class GoogleUnauthorized extends GoogleAttention{}
export class GoogleRetry extends Error{readonly retryAfterMs?:number;constructor(message:string,retryAfterMs?:number){super(message);this.retryAfterMs=retryAfterMs;}}
export const RECONNECT='O Google recusou o acesso. Reconecte a conta Google.',UNREADABLE='O acesso guardado não pôde ser lido. Reconecte a conta Google.';
export async function refresh(kind:GoogleKind,tokens:Tokens,deps:GoogleDeps,force=false):Promise<Tokens|null>{
 const now=(deps.now??Date.now)();if(!force&&Date.parse(tokens.expiresAt)>now+60000)return null;
 const s=googleOAuthSettings(kind);let data:Record<string,any>;
 try{data=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:s.clientId,client_secret:s.clientSecret,refresh_token:tokens.refreshToken}),{fetch:deps.fetch});}
 catch(e){if(e instanceof Error&&e.message==='GMAIL_INVALID_GRANT')throw new GoogleAttention('reconnect',RECONNECT);throw new GoogleRetry('Não foi possível renovar o acesso ao Google.');}
 // shortcut: two concurrent refreshes both succeed and the last write wins; Google keeps both access tokens valid.
 return {accessToken:data.access_token,refreshToken:typeof data.refresh_token==='string'&&data.refresh_token?data.refresh_token:tokens.refreshToken,expiresAt:new Date(now+data.expires_in*1000).toISOString()};
}
// A 401 with a token that looked valid (early revocation, clock skew) gets one forced refresh before asking for a reconnect.
export async function withAccess<T>(kind:GoogleKind,tokens:Tokens,save:(t:Tokens)=>Promise<unknown>,fn:(token:string)=>Promise<T>,deps:GoogleDeps):Promise<T>{
 const fresh=await refresh(kind,tokens,deps);if(fresh)await save(fresh);const current=fresh??tokens;
 try{return await fn(current.accessToken);}
 catch(e){if(!(e instanceof GoogleUnauthorized)||fresh)throw e;const forced=(await refresh(kind,current,deps,true))!;await save(forced);return fn(forced.accessToken);}
}
/** One Google API call. `texts` words the attention for the product; `gone` lists statuses that mean the target is already absent. */
export async function google(method:'GET'|'POST'|'PUT'|'DELETE',url:string,token:string,body:unknown,deps:GoogleDeps,texts:{missing:string;forbidden:string}):Promise<any>{
 let r:Response;url+=(url.includes('?')?'&':'?')+'prettyPrint=false';
 try{r=await(deps.fetch??fetch)(url,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});}
 catch{throw new GoogleRetry('Sem resposta do Google (rede ou tempo esgotado).');}
 if(r.status===204)return null;
 let data:any=null,readable=true;try{data=JSON.parse(Buffer.from(await readBoundedBody(r,4194304)).toString('utf8'));}catch{readable=false;}
 // An answer we cannot read proves nothing about the destination: retry rather than infer a change.
 if(r.ok){if(!readable)throw new GoogleRetry('A resposta do Google não pôde ser lida.');return data;}
 const reason=String(data?.error?.message??'');
 if(r.status===401)throw new GoogleUnauthorized('reconnect',RECONNECT);
 // Quota and a disabled API on the platform project are not the customer's account losing access.
 if(r.status===403&&data?.error?.status==='PERMISSION_DENIED'&&!/SERVICE_DISABLED|RATE_LIMIT/.test(JSON.stringify(data)))throw new GoogleAttention('forbidden',texts.forbidden);
 if(r.status===404||(r.status===400&&/parse range/i.test(reason)))throw new GoogleAttention('missing',texts.missing);
 if(r.status===429||r.status===403||r.status>=500)throw new GoogleRetry(`O Google respondeu ${r.status}.`,parseRetryAfter(r.headers.get('retry-after')??undefined,(deps.now??Date.now)()));
 throw new GoogleRequestError(r.status,`O Google recusou a requisição (${r.status}).`,data);
}
export class GoogleRequestError extends GoogleRetry{readonly status:number;readonly data:unknown;constructor(status:number,message:string,data:unknown){super(message);this.status=status;this.data=data;}}

// --- OAuth (owner/admin, same session start to finish) ---
export async function startGoogleAuthorization(kind:GoogleKind,p:Principal,sessionId:string):Promise<{authorizationUrl:string;expiresAt:string}>{
 if(!sessionId)throw new AppError(401,'Entre novamente para conectar o Google.');
 const s=googleOAuthSettings(kind),state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),attemptId=randomUUID();
 try{
  const expiresAt=await withWorkspaceTransaction(p,async c=>{
   const live=(await c.query("SELECT id,revision FROM app.integration_connection WHERE kind=$1 AND state<>'revoked'",[kind])).rows[0];
   const envelope=encryptCredential({verifier,redirectUri:s.redirectUri,connectionId:live?.id??randomUUID(),expectedRevision:String(live?Number(live.revision):0)},googleAad(kind,p.workspaceId,'oauth:'+attemptId,0));
   return (await c.query('SELECT app.begin_connector_oauth($1,$2,$3,$4,$5) v',[attemptId,kind,digest(state),digest(sessionId),envelope])).rows[0].v as Date;
  });
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({client_id:s.clientId,redirect_uri:s.redirectUri,response_type:'code',scope:products[kind].scopes.join(' '),state,access_type:'offline',prompt:'consent',include_granted_scopes:'false',
   code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
  return {authorizationUrl:url.toString(),expiresAt:expiresAt.toISOString()};
 }catch(e){throw connectorError(e);}
}
export async function finishGoogleAuthorization(kind:GoogleKind,p:Principal,sessionId:string,url:URL,deps:GoogleDeps={}):Promise<void>{
 const s=googleOAuthSettings(kind),g=products[kind];
 if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||url.searchParams.has('error')||!sessionId)throw new AppError(422,'Retorno da autorização inválido.');
 const state=url.searchParams.get('state')!,code=url.searchParams.get('code')!;
 if(!/^[a-zA-Z0-9_-]{43}$/.test(state)||!code||code.length>4096)throw new AppError(422,'Retorno da autorização inválido.');
 try{
  const attempt=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.consume_connector_oauth($1,$2,$3) v',[digest(state),digest(sessionId),kind])).rows[0].v as {id:string;envelope:EncryptedCredential});
  const proof=decryptCredential(attempt.envelope,googleAad(kind,p.workspaceId,'oauth:'+attempt.id,0)) as {verifier:string;redirectUri:string;connectionId:string;expectedRevision:string};
  if(proof.redirectUri!==s.redirectUri)throw new AppError(409,'A configuração OAuth mudou. Conecte novamente.');
  let tokens:Record<string,any>;
  try{tokens=await tokenRequest(new URLSearchParams({grant_type:'authorization_code',code,client_id:s.clientId,client_secret:s.clientSecret,redirect_uri:s.redirectUri,code_verifier:proof.verifier}),{fetch:deps.fetch});}
  catch{throw new AppError(502,'O Google não confirmou a autorização. Tente de novo.',g.prefix+'_TOKEN_FAILED');}
  const granted=String(tokens.scope??'').split(/\s+/);
  if(!g.scopes.every(x=>granted.includes(x)))throw new AppError(422,g.scopeDenied,g.prefix+'_SCOPE_DENIED');
  if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token||tokens.refresh_token.length>16384)throw new AppError(422,g.offlineDenied,g.prefix+'_SCOPE_DENIED');
  const expected=Number(proof.expectedRevision),expiresAt=new Date((deps.now??Date.now)()+tokens.expires_in*1000).toISOString(),next=expected+1;
  const secret=encryptCredential({accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt},googleAad(kind,p.workspaceId,proof.connectionId,next));
  await withWorkspaceTransaction(p,c=>c.query('SELECT app.save_oauth_connection($1,$2,$3,$4,$5,$6,$7)',[proof.connectionId,kind,'Conta Google',secret,
   connectorCatalog.find(x=>x.kind===kind)!.capabilities,expected,expiresAt]));
 }catch(e){throw connectorError(e);}
}
export async function googleCallbackHttp(kind:GoogleKind,request:Request,deps:GoogleDeps={}):Promise<Response>{
 const g=products[kind],destination=new URL(g.page,process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
 try{if(request.method!=='GET')throw new AppError(405,'Método não permitido.');const p=await requirePrincipal(request.headers);
  await finishGoogleAuthorization(kind,p,p.sessionId,gmailCallbackUrl(request,googleOAuthSettings(kind).redirectUri),deps);destination.searchParams.set('oauth','connected');}
 catch(e){destination.searchParams.set('oauth',e instanceof AppError&&e.code===g.prefix+'_SCOPE_DENIED'?'scope':'failed');}
 return new Response(null,{status:303,headers:{location:destination.toString(),'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
export function openTokens(kind:GoogleKind,sealed:EncryptedCredential,workspaceId:string,connectionId:string,revision:number):Tokens{
 try{return decryptCredential(sealed,googleAad(kind,workspaceId,connectionId,revision)) as unknown as Tokens;}catch{throw new GoogleAttention('reconnect',UNREADABLE);}
}
export const sealTokens=(kind:GoogleKind,t:Tokens,workspaceId:string,connectionId:string,revision:number)=>encryptCredential({...t},googleAad(kind,workspaceId,connectionId,revision));
