import 'server-only';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {connectorCatalog,sheetActionSchema,sheetHeaders,sheetRow,sheetSetupSchema,type SheetAttention,type SheetConfig,type SheetEvent} from '../../domain/connector-capabilities.ts';
import {nextRetryDelay,parseRetryAfter} from '../../domain/integration-delivery.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {decryptCredential,encryptCredential,type EncryptedCredential} from '../channels/crypto.ts';
import {readBoundedBody} from '../channels/providers/http.ts';
import {gmailCallbackUrl} from '../mail/callback-url.ts';
import {tokenRequest} from '../mail/oauth.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {connectorError} from './connections.ts';
import {requirePrincipal} from '../auth/principal.ts';
// drive.file reaches only files this app creates, never the rest of the customer's Drive.
export const SHEETS_SCOPE='https://www.googleapis.com/auth/drive.file';
const CALLBACK='/api/integration-oauth/google-sheets/callback',API='https://sheets.googleapis.com/v4/spreadsheets';
export interface SheetsDeps{fetch?:typeof fetch;now?:()=>number}
interface Tokens{accessToken:string;refreshToken:string;expiresAt:string}
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const aad=(workspaceId:string,connectionId:string,revision:number)=>({workspaceId,connectionId,provider:'google-sheets' as const,revision});
export function sheetsOAuthSettings(env:Record<string,string|undefined>=process.env){
 const clientId=env.GOOGLE_SHEETS_CLIENT_ID,clientSecret=env.GOOGLE_SHEETS_CLIENT_SECRET,redirectUri=env.GOOGLE_SHEETS_REDIRECT_URI;
 if(!clientId||!clientSecret||!redirectUri)throw new AppError(503,'O Google Sheets ainda não está configurado neste ambiente.','SHEETS_NOT_CONFIGURED');
 const u=new URL(redirectUri);
 if(u.username||u.password||u.hash||u.search||u.pathname!==CALLBACK||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new AppError(503,'O retorno OAuth do Google Sheets está mal configurado.','SHEETS_NOT_CONFIGURED');
 return {clientId,clientSecret,redirectUri};
}
/** Kinds of failure the sheet itself causes: a person must act, so the queue waits. */
export class SheetsAttention extends Error{readonly attention:SheetAttention;constructor(attention:SheetAttention,message:string){super(message);this.attention=attention;}}
class SheetsUnauthorized extends SheetsAttention{}
class SheetsRetry extends Error{readonly retryAfterMs?:number;constructor(message:string,retryAfterMs?:number){super(message);this.retryAfterMs=retryAfterMs;}}
const attentionText:Record<SheetAttention,string>={
 schema:'Os cabeçalhos da planilha foram alterados. Restaure o cabeçalho para continuar.',
 missing:'A planilha ou a aba não existe mais. Crie uma planilha nova.',
 reconnect:'O Google recusou o acesso. Reconecte a conta Google.',
 forbidden:'A conta Google perdeu acesso a esta planilha. Reconecte ou crie uma planilha nova.',
};
async function refresh(tokens:Tokens,deps:SheetsDeps,force=false):Promise<Tokens|null>{
 const now=(deps.now??Date.now)();if(!force&&Date.parse(tokens.expiresAt)>now+60000)return null;
 const s=sheetsOAuthSettings();let data:Record<string,any>;
 try{data=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:s.clientId,client_secret:s.clientSecret,refresh_token:tokens.refreshToken}),{fetch:deps.fetch});}
 catch(e){if(e instanceof Error&&e.message==='GMAIL_INVALID_GRANT')throw new SheetsAttention('reconnect',attentionText.reconnect);throw new SheetsRetry('Não foi possível renovar o acesso ao Google.');}
 // shortcut: two concurrent refreshes both succeed and the last write wins; Google keeps both access tokens valid.
 return {accessToken:data.access_token,refreshToken:typeof data.refresh_token==='string'&&data.refresh_token?data.refresh_token:tokens.refreshToken,expiresAt:new Date(now+data.expires_in*1000).toISOString()};
}
// A 401 with a token that looked valid (early revocation, clock skew) gets one forced refresh before asking for a reconnect.
async function withAccess<T>(tokens:Tokens,save:(t:Tokens)=>Promise<unknown>,fn:(token:string)=>Promise<T>,deps:SheetsDeps):Promise<T>{
 const fresh=await refresh(tokens,deps);if(fresh)await save(fresh);const current=fresh??tokens;
 try{return await fn(current.accessToken);}
 catch(e){if(!(e instanceof SheetsUnauthorized)||fresh)throw e;const forced=(await refresh(current,deps,true))!;await save(forced);return fn(forced.accessToken);}
}
async function google(method:'GET'|'POST'|'PUT',url:string,token:string,body:unknown,deps:SheetsDeps):Promise<any>{
 let r:Response;url+=(url.includes('?')?'&':'?')+'prettyPrint=false';
 try{r=await(deps.fetch??fetch)(url,{method,headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000)});}
 catch{throw new SheetsRetry('Sem resposta do Google (rede ou tempo esgotado).');}
 let data:any=null,readable=true;try{data=JSON.parse(Buffer.from(await readBoundedBody(r,4194304)).toString('utf8'));}catch{readable=false;}
 // An answer we cannot read proves nothing about the sheet: retry rather than infer a changed header.
 if(r.ok){if(!readable)throw new SheetsRetry('A resposta do Google não pôde ser lida.');return data;}
 const reason=String(data?.error?.message??'');
 if(r.status===401)throw new SheetsUnauthorized('reconnect',attentionText.reconnect);
 // Quota and a disabled API on the platform project are not the customer's sheet losing access.
 if(r.status===403&&data?.error?.status==='PERMISSION_DENIED'&&!/SERVICE_DISABLED|RATE_LIMIT/.test(JSON.stringify(data)))throw new SheetsAttention('forbidden',attentionText.forbidden);
 if(r.status===404||(r.status===400&&/parse range/i.test(reason)))throw new SheetsAttention('missing',attentionText.missing);
 if(r.status===429||r.status===403||r.status>=500)throw new SheetsRetry(`O Google respondeu ${r.status}.`,parseRetryAfter(r.headers.get('retry-after')??undefined,(deps.now??Date.now)()));
 throw new SheetsRetry(`O Google recusou a requisição (${r.status}).`);
}
const range=(title:string,a1:string)=>encodeURIComponent(`'${title.replace(/'/g,"''")}'!${a1}`);
export async function createSpreadsheet(token:string,input:{spreadsheetName:string;sheetTitle:string;headers:string[]},deps:SheetsDeps):Promise<string>{
 const data=await google('POST',API,token,{properties:{title:input.spreadsheetName},sheets:[{properties:{title:input.sheetTitle,gridProperties:{frozenRowCount:1}},
  data:[{startRow:0,startColumn:0,rowData:[{values:input.headers.map(h=>({userEnteredValue:{stringValue:h}}))}]}]}]},deps);
 if(typeof data?.spreadsheetId!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(data.spreadsheetId))throw new SheetsRetry('O Google não devolveu a planilha criada.');
 return data.spreadsheetId;
}
const writeHeader=(token:string,c:SheetConfig,deps:SheetsDeps)=>google('PUT',`${API}/${c.spreadsheetId}/values/${range(c.sheetTitle,'A1')}?valueInputOption=RAW`,token,{values:[sheetHeaders(c.columns)]},deps);
// Upsert by the technical id in column A: a retry after a lost response finds the row instead of appending a second one.
export async function exportRow(token:string,c:SheetConfig,row:string[],deps:SheetsDeps):Promise<void>{
 if(!row[0])throw Error('Lead id missing');
 const got=await google('GET',`${API}/${c.spreadsheetId}/values:batchGet?ranges=${range(c.sheetTitle,'1:1')}&ranges=${range(c.sheetTitle,'A:A')}&majorDimension=ROWS`,token,undefined,deps);
 const header:string[]=got?.valueRanges?.[0]?.values?.[0]??[],ids:string[][]=got?.valueRanges?.[1]?.values??[],expected=sheetHeaders(c.columns);
 if(expected.some((h,i)=>header[i]!==h))throw new SheetsAttention('schema',attentionText.schema);
 // shortcut: reads all of column A per export; fine for tens of thousands of rows, cache the row number if sheets grow past that.
 const at=ids.findIndex((r,i)=>i>0&&r[0]===row[0]);
 if(at>0)await google('PUT',`${API}/${c.spreadsheetId}/values/${range(c.sheetTitle,'A'+(at+1))}?valueInputOption=RAW`,token,{values:[row]},deps);
 else await google('POST',`${API}/${c.spreadsheetId}/values/${range(c.sheetTitle,'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,token,{values:[row]},deps);
}

// --- OAuth (owner/admin, same session start to finish) ---
export async function startSheetsAuthorization(p:Principal,sessionId:string):Promise<{authorizationUrl:string;expiresAt:string}>{
 if(!sessionId)throw new AppError(401,'Entre novamente para conectar o Google.');
 const s=sheetsOAuthSettings(),state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url'),attemptId=randomUUID();
 try{
  const expiresAt=await withWorkspaceTransaction(p,async c=>{
   const live=(await c.query("SELECT id,revision FROM app.integration_connection WHERE kind='google-sheets' AND state<>'revoked'")).rows[0];
   const envelope=encryptCredential({verifier,redirectUri:s.redirectUri,connectionId:live?.id??randomUUID(),expectedRevision:String(live?Number(live.revision):0)},aad(p.workspaceId,'oauth:'+attemptId,0));
   return (await c.query('SELECT app.begin_connector_oauth($1,$2,$3,$4,$5) v',[attemptId,'google-sheets',digest(state),digest(sessionId),envelope])).rows[0].v as Date;
  });
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({client_id:s.clientId,redirect_uri:s.redirectUri,response_type:'code',scope:SHEETS_SCOPE,state,access_type:'offline',prompt:'consent',include_granted_scopes:'false',
   code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,v);
  return {authorizationUrl:url.toString(),expiresAt:expiresAt.toISOString()};
 }catch(e){throw connectorError(e);}
}
export async function finishSheetsAuthorization(p:Principal,sessionId:string,url:URL,deps:SheetsDeps={}):Promise<void>{
 const s=sheetsOAuthSettings();
 if(url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||url.searchParams.has('error')||!sessionId)throw new AppError(422,'Retorno da autorização inválido.');
 const state=url.searchParams.get('state')!,code=url.searchParams.get('code')!;
 if(!/^[a-zA-Z0-9_-]{43}$/.test(state)||!code||code.length>4096)throw new AppError(422,'Retorno da autorização inválido.');
 try{
  const attempt=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.consume_connector_oauth($1,$2,$3) v',[digest(state),digest(sessionId),'google-sheets'])).rows[0].v as {id:string;envelope:EncryptedCredential});
  const proof=decryptCredential(attempt.envelope,aad(p.workspaceId,'oauth:'+attempt.id,0)) as {verifier:string;redirectUri:string;connectionId:string;expectedRevision:string};
  if(proof.redirectUri!==s.redirectUri)throw new AppError(409,'A configuração OAuth mudou. Conecte novamente.');
  let tokens:Record<string,any>;
  try{tokens=await tokenRequest(new URLSearchParams({grant_type:'authorization_code',code,client_id:s.clientId,client_secret:s.clientSecret,redirect_uri:s.redirectUri,code_verifier:proof.verifier}),{fetch:deps.fetch});}
  catch{throw new AppError(502,'O Google não confirmou a autorização. Tente de novo.','SHEETS_TOKEN_FAILED');}
  if(!String(tokens.scope??'').split(/\s+/).includes(SHEETS_SCOPE))throw new AppError(422,'Autorize o acesso às planilhas criadas pelo Prometeus Cadence.','SHEETS_SCOPE_DENIED');
  if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token||tokens.refresh_token.length>16384)throw new AppError(422,'Autorize o acesso contínuo para exportar os leads.','SHEETS_SCOPE_DENIED');
  const expected=Number(proof.expectedRevision),expiresAt=new Date((deps.now??Date.now)()+tokens.expires_in*1000).toISOString(),next=expected+1;
  const secret=encryptCredential({accessToken:tokens.access_token,refreshToken:tokens.refresh_token,expiresAt},aad(p.workspaceId,proof.connectionId,next));
  await withWorkspaceTransaction(p,c=>c.query('SELECT app.save_oauth_connection($1,$2,$3,$4,$5,$6,$7)',[proof.connectionId,'google-sheets','Conta Google',secret,
   connectorCatalog.find(x=>x.kind==='google-sheets')!.capabilities,expected,expiresAt]));
 }catch(e){throw connectorError(e);}
}
export async function sheetsCallbackHttp(request:Request,deps:SheetsDeps={}):Promise<Response>{
 const destination=new URL('/settings/apps/google-sheets',process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
 try{if(request.method!=='GET')throw new AppError(405,'Método não permitido.');const p=await requirePrincipal(request.headers);
  await finishSheetsAuthorization(p,p.sessionId,gmailCallbackUrl(request,sheetsOAuthSettings().redirectUri),deps);destination.searchParams.set('oauth','connected');}
 catch(e){destination.searchParams.set('oauth',e instanceof AppError&&e.code==='SHEETS_SCOPE_DENIED'?'scope':'failed');}
 return new Response(null,{status:303,headers:{location:destination.toString(),'cache-control':'no-store','referrer-policy':'no-referrer'}});
}

// --- Admin actions that need the customer's tokens for this request only ---
async function liveSheets(c:PoolClient,id?:string){
 const r=(await c.query("SELECT id,revision,config,config_revision,state FROM app.integration_connection WHERE kind='google-sheets' AND state<>'revoked'"+(id?' AND id=$1':''),id?[id]:[])).rows[0];
 if(!r)throw new AppError(404,'Conecte a conta Google primeiro.','CONNECTION_NOT_FOUND');
 return{id:r.id as string,revision:Number(r.revision),config:r.config as SheetConfig|null,configRevision:Number(r.config_revision)};
}
async function asAdmin<T>(p:Principal,live:{id:string;revision:number},fn:(token:string)=>Promise<T>,deps:SheetsDeps):Promise<T>{
 const sealed=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.sheets_admin_secret($1,$2) v',[live.id,live.revision])).rows[0].v as EncryptedCredential);
 let tokens:Tokens;try{tokens=decryptCredential(sealed,aad(p.workspaceId,live.id,live.revision)) as unknown as Tokens;}catch{throw new SheetsAttention('reconnect','O acesso guardado não pôde ser lido. Reconecte a conta Google.');}
 return withAccess(tokens,t=>withWorkspaceTransaction(p,c=>c.query('SELECT app.save_sheets_tokens($1,$2,$3,$4)',[live.id,live.revision,encryptCredential({...t},aad(p.workspaceId,live.id,live.revision)),t.expiresAt])),fn,deps);
}
const googleError=(e:unknown)=>e instanceof SheetsAttention?new AppError(e.attention==='reconnect'?409:422,e.message,'SHEETS_'+e.attention.toUpperCase()):e instanceof SheetsRetry?new AppError(503,e.message+' Tente de novo em instantes.','SHEETS_UNAVAILABLE'):e;
export async function configureSheets(p:Principal,raw:unknown,deps:SheetsDeps={}){
 const parsed=sheetSetupSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Revise o nome da planilha, a aba, as colunas e os gatilhos.');const input=parsed.data;
 try{
  const live=await withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.connector_actor()');return liveSheets(c);});
  if(live.configRevision!==input.expectedRevision)throw new AppError(409,'A conexão mudou em outra aba. Recarregue antes de continuar.','CONNECTION_CONFLICT');
  // shortcut: a spreadsheet created right before a conflicting save is left in the customer's Drive; it is empty apart from the header.
  const spreadsheetId=await asAdmin(p,live,token=>createSpreadsheet(token,{spreadsheetName:input.spreadsheetName,sheetTitle:input.sheetTitle,headers:sheetHeaders(input.columns)},deps),deps);
  const config:SheetConfig={spreadsheetId,spreadsheetName:input.spreadsheetName,sheetTitle:input.sheetTitle,columns:input.columns,events:input.events};
  await withWorkspaceTransaction(p,c=>c.query('SELECT app.configure_sheets($1,$2,$3,$4)',[live.id,live.revision,input.expectedRevision,config]));
  return config;
 }catch(e){throw connectorError(googleError(e));}
}
export async function sheetsAction(p:Principal,id:string,raw:unknown,deps:SheetsDeps={}){
 const parsed=sheetActionSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Operação inválida.');
 try{
  if(parsed.data.action==='repair'){
   const live=await withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.connector_actor()');return liveSheets(c,id);});
   if(!live.config||live.configRevision!==parsed.data.expectedRevision)throw new AppError(409,'A conexão mudou em outra aba. Recarregue antes de continuar.','CONNECTION_CONFLICT');
   const config=live.config;await asAdmin(p,live,token=>writeHeader(token,config,deps),deps);
  }
  const configRevision=await withWorkspaceTransaction(p,async c=>Number((await c.query('SELECT app.sheets_action($1,$2,$3) v',[id,parsed.data.expectedRevision,parsed.data.action])).rows[0].v));
  return{configRevision};
 }catch(e){throw connectorError(googleError(e));}
}

// --- Worker ---
type Claimed={workspace_id:string;connection_id:string;lead_id:string;attempts:number;first_at:Date;event:SheetEvent;channel:string|null;revision:string;config_revision:string;
 secret:EncryptedCredential;config:SheetConfig;token_expires_at:Date|null;lead:Record<string,unknown>|null;list_name:string|null};
export async function dispatchSheetsTick(input:{limit:number;signal:AbortSignal},deps:SheetsDeps={}):Promise<{exported:number;deferred:number}>{
 if(!Number.isInteger(input.limit)||input.limit<1||input.limit>100)throw Error('Invalid sheets batch');
 const token=randomUUID(),c=await workerPool().connect(),now=deps.now??Date.now,stopAt=Date.now()+20000;let exported=0,deferred=0;
 try{
  // Bounded per tick so slow Google answers do not hold the lane past its next interval.
  for(let i=0;i<input.limit&&!input.signal.aborted&&Date.now()<stopAt;i++){
   const row=(await c.query('SELECT * FROM app.claim_sheet_export($1)',[token])).rows[0] as Claimed|undefined;if(!row)break;
   const revision=Number(row.revision);
   let state:'done'|'pending'|'failed'|'held'|'cancelled'=row.lead?'done':'cancelled',error:string|null=null,next:Date|null=null,attention:SheetAttention|null=null;
   try{
    // A deleted lead has nothing left to export.
    if(row.lead){
     let tokens:Tokens;try{tokens=decryptCredential(row.secret,aad(row.workspace_id,row.connection_id,revision)) as unknown as Tokens;}catch{throw new SheetsAttention('reconnect','O acesso guardado não pôde ser lido. Reconecte a conta Google.');}
     const save=(t:Tokens)=>c.query('SELECT app.worker_save_sheets_tokens($1,$2,$3,$4,$5,$6,$7)',[row.workspace_id,row.connection_id,revision,encryptCredential({...t},aad(row.workspace_id,row.connection_id,revision)),t.expiresAt,row.lead_id,token]);
     // Column A comes from the queue row, never from the payload, so a malformed payload cannot match another lead's row.
     const values=sheetRow({...row.lead,id:row.lead_id},row.config.columns,{list:row.list_name,event:row.event,channel:row.channel,exportedAt:new Date(now()).toISOString()});
     await withAccess(tokens,save,access=>exportRow(access,row.config,values,deps),deps);
    }
   }catch(e){
    if(e instanceof SheetsAttention){state='held';error=e.message;attention=e.attention;}
    else{
     const label=e instanceof SheetsRetry?e.message:'Falha inesperada ao exportar.',delay=nextRetryDelay({attempt:row.attempts,ageMs:now()-row.first_at.getTime(),retryAfterMs:e instanceof SheetsRetry?e.retryAfterMs:undefined});
     if(delay===null){state='failed';error=label+' Prazo de 24 h esgotado.';}else{state='pending';error=label;next=new Date(now()+delay);}
    }
   }
   const applied=(await c.query('SELECT app.finish_sheet_export($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) v',[row.workspace_id,row.connection_id,row.lead_id,token,revision,Number(row.config_revision),state,error,next,attention])).rows[0].v;
   if(state==='done'&&applied)exported++;else deferred++;
  }
 }finally{c.release();}
 return{exported,deferred};
}
