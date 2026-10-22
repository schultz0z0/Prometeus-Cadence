import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {MailboxView,MailProvider} from '../../domain/mail.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand,readCredentialInTransaction} from '../channels/repository.ts';
import {encryptCredential} from '../channels/crypto.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {mailboxSaveSchema} from './schemas.ts';
import type {MailConfig} from './contracts.ts';

export async function mailboxRow(c:PoolClient,id:string,lock=false):Promise<Record<string,any>> {
 const row=(await c.query('SELECT m.*,c.name,c.revision,c.identifiers,c.created_by,c.provider,c.token_expires_at FROM app.email_mailbox m JOIN app.channel_connection c ON c.workspace_id=m.workspace_id AND c.id=m.id WHERE m.id=$1'+(lock?' FOR UPDATE OF m,c':''),[id])).rows[0];
 if(!row)throw new AppError(404,'Caixa de e-mail não encontrada.');return row;
}
export async function mailboxView(c:PoolClient,row:Record<string,any>):Promise<MailboxView> {
 const sender=(await c.query('SELECT id,daily_limit FROM app.channel_sender WHERE connection_id=$1 AND channel=\'EMAIL\' ORDER BY id LIMIT 1',[row.id])).rows[0];
 return {id:row.id,senderId:sender?.id??null,provider:row.provider as MailProvider,name:row.name,address:row.address,revision:Number(row.revision),state:row.state,hasSecrets:!!row.identifiers?.hasSecrets,sendVerified:row.send_verified,readVerified:row.read_verified,lastSyncedAt:row.last_synced_at?.toISOString()??null,syncState:row.sync_state,dailyLimit:sender?.daily_limit??null,signature:row.signature,lastError:row.last_error};
}
export async function listMailboxes(p:Principal):Promise<MailboxView[]> {
 return withWorkspaceTransaction(p,async c=>{const ids=(await c.query('SELECT id FROM app.email_mailbox ORDER BY created_at,id LIMIT 100')).rows;return Promise.all(ids.map(async r=>mailboxView(c,await mailboxRow(c,r.id))));});
}
export async function readMailConfig(c:PoolClient,id:string,expectedRevision?:number):Promise<MailConfig> {
 await requireChannelAdmin(c);const row=await mailboxRow(c,id);
 if(expectedRevision!==undefined&&Number(row.revision)!==expectedRevision)throw new AppError(409,'A caixa mudou. Revise novamente.');
 const secret=await readCredentialInTransaction(c,id);return {mailbox:await mailboxView(c,row),config:row.identifiers.config,credentials:secret.credentials,cursor:null};
}
export async function saveMailbox(p:Principal,input:unknown):Promise<MailboxView> {
 const parsed=mailboxSaveSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise a configuração da caixa de e-mail.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);await lockWorkspace(c);const hash=commandHash({action:'mailbox.save',input:b}),old=await priorCommand<MailboxView>(c,p,b.requestId,hash);if(old)return old;
  const current=b.id?await mailboxRow(c,b.id,true):null;
  if(Number(current?.revision??0)!==b.expectedRevision)throw new AppError(409,'A caixa mudou. Revise novamente.');
  if(current&&current.provider!==b.provider)throw new AppError(409,'Crie outra conexão para trocar de provedor.');
  if(current?.proof_verified&&b.provider==='smtp-imap'&&current.address!==b.address)throw new AppError(409,'Crie outra conexão para trocar de endereço.');
  const id=b.id??randomUUID(),revision=b.expectedRevision+1,prior=current?(await readCredentialInTransaction(c,id)).credentials:{};
  const credentials={...prior};for(const [key,value] of Object.entries(b.credentials))if(value)credentials[key]=value;
  if(b.provider==='smtp-imap'&&(!credentials.smtpPassword||!credentials.imapPassword))throw new AppError(422,'Informe as credenciais de envio e leitura.');
  const envelope=encryptCredential(credentials,{workspaceId:p.workspaceId,connectionId:id,provider:b.provider,revision});
  const identifiers={config:b.config,hasSecrets:Object.keys(credentials).length>0};
  if(current){await c.query("UPDATE app.channel_connection SET name=$2,revision=$3,identifiers=$4,state='pending',credentials_verified=false,updated_at=clock_timestamp() WHERE id=$1",[id,b.name,revision,identifiers]);}
  else await c.query("INSERT INTO app.channel_connection(workspace_id,id,provider,channel,name,public_id,identifiers,created_by) VALUES($1,$2,$3,'EMAIL',$4,$5,$6,$7)",[p.workspaceId,id,b.provider,b.name,randomUUID(),identifiers,p.userId]);
  await c.query('SELECT app.write_channel_credential($1,$2,$3)',[id,revision,envelope]);
  const address=b.provider==='smtp-imap'?b.address:current?.address??null,state=b.provider==='gmail'?'authorization_required':'pending';
  await c.query('INSERT INTO app.email_mailbox(workspace_id,id,provider,address,signature,state) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,id) DO UPDATE SET address=EXCLUDED.address,signature=EXCLUDED.signature,state=EXCLUDED.state,send_verified=false,read_verified=false,proof_verified=false,baseline_at=NULL,last_synced_at=NULL,sync_state=\'baseline\',last_error=NULL',[p.workspaceId,id,b.provider,address,b.signature,state]);
  if(current)await c.query('SELECT app.reset_mailbox_sync_revision($1,$2)',[id,revision]);
  await c.query('UPDATE app.channel_sender SET ready=false,revision=revision+1 WHERE connection_id=$1',[id]);
  const result=await mailboxView(c,await mailboxRow(c,id));await completeCommand(c,p,b.requestId,hash,result,'mailbox.save');return result;
 });
}
