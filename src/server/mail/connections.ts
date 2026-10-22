import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import type {MailboxView} from '../../domain/mail.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand,readCredentialInTransaction} from '../channels/repository.ts';
import {encryptCredential} from '../channels/crypto.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {mailboxActionSchema} from './schemas.ts';
import {mailboxRow,mailboxView} from './repository.ts';
export async function disconnectMailbox(p:Principal,input:unknown):Promise<MailboxView> {
 const parsed=mailboxActionSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Desconexão de caixa inválida.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'mailbox.disconnect',input:b}),old=await priorCommand<MailboxView>(c,p,b.requestId,hash);if(old)return old;
  const row=await mailboxRow(c,b.id,true);if(Number(row.revision)!==b.expectedRevision)throw new AppError(409,'A caixa mudou.');
  const revision=b.expectedRevision+1,secrets=(await readCredentialInTransaction(c,b.id)).credentials;
  const envelope=encryptCredential(secrets,{workspaceId:p.workspaceId,connectionId:b.id,provider:row.provider,revision});
  await c.query("UPDATE app.channel_connection SET revision=$2,state='disconnected',credentials_verified=false,updated_at=clock_timestamp() WHERE id=$1",[b.id,revision]);
  await c.query('SELECT app.write_channel_credential($1,$2,$3)',[b.id,revision,envelope]);
  await c.query("UPDATE app.email_mailbox SET state='disconnected',send_verified=false,read_verified=false WHERE id=$1",[b.id]);
  await c.query('UPDATE app.channel_sender SET ready=false,revision=revision+1 WHERE connection_id=$1',[b.id]);
  const result=await mailboxView(c,await mailboxRow(c,b.id));await completeCommand(c,p,b.requestId,hash,result,'mailbox.disconnect');return result;
 });
}
