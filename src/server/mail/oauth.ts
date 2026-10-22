import 'server-only';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {MailboxView} from '../../domain/mail.ts';
import type {MailDeps} from './providers/contracts.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {encryptCredential,decryptCredential} from '../channels/crypto.ts';
import {readBoundedBody} from '../channels/providers/http.ts';
import {requireChannelAdmin} from '../channels/repository.ts';
import {mailboxRow,mailboxView,readMailConfig} from './repository.ts';
import {gmailOAuthSettings,createGmailAuthorization,gmailScopes} from './oauth-protocol.ts';
import {createGmailAdapter} from './providers/gmail.ts';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const inputSchema=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().min(1)});
const now=(deps:MailDeps)=>deps.now?.()??new Date().toISOString();
export async function tokenRequest(params:URLSearchParams,deps:MailDeps):Promise<Record<string,any>> {
 const response=await(deps.fetch??fetch)('https://oauth2.googleapis.com/token',{method:'POST',body:params.toString(),headers:{'content-type':'application/x-www-form-urlencoded'},redirect:'error',signal:AbortSignal.timeout(30000)});
 let data:any;try{data=JSON.parse(Buffer.from(await readBoundedBody(response,65536)).toString('utf8'));}catch{throw Error('GMAIL_TOKEN_INVALID');}
 if(!response.ok)throw Error(data?.error==='invalid_grant'?'GMAIL_INVALID_GRANT':'GMAIL_TOKEN_FAILED');
 if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>16384||String(data.token_type).toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<0||data.expires_in>86400)throw Error('GMAIL_TOKEN_INVALID');
 return data;
}
export async function startGmailAuthorization(p:Principal,sessionId:string,input:unknown,deps:MailDeps={}):Promise<{authorizationUrl:string;expiresAt:string}> {
 const parsed=inputSchema.safeParse(input);if(!parsed.success||!sessionId)throw new AppError(422,'Revise a caixa antes de autorizar.');
 const settings=gmailOAuthSettings(),auth=createGmailAuthorization(settings),attemptId=randomUUID(),expiresAt=new Date(Date.parse(now(deps))+600000).toISOString();
 await withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);const row=await mailboxRow(c,parsed.data.id,true);
  if(row.provider!=='gmail'||Number(row.revision)!==parsed.data.expectedRevision)throw new AppError(409,'A caixa mudou.');
  const envelope=encryptCredential({verifier:auth.verifier,redirectUri:settings.redirectUri},{workspaceId:p.workspaceId,connectionId:row.id,provider:'gmail',revision:Number(row.revision)});
  await c.query('SELECT app.begin_mail_oauth($1,$2,$3,$4,$5,$6,$7)',[row.id,Number(row.revision),attemptId,digest(auth.state),digest(sessionId),envelope,expiresAt]);
 });return {authorizationUrl:auth.authorizationUrl,expiresAt};
}
export async function finishGmailAuthorization(p:Principal,sessionId:string,url:URL,deps:MailDeps={}):Promise<MailboxView> {
 const settings=gmailOAuthSettings(),expected=new URL(settings.redirectUri);
 if(url.origin!==expected.origin||url.pathname!==expected.pathname||url.searchParams.getAll('state').length!==1||url.searchParams.getAll('code').length!==1||url.searchParams.has('error')||!sessionId)throw new AppError(422,'Retorno da autorização inválido.');
 const state=url.searchParams.get('state')!,code=url.searchParams.get('code')!;
 if(!/^[a-zA-Z0-9_-]{43}$/.test(state)||!code||code.length>4096)throw new AppError(422,'Retorno da autorização inválido.');
 const attempt=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.consume_mail_oauth($1,$2) AS attempt',[digest(state),digest(sessionId)])).rows[0].attempt);
 const revision=Number(attempt.revision),id=attempt.connection_id;
 const proof=decryptCredential(attempt.envelope,{workspaceId:p.workspaceId,connectionId:id,provider:'gmail',revision});
 if(proof.redirectUri!==settings.redirectUri)throw new AppError(409,'A configuração OAuth mudou. Conecte novamente.');
 const tokens=await tokenRequest(new URLSearchParams({grant_type:'authorization_code',code,client_id:settings.clientId,client_secret:settings.clientSecret,redirect_uri:settings.redirectUri,code_verifier:proof.verifier}),deps);
 const scopes=new Set(String(tokens.scope??'').split(/\s+/));if(gmailScopes.some(s=>!scopes.has(s)))throw new AppError(422,'Autorize envio e leitura da caixa.');
 const current=await withWorkspaceTransaction(p,c=>readMailConfig(c,id,revision));
 const refreshToken=typeof tokens.refresh_token==='string'&&tokens.refresh_token?tokens.refresh_token:current.credentials.refreshToken;
 if(!refreshToken||refreshToken.length>16384)throw new AppError(422,'Autorize acesso offline para conectar a caixa.');
 const expiresAt=new Date(Date.parse(now(deps))+tokens.expires_in*1000).toISOString();
 const credentials={accessToken:tokens.access_token,refreshToken,expiresAt,scopes:[...scopes].join(' ')};
 const verified=await createGmailAdapter(deps).verify({...current,credentials});
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);const row=await mailboxRow(c,id,true);if(Number(row.revision)!==revision)throw new AppError(409,'A caixa mudou durante a autorização.');
  const envelope=encryptCredential(credentials,{workspaceId:p.workspaceId,connectionId:id,provider:'gmail',revision:revision+1});
  await c.query('SELECT app.finish_mail_oauth($1,$2,$3,$4,$5)',[attempt.id,revision,verified.address,envelope,expiresAt]);
  await c.query('INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,$3)',[p.workspaceId,p.userId,'mailbox.authorize']);
  return mailboxView(c,await mailboxRow(c,id));
 });
}
export async function withGmailAccess<T>(mailboxId:string,run:(token:string)=>Promise<T>,deps:MailDeps):Promise<T> {
 const p=deps.principal;if(!p)throw new AppError(403,'Autorização da caixa necessária.');
 const load=()=>withWorkspaceTransaction(p,c=>readMailConfig(c,mailboxId));
 for(let waited=0;waited<100;waited++){
  const config=await load(),{mailbox,credentials}=config;
  if(mailbox.provider!=='gmail'||['authorization_required','disconnected'].includes(mailbox.state))throw new AppError(409,'Conecte a caixa Google novamente.');
  if(credentials.accessToken&&Date.parse(credentials.expiresAt)>Date.parse(now(deps))+30000)return run(credentials.accessToken);
  const token=randomUUID(),claimed=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.claim_mail_refresh($1,$2,$3) AS claimed',[mailboxId,mailbox.revision,token])).rows[0].claimed);
  if(!claimed){await delay(50);continue;}
  const fresh=await load();
  if(fresh.mailbox.revision!==mailbox.revision)throw new AppError(409,'A caixa mudou durante a renovação.');
  if(fresh.credentials.accessToken&&Date.parse(fresh.credentials.expiresAt)>Date.parse(now(deps))+30000){await withWorkspaceTransaction(p,c=>c.query('SELECT app.finish_mail_refresh($1,$2,$3,NULL,NULL,$4)',[mailboxId,mailbox.revision,token,'already_refreshed']));return run(fresh.credentials.accessToken);}
  let data:Record<string,any>;
  try{
   const settings=gmailOAuthSettings();data=await tokenRequest(new URLSearchParams({grant_type:'refresh_token',client_id:settings.clientId,client_secret:settings.clientSecret,refresh_token:fresh.credentials.refreshToken}),deps);
  }catch(error){
   const kind=error instanceof Error&&error.message==='GMAIL_INVALID_GRANT'?'invalid_grant':'refresh_failed';
   await withWorkspaceTransaction(p,c=>c.query('SELECT app.finish_mail_refresh($1,$2,$3,NULL,NULL,$4)',[mailboxId,mailbox.revision,token,kind]));
   throw new AppError(409,kind==='invalid_grant'?'Conecte a caixa Google novamente.':'Não foi possível renovar a caixa Google.');
  }
  const expiresAt=new Date(Date.parse(now(deps))+data.expires_in*1000).toISOString(),updated={...fresh.credentials,accessToken:data.access_token,expiresAt,...(typeof data.refresh_token==='string'&&data.refresh_token?{refreshToken:data.refresh_token}:{})};
  const envelope=encryptCredential(updated,{workspaceId:p.workspaceId,connectionId:mailboxId,provider:'gmail',revision:mailbox.revision});
  const saved=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.finish_mail_refresh($1,$2,$3,$4,$5,NULL) AS saved',[mailboxId,mailbox.revision,token,envelope,expiresAt])).rows[0].saved);
  if(!saved)throw new AppError(409,'A autorização mudou durante a renovação.');return run(updated.accessToken);
 }
 throw new AppError(409,'A caixa está sendo renovada. Tente novamente.');
}
