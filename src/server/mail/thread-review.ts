import 'server-only';
import {z} from 'zod';import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';import {AppError} from '../errors.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
const schema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().min(1),lastMessageId:z.uuid(),acknowledge:z.literal(true),reason:z.string().trim().min(20).max(2000)});
export async function acknowledgeMailThread(p:Principal,id:string,input:unknown):Promise<{reviewed:true}>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirme a revisão da mensagem original e descreva o que foi conferido.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'mail.thread.review',id,input:b}),old=await priorCommand<{reviewed:true}>(c,p,b.requestId,hash);if(old)return old;
  const thread=(await c.query('SELECT t.*,conn.revision FROM app.email_thread t JOIN app.channel_connection conn ON conn.workspace_id=t.workspace_id AND conn.id=t.mailbox_id WHERE t.conversation_id=$1',[id])).rows[0];if(!thread)throw new AppError(404,'Thread não encontrada.');
  const latest=(await c.query('SELECT id FROM app.channel_message WHERE conversation_id=$1 ORDER BY message_order DESC LIMIT 1',[id])).rows[0];if(Number(thread.revision)!==b.expectedRevision||latest?.id!==b.lastMessageId)throw new AppError(409,'O histórico ou a caixa mudou. Atualize e revise novamente.');
  await c.query('SELECT app.acknowledge_mail_thread($1,$2,$3,$4,$5)',[id,b.expectedRevision,b.lastMessageId,b.requestId,b.reason]);const result={reviewed:true as const};await completeCommand(c,p,b.requestId,hash,result,'mail.thread.review');return result;
 });
}
