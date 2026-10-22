import 'server-only';
import {randomUUID} from 'node:crypto';
import type {Principal} from '../../domain/workspace.ts';
import type {ConnectionView,TemplateView} from '../../domain/whatsapp.ts';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {connectionRow,connectionView,requireChannelAdmin,readCredentialInTransaction,commandHash,priorCommand,completeCommand} from './repository.ts';
import {encryptCredential} from './crypto.ts';
import {createMetaAdapter} from './providers/meta.ts';
import {createTwilioAdapter} from './providers/twilio.ts';
import type {ProviderAdapter,ProviderConfig} from './providers/contracts.ts';
export const providerAdapter=(provider:string)=>{if(provider==='meta')return createMetaAdapter();if(provider==='twilio')return createTwilioAdapter();throw new AppError(422,'Provedor WhatsApp inválido.');};
export async function configInTransaction(c:PoolClient,id:string,expectedRevision?:number):Promise<ProviderConfig>{
 await requireChannelAdmin(c);const row=await connectionRow(c,id);
 if(expectedRevision!==undefined&&Number(row.revision)!==expectedRevision)throw new AppError(409,'A conexão mudou. Revise novamente.');
 const secrets=await readCredentialInTransaction(c,id),senders=(await connectionView(c,row)).senders,templates=(await c.query('SELECT payload FROM app.channel_remote_template WHERE connection_id=$1',[id])).rows.map(r=>r.payload as TemplateView);
 return {provider:row.provider,connectionId:id,revision:Number(row.revision),identifiers:row.identifiers,credentials:secrets.credentials,sender:senders[0]??null,templates};
}
export async function verifyConnection(p:Principal,id:string,expectedRevision:number,deps:{adapter?:ProviderAdapter}={}):Promise<ConnectionView>{
 const config=await withWorkspaceTransaction(p,c=>configInTransaction(c,id,expectedRevision));
 const assets=await (deps.adapter??providerAdapter(config.provider)).verifyAssets(config);
 try{return await withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const row=await connectionRow(c,id,true);
  if(Number(row.revision)!==expectedRevision||row.state==='disconnected')throw new AppError(409,'A conexão mudou durante a verificação.');
  await c.query('SELECT app.verify_channel_assets($1,$2,$3)',[id,expectedRevision,{...assets,senders:assets.senders.map(s=>({...s,id:randomUUID()}))}]);
  await c.query('INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,$3)',[p.workspaceId,p.userId,'channel.verify']);return connectionView(c,await connectionRow(c,id));
 });}catch(e){if(e&&typeof e==='object'&&'message'in e&&String(e.message).includes('CHANNEL_'))throw new AppError(409,'A conta ou o remetente já está em uso, ou a conexão mudou.');throw e;}
}
export async function readVerifyToken(p:Principal,id:string):Promise<{verifyToken:string}>{
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);return {verifyToken:(await readCredentialInTransaction(c,id)).credentials.verifyToken};});
}
const disconnectSchema=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().min(1),requestId:z.uuid()});
export async function disconnectConnection(p:Principal,input:unknown):Promise<ConnectionView>{
 const parsed=disconnectSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Desconexão inválida.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'channel.disconnect',input:b}),old=await priorCommand<ConnectionView>(c,p,b.requestId,hash);if(old)return old;
  const row=await connectionRow(c,b.id,true);if(Number(row.revision)!==b.expectedRevision)throw new AppError(409,'A conexão mudou.');
  if(row.channel==='EMAIL')throw new AppError(404,'Conexão WhatsApp não encontrada.');
  const secrets=await readCredentialInTransaction(c,b.id),revision=b.expectedRevision+1;
  const envelope=encryptCredential(secrets.credentials,{workspaceId:p.workspaceId,connectionId:b.id,provider:row.provider,revision});
  await c.query("UPDATE app.channel_connection SET revision=$2,state='disconnected',credentials_verified=false,updated_at=clock_timestamp() WHERE id=$1",[b.id,revision]);
  await c.query('SELECT app.write_channel_credential($1,$2,$3)',[b.id,revision,envelope]);
  await c.query('UPDATE app.channel_sender SET ready=false,revision=revision+1 WHERE connection_id=$1',[b.id]);
  const result=await connectionView(c,await connectionRow(c,b.id));await completeCommand(c,p,b.requestId,hash,result,'channel.disconnect');return result;
 });
}
