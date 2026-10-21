import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {ConversationView,MessageView} from '../../domain/whatsapp.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {conversationRow,conversationView,messageView} from './repository.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
const querySchema=z.strictObject({search:z.string().max(200).optional(),cursor:z.uuid().optional(),senderId:z.uuid().optional()});
export async function listConversations(p:Principal,query:{search?:string;cursor?:string;senderId?:string}):Promise<{items:ConversationView[];nextCursor:string|null}>{
 const parsed=querySchema.safeParse(query);if(!parsed.success)throw new AppError(422,'Filtro de conversas inválido.');const q=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  const rows=(await c.query("SELECT v.* FROM app.channel_conversation v JOIN app.channel_identity i ON i.workspace_id=v.workspace_id AND i.id=v.identity_id WHERE ($1::text IS NULL OR v.id>$1) AND ($2::text IS NULL OR v.sender_id=$2) AND ($3::text IS NULL OR position(lower($3) in lower(i.external_id||' '||COALESCE(i.phone,'')))>0) ORDER BY v.id LIMIT 101",[q.cursor??null,q.senderId??null,q.search?.trim()||null])).rows;
  return {items:await Promise.all(rows.slice(0,100).map(r=>conversationView(c,r))),nextCursor:rows.length>100?rows[99].id:null};
 });
}
export async function readConversation(p:Principal,id:string,cursor?:string):Promise<{conversation:ConversationView;messages:MessageView[];nextCursor:string|null}>{
 if(cursor&&!/^\d{1,20}$/.test(cursor))throw new AppError(422,'Página de mensagens inválida.');
 return withWorkspaceTransaction(p,async c=>{
  const row=await conversationRow(c,id),messages=(await c.query('SELECT * FROM app.channel_message WHERE conversation_id=$1 AND ($2::bigint IS NULL OR message_order<$2) ORDER BY message_order DESC LIMIT 101',[id,cursor??null])).rows;
  return {conversation:await conversationView(c,row),messages:messages.slice(0,100).map(messageView).reverse(),nextCursor:messages.length>100?String(messages[99].message_order):null};
 });
}
const readSchema=z.strictObject({requestId:z.uuid(),messageId:z.uuid()});
export async function markConversationRead(p:Principal,id:string,input:unknown):Promise<void>{
 const parsed=readSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Informe a última mensagem exibida.');
 await withWorkspaceTransaction(p,async c=>{
  await conversationRow(c,id);const row=(await c.query('SELECT message_order FROM app.channel_message WHERE id=$1 AND conversation_id=$2',[parsed.data.messageId,id])).rows[0];if(!row)throw new AppError(404,'Mensagem não encontrada nesta conversa.');
  await c.query('INSERT INTO app.channel_conversation_read(workspace_id,conversation_id,user_id,message_order) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,conversation_id,user_id) DO UPDATE SET message_order=GREATEST(channel_conversation_read.message_order,EXCLUDED.message_order)',[p.workspaceId,id,p.userId,row.message_order]);
 });
}
const linkSchema=z.strictObject({requestId:z.uuid(),leadId:z.string().min(1).max(120),expectedLeadId:z.string().nullable(),evidence:z.string().trim().min(1).max(4000)});
export async function linkConversationLead(p:Principal,id:string,input:unknown):Promise<ConversationView>{
 const parsed=linkSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise a empresa e a evidência do vínculo.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'conversation.link',id,input:b}),old=await priorCommand<ConversationView>(c,p,b.requestId,hash);if(old)return old;
  const conversation=await conversationRow(c,id,true);if(conversation.lead_id!==b.expectedLeadId)throw new AppError(409,'O vínculo mudou. Revise novamente.');
  if(!(await c.query('SELECT id FROM app.lead WHERE id=$1',[b.leadId])).rowCount)throw new AppError(404,'Lead não encontrado.');
  await c.query('UPDATE app.channel_conversation SET lead_id=$2,lead_link_evidence=$3 WHERE id=$1',[id,b.leadId,{actorId:p.userId,evidence:b.evidence,at:new Date().toISOString()}]);const result=await conversationView(c,await conversationRow(c,id));await completeCommand(c,p,b.requestId,hash,result,'conversation.link');return result;
 });
}
