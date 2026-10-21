import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import {senderLimitsSchema} from './schemas.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from './repository.ts';
export interface MessagingLimitsView {revision:number;workspaceDailyLimit:number|null;timezone:string}
export async function readMessagingLimits(p:Principal):Promise<MessagingLimitsView>{return withWorkspaceTransaction(p,async c=>{
 const row=(await c.query('SELECT * FROM app.messaging_limits')).rows[0];return {revision:Number(row?.revision??0),workspaceDailyLimit:row?.workspace_daily_limit??null,timezone:row?.timezone??'America/Sao_Paulo'};
});}
export async function saveSenderLimits(p:Principal,input:unknown):Promise<void>{
 const parsed=senderLimitsSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Limites de envio inválidos.');const b=parsed.data;
 await withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'sender.limits',input:b});if(await priorCommand(c,p,b.requestId,hash))return;
  const row=(await c.query('SELECT * FROM app.messaging_limits FOR UPDATE')).rows[0],sender=(await c.query('SELECT * FROM app.channel_sender WHERE id=$1 FOR UPDATE',[b.senderId])).rows[0];
  if(!sender)throw new AppError(404,'Remetente não encontrado.');if(Number(row?.revision??0)!==b.expectedRevision)throw new AppError(409,'Os limites mudaram. Revise novamente.');
  await c.query('INSERT INTO app.messaging_limits(workspace_id,workspace_daily_limit,revision) VALUES($1,$2,1) ON CONFLICT(workspace_id) DO UPDATE SET workspace_daily_limit=EXCLUDED.workspace_daily_limit,revision=messaging_limits.revision+1',[p.workspaceId,b.workspaceDailyLimit]);
  await c.query('UPDATE app.channel_sender SET daily_limit=$2,revision=revision+1 WHERE id=$1',[b.senderId,b.senderDailyLimit]);await completeCommand(c,p,b.requestId,hash,{saved:true},'sender.limits');
 });
}
