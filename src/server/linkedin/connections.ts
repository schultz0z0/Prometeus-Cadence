import 'server-only';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {linkedinActionAllowed,type LinkedinCapabilityView} from '../../domain/linkedin-capabilities.ts';
import {LINKEDIN_TERMS,attentionFor,confirmConnectSchema,linkedinAccountReady,notifySchema,type LinkedinAccountState,type LinkedinAccountView} from '../../domain/linkedin-connection.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {ingressPool} from '../channels/ingress-db.ts';
import {workerPool} from '../prospecting/worker-db.ts';
import {linkedinCapabilityView} from './capabilities.ts';
import {deleteUnipileAccount,hostedLink,unipileAccount,unipileSettings,UnipileMissing,UnipileRetry,type UnipileDeps} from './unipile.ts';
const failures:Record<string,[number,string]>={
 CONNECTOR_ACCESS:[403,'Somente proprietário ou administrador conecta o LinkedIn.'],
 LINKEDIN_ACCOUNT_EXISTS:[409,'Este workspace já tem uma conta LinkedIn conectada. Desconecte-a antes de conectar outra.'],
 LINKEDIN_NOT_FOUND:[404,'Conta LinkedIn não encontrada.'],
 REVISION_CONFLICT:[409,'A conta LinkedIn mudou em outra aba. Recarregue antes de continuar.'],
 OAUTH_INVALID:[403,'Este retorno não pertence a você, a esta sessão ou a este workspace. Conecte de novo.'],
 LINKEDIN_NOTIFY_INVALID:[404,'Aviso desconhecido.'],
 LINKEDIN_NOTIFY_USED:[409,'Esta conexão venceu, foi cancelada ou já foi concluída.'],
 LINKEDIN_AUTHOR_REMOVED:[403,'Quem iniciou a conexão não administra mais este workspace.'],
 LINKEDIN_ACCOUNT_TAKEN:[409,'Esta conta LinkedIn já está conectada a outro workspace.'],
 LINKEDIN_ACCOUNT_MISMATCH:[409,'A reconexão precisa usar a mesma conta LinkedIn.'],
 LINKEDIN_SYNC_BUSY:[409,'Já existe uma verificação em andamento. Aguarde alguns segundos.'],
};
const sqlError=(e:unknown)=>{const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const fail=(code:string)=>new AppError(failures[code][0],failures[code][1],code);
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const capsVersion=(v:LinkedinCapabilityView)=>v.adapter?`${v.adapter.id}:${v.adapter.revision}:${v.capabilities.verifiedAt}`:'none';
const unsupported='O fornecedor habilitado na plataforma ainda não é suportado pela conexão de contas.';
const connectable=(v:LinkedinCapabilityView)=>linkedinActionAllowed(v.capabilities,'connect')&&v.adapter?.id==='unipile';
function origin(raw:string){
 const u=URL.parse(raw);
 if(!u||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))))throw new AppError(503,'O endereço público do LinkedIn está mal configurado.','LINKEDIN_NOT_CONFIGURED');
 return u.origin;
}
// The browser comes back where its session cookie lives; the vendor reaches notify_url from the internet.
const browserBase=(env:Record<string,string|undefined>=process.env)=>origin(env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
const notifyBase=(env:Record<string,string|undefined>=process.env)=>origin(env.LINKEDIN_PUBLIC_URL??env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
const publicBase=()=>{browserBase();return notifyBase();};
function connectBlockers(v:LinkedinCapabilityView){
 const out:string[]=[];
 if(!linkedinActionAllowed(v.capabilities,'connect'))out.push(v.reason||'O fornecedor habilitado não oferece a conexão de contas.');
 else if(v.adapter?.id!=='unipile')out.push(unsupported);
 try{unipileSettings();publicBase();}catch(e){out.push((e as Error).message);}
 return out;
}

async function accountView(c:PoolClient,cap:LinkedinCapabilityView):Promise<LinkedinAccountView|null>{
 const r=(await c.query("SELECT id,display_name,state,capabilities_version,revision,last_sync_at,sync_failures,last_error FROM app.linkedin_account WHERE state<>'revoked'")).rows[0];
 if(!r)return null;
 const state=r.state as LinkedinAccountState,matches=r.capabilities_version===capsVersion(cap)&&cap.capabilities.connect;
 const attention=attentionFor[state]??(!matches?'A habilitação do fornecedor mudou. Verifique a conexão de novo.':r.sync_failures>0?`A última verificação falhou: ${r.last_error}`:null);
 return {id:r.id,displayName:r.display_name,state,capabilities:cap.capabilities,lastSyncAt:r.last_sync_at?.toISOString()??null,revision:Number(r.revision),
  ready:linkedinAccountReady({connected:state==='ready',revoked:false,capabilitiesVersionMatches:matches}),attention};
}
export const readLinkedinAccount=(p:Principal)=>withWorkspaceTransaction(p,async c=>({account:await accountView(c,await linkedinCapabilityView(c)),terms:LINKEDIN_TERMS}));
export const prepareLinkedinConnection=(p:Principal)=>withWorkspaceTransaction(p,async c=>{const cap=await linkedinCapabilityView(c);return {terms:LINKEDIN_TERMS,blockers:connectBlockers(cap),account:await accountView(c,cap)};});

/** Owner/admin accepts the current terms; the server opens a Unipile hosted login (create, or reconnect of the live account). */
export async function confirmLinkedinConnection(p:Principal,sessionId:string,raw:unknown,deps:UnipileDeps={}):Promise<{url:string;expiresAt:string}>{
 if(!sessionId)throw new AppError(401,'Entre novamente para conectar o LinkedIn.');
 const parsed=confirmConnectSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Leia e aceite o termo antes de conectar.');
 const input=parsed.data;if(input.termsVersion!==LINKEDIN_TERMS.version)throw new AppError(409,'O termo mudou. Leia a versão atual antes de conectar.','LINKEDIN_TERMS_CHANGED');
 const state=secret(),notify=secret(),attemptId=randomUUID(),base=browserBase(),notifyAt=notifyBase();
 const begun=await withWorkspaceTransaction(p,async c=>{
  const cap=await linkedinCapabilityView(c);
  if(!linkedinActionAllowed(cap.capabilities,'connect'))throw new AppError(409,cap.reason||'O fornecedor habilitado não oferece a conexão de contas.','LINKEDIN_UNAVAILABLE');
  if(cap.adapter?.id!=='unipile')throw new AppError(409,unsupported,'LINKEDIN_UNSUPPORTED');
  unipileSettings();
  return (await c.query('SELECT app.begin_linkedin_connect($1,$2,$3,$4,$5,$6,$7,$8) v',[attemptId,input.accountId?'reconnect':'create',input.accountId??randomUUID(),digest(state),digest(sessionId),digest(notify),LINKEDIN_TERMS.version,input.expectedRevision])).rows[0].v as {kind:'create'|'reconnect';external:string|null;expiresAt:string};
 }).catch(e=>{throw sqlError(e);});
 const expiresAt=new Date(begun.expiresAt).toISOString();
 try{
  const url=await hostedLink({type:begun.kind,reconnectAccount:begun.external??undefined,name:attemptId,notifyUrl:`${notifyAt}/api/linkedin/oauth/notify?token=${notify}`,
   successUrl:`${base}/api/linkedin/oauth/callback?state=${state}&result=success`,failureUrl:`${base}/api/linkedin/oauth/callback?state=${state}&result=failure`,expiresOn:expiresAt},deps);
  return {url,expiresAt};
 }catch(e){if(e instanceof UnipileRetry||e instanceof UnipileMissing)throw new AppError(503,'Não foi possível abrir a conexão com o LinkedIn agora. Tente de novo.','LINKEDIN_LINK_FAILED');throw e;}
}
/** The starter's browser coming back: same user, session and workspace. A failure closes the attempt; with the vendor's
 * confirmation already in, this binds the account (a forwarded hosted link completed by someone else never comes back here). */
export async function finishLinkedinReturn(p:Principal,sessionId:string,url:URL):Promise<'connected'|'connecting'|'cancelled'>{
 const state=url.searchParams.get('state')??'',result=url.searchParams.get('result');
 if(url.searchParams.getAll('state').length!==1||!/^[A-Za-z0-9_-]{43}$/.test(state)||!['success','failure'].includes(result??'')||!sessionId)throw new AppError(422,'Retorno da conexão inválido.');
 return withWorkspaceTransaction(p,async c=>{const cap=await linkedinCapabilityView(c);
  return (await c.query('SELECT app.return_linkedin_connect($1,$2,$3,$4) v',[digest(state),digest(sessionId),result==='failure',connectable(cap)?capsVersion(cap):null])).rows[0].v;}).catch(e=>{throw sqlError(e);});
}
const LEFT_BEHIND=new Set(['LINKEDIN_NOTIFY_USED','LINKEDIN_AUTHOR_REMOVED','LINKEDIN_UNAVAILABLE','LINKEDIN_ACCOUNT_EXISTS']);
// A rejected create login still left a session in the platform's vendor account: remove it unless someone owns it.
async function discardVendorAccount(external:string,deps:UnipileDeps){
 const pool=ingressPool();
 try{if(!(await pool.query('SELECT app.linkedin_orphan_mark($1) v',[external])).rows[0].v)return;
  await deleteUnipileAccount(external,deps);await pool.query('SELECT app.linkedin_orphan_done($1)',[external]);}
 catch{/* queued: the worker retries */}
}
/** Server-to-server notify from the vendor. Binds only after the vendor confirms the account, with the gate re-read in the same transaction. */
export async function receiveLinkedinNotify(token:string,body:unknown,deps:UnipileDeps={}):Promise<{ok:true}>{
 if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw fail('LINKEDIN_NOTIFY_INVALID');
 const n=notifySchema.safeParse(body);if(!n.success)throw new AppError(422,'Aviso inválido.');
 const {status,account_id:external,name}=n.data,pool=ingressPool(),hash=digest(token);
 const attempt=(await pool.query('SELECT app.linkedin_notify_attempt($1,$2) v',[hash,name])).rows[0].v as {kind:'create'|'reconnect';external:string|null;boundExternal:string|null;closed:boolean}|null;
 if(!attempt)throw fail('LINKEDIN_NOTIFY_INVALID');
 if(attempt.boundExternal){if(attempt.boundExternal===external)return {ok:true};throw fail('LINKEDIN_NOTIFY_USED');}
 if(attempt.closed){if(attempt.kind==='create')await discardVendorAccount(external,deps);throw fail('LINKEDIN_NOTIFY_USED');}
 if((attempt.kind==='create')!==(status==='CREATION_SUCCESS'))throw new AppError(422,'Aviso inválido.');
 if(attempt.kind==='reconnect'&&attempt.external!==external)throw fail('LINKEDIN_ACCOUNT_MISMATCH');
 let remote:Awaited<ReturnType<typeof unipileAccount>>;
 try{remote=await unipileAccount(external,deps);}
 catch(e){if(e instanceof UnipileMissing)throw new AppError(422,'A conta informada não existe no fornecedor.');throw new AppError(503,'Não foi possível confirmar a conta com o fornecedor agora.','LINKEDIN_NOTIFY_RETRY');}
 const c=await pool.connect();let failure:unknown;
 try{
  await c.query('BEGIN');
  const cap=await linkedinCapabilityView(c);
  if(!connectable(cap))throw new AppError(409,cap.reason||unsupported,'LINKEDIN_UNAVAILABLE');
  await c.query('SELECT app.bind_linkedin_account($1,$2,$3,$4,$5,$6)',[hash,external,remote.memberId,remote.name,remote.state,capsVersion(cap)]);
  await c.query('COMMIT');return {ok:true};
 }catch(e){await c.query('ROLLBACK').catch(()=>{});failure=sqlError(e);}finally{c.release();}
 if(attempt.kind==='create'&&failure instanceof AppError&&LEFT_BEHIND.has(failure.code??''))await discardVendorAccount(external,deps);
 throw failure;
}

type Probe={state:LinkedinAccountState;name:string|null;error:string|null;retryMs?:undefined}|{state:null;name:null;error:string;retryMs?:number};
async function probe(external:string,deps:UnipileDeps):Promise<Probe>{
 try{const a=await unipileAccount(external,deps);return {state:a.state,name:a.name,error:attentionFor[a.state]};}
 catch(e){
  if(e instanceof UnipileMissing)return {state:'error',name:null,error:'A conta não existe mais no fornecedor. Conecte de novo.'};
  if(e instanceof UnipileRetry||e instanceof AppError)return {state:null,name:null,error:e.message,retryMs:e instanceof UnipileRetry?e.retryAfterMs:undefined};
  throw e;
 }
}
/** Health check of the live account. One vendor call per request id and per lease; a revoke during the call drops the result. */
export async function syncLinkedinAccount(p:Principal,raw:unknown,deps:UnipileDeps={}):Promise<{state:LinkedinAccountState;lastSyncAt:string|null}>{
 const parsed=z.strictObject({accountId:z.uuid(),requestId:z.uuid()}).safeParse(raw);if(!parsed.success)throw new AppError(422,'Verificação inválida.');
 const {accountId,requestId}=parsed.data,token=randomUUID();
 const claim=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.claim_linkedin_sync($1,$2,$3) v',[accountId,requestId,token])).rows[0].v as {replay:boolean;external:string;epoch:string}).catch(e=>{throw sqlError(e);});
 if(!claim.replay){
  const r=await probe(claim.external,deps);
  const out=await withWorkspaceTransaction(p,async c=>{const cap=await linkedinCapabilityView(c);
   return (await c.query('SELECT app.finish_linkedin_sync($1,$2,$3,$4,$5,$6,$7,$8) v',[accountId,token,claim.epoch,r.state,r.name,r.error,capsVersion(cap),r.retryMs??null])).rows[0].v as string;}).catch(e=>{throw sqlError(e);});
  if(out==='revoked')throw new AppError(409,'A conta foi desconectada durante a verificação.','LINKEDIN_REVOKED');
  if(out==='changed')throw new AppError(409,'A conta foi reconectada durante a verificação. Verifique de novo.','LINKEDIN_CHANGED');
  if(out==='lost')throw fail('LINKEDIN_SYNC_BUSY');
  if(out==='failed')throw new AppError(503,r.error??'A verificação falhou.','LINKEDIN_SYNC_FAILED');
 }
 const a=(await readLinkedinAccount(p)).account;
 return {state:a?.state??'revoked',lastSyncAt:a?.lastSyncAt??null};
}
/** Stops the account at once and keeps its history; the vendor session is removed now or by the worker. */
export async function revokeLinkedinAccount(p:Principal,accountId:string,raw:unknown,deps:UnipileDeps={}):Promise<{revoked:true}>{
 const parsed=z.strictObject({expectedRevision:z.number().int().min(1)}).safeParse(raw);if(!parsed.success||!z.uuid().safeParse(accountId).success)throw new AppError(422,'Operação inválida.');
 const external=await withWorkspaceTransaction(p,async c=>(await c.query('SELECT app.revoke_linkedin_account($1,$2) v',[accountId,parsed.data.expectedRevision])).rows[0].v as string).catch(e=>{throw sqlError(e);});
 try{await deleteUnipileAccount(external,deps);await withWorkspaceTransaction(p,c=>c.query('SELECT app.linkedin_remote_deleted($1)',[accountId]));}
 catch{/* remote_delete_pending stays; the worker retries */}
 return {revoked:true};
}
/** Worker lane: due health checks (only while the gate allows connecting), pending vendor removals and orphaned vendor sessions. */
export async function runLinkedinTick(o:{limit:number;signal?:AbortSignal},deps:UnipileDeps={}){
 const pool=workerPool(),token=randomUUID();
 const items=(await pool.query('SELECT app.claim_linkedin_work($1,$2) v',[o.limit,token])).rows[0].v as {workspaceId:string;id:string;external:string;epoch:string;kind:'sync'|'delete'}[];
 let failed=0;
 for(const it of items){
  if(o.signal?.aborted)break;
  if(it.kind==='delete'){let ok=true;try{await deleteUnipileAccount(it.external,deps);}catch{ok=false;failed++;}
   await pool.query('SELECT app.finish_linkedin_remote_delete($1,$2,$3,$4)',[it.workspaceId,it.id,token,ok]);continue;}
  const c=await pool.connect();
  try{
   const cap=await linkedinCapabilityView(c);
   const r:Probe=connectable(cap)?await probe(it.external,deps):{state:null,name:null,error:'O fornecedor do LinkedIn está desabilitado na plataforma.'};
   if(r.state===null)failed++;
   await c.query('SELECT app.finish_linkedin_work($1,$2,$3,$4,$5,$6,$7,$8,$9)',[it.workspaceId,it.id,token,it.epoch,r.state,r.name,r.error,capsVersion(cap),r.retryMs??null]);
  }finally{c.release();}
 }
 const orphans=(await pool.query('SELECT app.claim_linkedin_orphans($1,$2) v',[o.limit,token])).rows[0].v as string[];
 for(const external of orphans){
  if(o.signal?.aborted)break;
  let ok=true;try{await deleteUnipileAccount(external,deps);}catch{ok=false;failed++;}
  await pool.query('SELECT app.finish_linkedin_orphan($1,$2,$3)',[external,token,ok]);
 }
 return {done:items.length+orphans.length,failed};
}
