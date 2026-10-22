import 'server-only';
import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {ConnectionView,Provider,SenderView} from '../../domain/whatsapp.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {canonical} from '../prospecting/review.ts';
import {saveConnectionSchema} from './schemas.ts';
import {decryptCredential,encryptCredential} from './crypto.ts';
import {channelCallbackUrl} from './webhook-auth.ts';
export async function requireChannelAdmin(c:PoolClient){
 const role=(await c.query('SELECT app.current_role() AS role')).rows[0]?.role;
 if(role!=='admin'&&role!=='owner')throw new AppError(403,'Somente administradores podem gerenciar conexões.');
}
export function commandHash(input:unknown){
 if(!process.env.BETTER_AUTH_SECRET)throw Error('Command signing unavailable');
 return createHmac('sha256',process.env.BETTER_AUTH_SECRET).update(canonical(input)).digest('hex');
}
export async function priorCommand<T>(c:PoolClient,p:Principal,requestId:string,hash:string):Promise<T|undefined>{
 const old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[requestId])).rows[0];
 if(!old)return undefined;if(old.user_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result as T;
}
export async function completeCommand(c:PoolClient,p:Principal,requestId:string,hash:string,result:unknown,action:string){
 await c.query('INSERT INTO app.command_result(workspace_id,request_id,user_id,body_hash,result) VALUES($1,$2,$3,$4,$5)',[p.workspaceId,requestId,p.userId,hash,result]);
 await c.query('INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,$3)',[p.workspaceId,p.userId,action]);
}
export async function connectionRow(c:PoolClient,id:string,lock=false){
 const row=(await c.query('SELECT * FROM app.channel_connection WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];
 if(!row)throw new AppError(404,'Conexão não encontrada.');return row;
}
export function senderView(row:Record<string,any>):SenderView{return {id:row.id,connectionId:row.connection_id,provider:row.provider,address:row.address,externalId:row.external_id,identityScope:row.identity_scope,revision:Number(row.revision),ready:row.ready,dailyLimit:row.daily_limit};}
export async function connectionView(c:PoolClient,row:Record<string,any>):Promise<ConnectionView>{
 if(row.channel==='EMAIL')throw new AppError(404,'Conexão WhatsApp não encontrada.');
 const senders=(await c.query('SELECT * FROM app.channel_sender WHERE connection_id=$1 ORDER BY id',[row.id])).rows.map(senderView);
 let callbackUrl:string|null=null,callbackStatusUrl:string|null=null;try{callbackUrl=channelCallbackUrl(row.provider,row.public_id);if(row.provider==='twilio')callbackStatusUrl=channelCallbackUrl('twilio',row.public_id,'status');}catch{}
 const expired=row.token_expires_at&&row.token_expires_at.getTime()<=Date.now();
 return {id:row.id,provider:row.provider,name:row.name,revision:Number(row.revision),state:expired&&row.state!=='disconnected'?'attention':row.state,externalAccountId:row.external_account_id,hasSecrets:true,identifiers:row.identifiers,callbackUrl,callbackStatusUrl,callbackPath:'/api/channel-webhooks/'+row.provider+'/'+row.public_id+(row.provider==='twilio'?'/messages':''),verification:{credentials:row.credentials_verified,challenge:row.challenge_verified,inbound:row.inbound_verified},senders:senders.map(s=>({...s,ready:s.ready&&!expired})),lastError:expired?'TOKEN_EXPIRED':row.last_error,tokenExpiresAt:row.token_expires_at?.toISOString()??null};
}
export async function readConnections(p:Principal):Promise<ConnectionView[]>{
 return withWorkspaceTransaction(p,async c=>{
  const rows=(await c.query("SELECT * FROM app.channel_connection WHERE channel='WHATSAPP' ORDER BY created_at,id")).rows;
  return Promise.all(rows.map(row=>connectionView(c,row)));
 });
}
export async function readCredentialInTransaction(c:PoolClient,id:string,revision?:number):Promise<{credentials:Record<string,string>;revision:number}>{
 await requireChannelAdmin(c);const row=await connectionRow(c,id),rev=revision??Number(row.revision);
 const envelope=(await c.query('SELECT app.read_channel_credential($1,$2) AS envelope',[id,rev])).rows[0]?.envelope;
 if(!envelope)throw new AppError(409,'Credenciais indisponíveis.');
 return {credentials:decryptCredential(envelope,{workspaceId:row.workspace_id,connectionId:id,provider:row.provider,revision:rev}),revision:rev};
}
export async function saveConnection(p:Principal,input:unknown):Promise<ConnectionView>{
 const parsed=saveConnectionSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Configuração da conexão inválida.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);
  await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);
  await lockWorkspace(c);const hash=commandHash({action:'channel.save',input:b}),old=await priorCommand<ConnectionView>(c,p,b.requestId,hash);if(old)return old;
  const existing=b.id?await connectionRow(c,b.id,true):null;
  if((existing?Number(existing.revision):0)!==b.expectedRevision)throw new AppError(409,'A conexão mudou. Revise novamente.');
  if(existing&&existing.provider!==b.provider)throw new AppError(409,'Crie outra conexão para trocar de provedor.');
  const id=b.id??randomUUID(),revision=b.expectedRevision+1,credentials=existing?(await readCredentialInTransaction(c,id)).credentials:{verifyToken:randomBytes(32).toString('base64url')};
  for(const [key,value]of Object.entries(b.credentials))if(value.trim())credentials[key]=value;
  const required=b.provider==='meta'?['accessToken','appSecret']:b.identifiers.authMode==='api-key'?['apiKeySid','apiKeySecret','authToken']:['authToken'];
  if(required.some(key=>!credentials[key]))throw new AppError(422,'Informe as credenciais obrigatórias.');
  const envelope=encryptCredential(credentials,{workspaceId:p.workspaceId,connectionId:id,provider:b.provider,revision});
  if(existing){
   await c.query("UPDATE app.channel_connection SET name=$2,revision=$3,identifiers=$4,state='pending',credentials_verified=false,challenge_verified=false,inbound_verified=false,last_error=NULL,external_account_id=NULL,updated_at=clock_timestamp() WHERE id=$1",[id,b.name,revision,b.identifiers]);
   await c.query('UPDATE app.channel_sender SET ready=false,revision=revision+1 WHERE connection_id=$1',[id]);
  }else await c.query('INSERT INTO app.channel_connection(workspace_id,id,provider,name,revision,public_id,identifiers,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,id,b.provider,b.name,revision,randomBytes(32).toString('base64url'),b.identifiers,p.userId]);
  await c.query('SELECT app.write_channel_credential($1,$2,$3)',[id,revision,envelope]);
  const result=await connectionView(c,await connectionRow(c,id));await completeCommand(c,p,b.requestId,hash,result,'channel.save');return result;
 });
}
