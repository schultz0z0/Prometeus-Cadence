import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {connectInputSchema,connectorCatalog,credentialInputSchema,type ConnectionView} from '../../domain/connector-capabilities.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {decryptCredential,encryptCredential,type EncryptedCredential} from '../channels/crypto.ts';
import type {Fetch} from '../prospecting/providers/types.ts';
import {ProviderError} from '../prospecting/providers/transport.ts';
const failures:Record<string,[number,string]>={
 CONNECTOR_ACCESS:[403,'Somente proprietário ou administrador conecta apps.'],
 CREDENTIAL_FORBIDDEN:[403,'Esta credencial não pertence a você, a este workspace ou a este app. Cole a chave de novo.'],
 CREDENTIAL_USED:[409,'Esta credencial venceu ou já foi usada. Cole a chave de novo.'],
 CONNECTION_CONFLICT:[409,'A conexão mudou em outra aba. Recarregue antes de continuar.'],
 CONNECTION_NOT_FOUND:[404,'Conexão não encontrada.'],
 CONNECTION_CHANGED:[409,'A conexão mudou. Recarregue antes de continuar.'],
 OAUTH_INVALID:[403,'Esta autorização não pertence a você, a esta sessão ou a este workspace. Conecte de novo.'],
 OAUTH_USED:[409,'Esta autorização venceu ou já foi usada. Conecte de novo.'],
};
export const connectorError=(e:unknown)=>{const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
export const connectionAad=(workspaceId:string,id:string,revision:number)=>({workspaceId,connectionId:id,provider:'apollo' as const,revision});
const refAad=(workspaceId:string,id:string)=>({workspaceId,connectionId:'ref:'+id,provider:'apollo' as const,revision:0});
async function admin(c:PoolClient){const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;if(!['owner','admin'].includes(role))throw new AppError(403,failures.CONNECTOR_ACCESS[1],'CONNECTOR_ACCESS');}
// The pasted key never travels again: it becomes an opaque single-use reference bound to this user, workspace and app.
export async function storeConnectorSecret(p:Principal,raw:unknown):Promise<{credentialRef:string;expiresAt:string}>{
 const parsed=credentialInputSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Cole a chave completa do app.');
 const id=randomUUID();
 try{return await withWorkspaceTransaction(p,async c=>{await admin(c);
  const at=(await c.query('SELECT app.store_connector_credential($1,$2,$3) v',[id,parsed.data.kind,encryptCredential({secret:parsed.data.secret},refAad(p.workspaceId,id))])).rows[0].v as Date;
  return{credentialRef:id,expiresAt:at.toISOString()};});}catch(e){throw connectorError(e);}
}
// Apollo's documented health check: a valid key answers is_logged_in=true. A refused key creates no connection.
export async function verifyApolloKey(key:string,fetcher:Fetch=fetch,signal:AbortSignal=AbortSignal.timeout(10000)):Promise<'valid'|'refused'|'unavailable'>{
 try{
  const r=await fetcher('https://api.apollo.io/v1/auth/health',{method:'GET',headers:{'x-api-key':key,'cache-control':'no-cache'},signal,redirect:'error'});
  if(r.status===401||r.status===403)return'refused';
  if(!r.ok)return'unavailable';
  const body=await r.json().catch(()=>null);return body?.is_logged_in===true?'valid':'refused';
 }catch{return'unavailable';}
}
export async function connectIntegration(p:Principal,raw:unknown,deps:{verify?:(key:string)=>Promise<'valid'|'refused'|'unavailable'>}={}):Promise<ConnectionView>{
 const parsed=connectInputSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Dê um nome e cole a chave antes de conectar.');const input=parsed.data;
 try{
  const sealed=await withWorkspaceTransaction(p,async c=>{await admin(c);return(await c.query('SELECT app.consume_connector_credential($1,$2) v',[input.credentialRef,input.kind])).rows[0].v as EncryptedCredential;});
  const key=decryptCredential(sealed,refAad(p.workspaceId,input.credentialRef)).secret;
  const verdict=await(deps.verify??verifyApolloKey)(key);
  if(verdict==='refused')throw new AppError(422,'O Apollo recusou esta chave. Confira se ela está ativa e tem acesso à API.','CONNECTOR_REFUSED');
  if(verdict==='unavailable')throw new AppError(503,'Não foi possível confirmar a chave com o Apollo agora. Tente de novo em instantes.','CONNECTOR_UNAVAILABLE');
  // Membership and role are checked again after the external call; a revoked admin saves nothing.
  return await withWorkspaceTransaction(p,async c=>{await admin(c);
   // Take the workspace connector lock before reading the revision the key is sealed for.
   await c.query('SELECT app.connector_actor()');
   const live=(await c.query("SELECT id,revision FROM app.integration_connection WHERE kind=$1 AND state<>'revoked'",[input.kind])).rows[0] as {id:string;revision:string}|undefined;
   const id=live?.id??randomUUID(),next=live?Number(live.revision)+1:1;
   const caps=connectorCatalog.find(x=>x.kind===input.kind)!.capabilities;
   await c.query('SELECT app.save_connection($1,$2,$3,$4,$5,$6)',[id,input.kind,input.name,encryptCredential({secret:key},connectionAad(p.workspaceId,id,next)),caps,input.expectedRevision]);
   return(await list(c)).find(x=>x.id===id)!;
  });
 }catch(e){throw connectorError(e);}
}
async function list(c:PoolClient):Promise<ConnectionView[]>{
 return(await c.query(`SELECT id,kind,name,state,capabilities,revision,verified_at,last_error,config,config_revision,active,attention,last_success_at,
  (SELECT count(*) FROM app.sheet_export s WHERE s.workspace_id=c.workspace_id AND s.connection_id=c.id AND s.state IN('pending','exporting','held')) pending,
  (SELECT count(*) FROM app.sheet_export s WHERE s.workspace_id=c.workspace_id AND s.connection_id=c.id AND s.state='failed') failed
  FROM app.integration_connection c WHERE state<>'revoked' ORDER BY kind,id`)).rows
  .map(r=>({id:r.id,kind:r.kind,name:r.name,state:r.state,capabilities:r.capabilities,revision:Number(r.revision),verifiedAt:r.verified_at?.toISOString()??null,lastError:r.last_error,
   ...(r.kind==='google-sheets'?{config:r.config,configRevision:Number(r.config_revision),active:r.active,attention:r.attention,lastSuccessAt:r.last_success_at?.toISOString()??null,queue:{pending:Number(r.pending),failed:Number(r.failed)}}
    :r.kind==='google-calendar'?{calendar:r.config,configRevision:Number(r.config_revision),attention:r.attention}:{})}));
}
export async function listConnections(p:Principal){return withWorkspaceTransaction(p,async c=>({connections:await list(c),catalog:connectorCatalog}));}
export async function disconnectIntegration(p:Principal,id:string,raw:unknown){
 const parsed=z.strictObject({expectedRevision:z.number().int().min(1)}).safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 try{return await withWorkspaceTransaction(p,async c=>{await admin(c);await c.query('SELECT app.revoke_connection($1,$2)',[id,parsed.data.expectedRevision]);return{disconnected:true as const};});}
 catch(e){throw connectorError(e);}
}
// Worker side: decrypt the key of the job's own workspace for the reviewed revision, right before the call.
export async function workerApolloKey(c:PoolClient,workspaceId:string,connection:{id:string;revision:number}){
 const sealed=(await c.query('SELECT app.connector_secret($1,$2) v',[connection.id,connection.revision])).rows[0].v as EncryptedCredential;
 try{return decryptCredential(sealed,connectionAad(workspaceId,connection.id,connection.revision)).secret;}catch{throw new ProviderError('CONNECTION_KEY_UNREADABLE');}
}
