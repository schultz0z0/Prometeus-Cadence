import 'server-only';
import {localOAuthRedirect,requireLocalOAuth as local} from './session.ts';
import {createHash} from 'node:crypto';
import type {JSONWebKeySet} from 'jose';
import type {Principal} from '../../domain/workspace.ts';
import type {ChatGptOAuthView} from '../../domain/chatgpt-oauth.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requireAiAdmin} from '../prospecting/ai/settings.ts';
import {AppError} from '../errors.ts';
import {oauthStore,type OAuthConnection,createOAuthStore} from './store.ts';
import {createAuthorization,oauthToken,verifyIdentity,accountModels,planScopes,revokeToken} from './protocol.ts';
type Store=ReturnType<typeof createOAuthStore>;
type Dependencies={store?:Store;fetcher?:typeof fetch;keys?:JSONWebKeySet};

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const admin=(p:Principal)=>withWorkspaceTransaction(p,requireAiAdmin);
export function oauthView(workspaceId:string,store=oauthStore):ChatGptOAuthView{
 const row=store.read(workspaceId);return {available:!!localOAuthRedirect(),state:row?.state??'disconnected',revision:row?.revision??0,email:row?.email??null,model:row?.model??'',models:row?.models??[],expiresAt:row?.expiresAt?new Date(row.expiresAt).toISOString():null,lastError:row?.lastError??null};
}
export async function startOAuth(p:Principal,expectedRevision:number,deps:Dependencies={}){
 const redirect=local();await admin(p);const store=deps.store??oauthStore;
 return store.lock(p.workspaceId,async()=>{
  await admin(p);
  let row=store.read(p.workspaceId);if(!row){row=store.initial(p.workspaceId);store.save(p.workspaceId,row,{});}if(row.revision!==expectedRevision)throw new AppError(409,'A conexão mudou. Atualize antes de conectar.');
  const authorization=createAuthorization(row.hostId,redirect,row.clientId?{clientId:row.clientId}:undefined);
  store.putAttempt(authorization.state,{workspaceId:p.workspaceId,connectionId:row.id,userId:p.userId,sessionHash:digest(p.sessionId),revision:row.revision,expiresAt:Date.now()+600000,...(row.clientId?{clientId:row.clientId}:{}),...(row.subject?{subject:row.subject}:{})},{verifier:authorization.verifier,nonce:authorization.nonce,redirectUri:authorization.redirectUri});
  return {url:authorization.url};
 });
}
export async function finishOAuth(p:Principal,callback:URL,deps:Dependencies={}){
 const redirect=local();if(callback.origin!==new URL(redirect).origin||callback.pathname!==new URL(redirect).pathname)throw new AppError(422,'Retorno OAuth inválido.');await admin(p);
 const store=deps.store??oauthStore,{metadata:attempt,proof}=store.consumeAttempt(callback.searchParams.get('state')??'');
 if(attempt.workspaceId!==p.workspaceId||attempt.userId!==p.userId||attempt.sessionHash!==digest(p.sessionId))throw new AppError(403,'A autorização pertence a outra sessão ou workspace.');
 if(callback.searchParams.has('error'))throw new AppError(409,'A autorização ChatGPT foi cancelada.');
 const code=callback.searchParams.get('code'),issued=callback.searchParams.get('client_id'),clientId=attempt.clientId??issued;
 if(!code||code.length>4096||!clientId||clientId==='dynamic_agent_client'||clientId.length>200||attempt.clientId&&issued&&issued!==attempt.clientId)throw new AppError(422,'Registro ChatGPT incompleto.');
 return store.lock(p.workspaceId,async()=>{
  const current=store.read(p.workspaceId);if(!current||current.id!==attempt.connectionId||current.revision!==attempt.revision)throw new AppError(409,'A conexão mudou durante a autorização.');
  const tokens=await oauthToken({grant_type:'authorization_code',client_id:clientId,code,code_verifier:proof.verifier,redirect_uri:proof.redirectUri},deps.fetcher);
  if(!tokens.id_token)throw new AppError(409,'A identidade ChatGPT não foi recebida.');const identity=await verifyIdentity(tokens.id_token,clientId,proof.nonce,deps.keys);
  if(attempt.subject&&identity.subject!==attempt.subject)throw new AppError(409,'A conta retornada não corresponde à conexão selecionada.');
  const scopes=(tokens.scope??'').split(/\s+/),enabled=planScopes.filter(s=>['resource.invoke','chatgpt.tokens.use.direct','offline_access'].includes(s)).every(s=>scopes.includes(s))&&!!tokens.refresh_token;
  let models:{id:string;name:string}[]=[],catalogError=false;
  if(enabled)try{models=await accountModels(tokens.access_token,deps.fetcher);}catch{catalogError=true;}
  const usable=enabled&&models.length>0&&!catalogError;
  await admin(p);
  const next:OAuthConnection={...current,revision:current.revision+1,refreshPending:false,clientId,subject:identity.subject,email:identity.email,scopes,models,model:models.some(m=>m.id===current.model)?current.model:models[0]?.id??'',state:usable?'connected':'attention',expiresAt:Date.now()+tokens.expires_in*1000,lastError:!enabled?'CHATGPT_PLAN_PERMISSION_REQUIRED':usable?null:'CHATGPT_CATALOG_UNAVAILABLE'};
  store.save(p.workspaceId,next,{accessToken:tokens.access_token,refreshToken:tokens.refresh_token??'',idToken:tokens.id_token});return oauthView(p.workspaceId,store);
 });
}
export async function selectOAuthModel(p:Principal,expectedRevision:number,model:string,deps:Dependencies={}){
 local();await admin(p);const store=deps.store??oauthStore;return store.lock(p.workspaceId,async()=>{const row=store.read(p.workspaceId);if(!row||row.state!=='connected'||row.revision!==expectedRevision)throw new AppError(409,'Atualize a conexão antes de escolher o modelo.');if(!row.models.some(m=>m.id===model))throw new AppError(422,'Escolha um modelo disponível nesta conta.');const secrets=store.credentials(p.workspaceId,row.revision);store.save(p.workspaceId,{...row,model,revision:row.revision+1},secrets);return oauthView(p.workspaceId,store);});
}
export async function disconnectOAuth(p:Principal,expectedRevision:number,deps:Dependencies={}){
 local();await admin(p);const store=deps.store??oauthStore;return store.lock(p.workspaceId,async()=>{const row=store.read(p.workspaceId);if(!row||row.revision!==expectedRevision)throw new AppError(409,'A conexão mudou.');const secrets=store.credentials(p.workspaceId,row.revision);let revoked=!secrets.refreshToken;try{if(secrets.refreshToken&&row.clientId)revoked=await revokeToken(secrets.refreshToken,row.clientId,deps.fetcher);}catch{}
  store.save(p.workspaceId,{...row,state:'disconnected',refreshPending:false,revision:row.revision+1,model:'',models:[],expiresAt:0,lastError:revoked?null:'CHATGPT_REMOTE_REVOCATION_UNCONFIRMED'},{});return oauthView(p.workspaceId,store);
 });
}
