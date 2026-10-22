import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {EmailConversationView,EmailThreadView,EmailMessageView} from '../../domain/mail.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {conversationRow,messageView} from '../messaging/repository.ts';
import {mailCursor,readMailCursor} from './inbox-cursor.ts';
const querySchema=z.strictObject({channel:z.literal('EMAIL'),search:z.string().max(200).optional(),cursor:z.string().max(2048).optional(),senderId:z.uuid().optional(),direction:z.enum(['inbound','outbound']).optional()});
export type EmailInboxQuery=z.infer<typeof querySchema>;
async function view(c:PoolClient,row:Record<string,any>):Promise<EmailConversationView>{
 const meta=(await c.query("SELECT t.*,conn.name AS mailbox_name,m.address AS mailbox_address,i.external_id,COALESCE((SELECT count(*) FROM app.channel_message cm WHERE cm.conversation_id=$1 AND cm.direction='inbound' AND cm.message_order>COALESCE((SELECT message_order FROM app.channel_conversation_read WHERE conversation_id=$1 AND user_id=current_setting('app.user_id')),0)),0) AS unread FROM app.email_thread t JOIN app.email_mailbox m ON m.workspace_id=t.workspace_id AND m.id=t.mailbox_id JOIN app.channel_connection conn ON conn.workspace_id=m.workspace_id AND conn.id=m.id JOIN app.channel_identity i ON i.workspace_id=t.workspace_id AND i.id=$2 WHERE t.conversation_id=$1",[row.id,row.identity_id])).rows[0];
 if(!meta)throw new AppError(404,'Conversa de e-mail não encontrada.');
 return {channel:'EMAIL',id:row.id,senderId:row.sender_id,identityId:row.identity_id,identity:{scope:'email',externalId:meta.external_id,phone:null},leadId:row.lead_id,unread:Number(meta.unread),lastMessageAt:row.last_message_at?.toISOString()??null,mail:{mailboxId:meta.mailbox_id,mailboxName:meta.mailbox_name,mailboxAddress:meta.mailbox_address,subject:meta.subject,needsReview:meta.needs_review}};
}
export async function listEmailConversations(p:Principal,input:EmailInboxQuery):Promise<{items:EmailConversationView[];nextCursor:string|null}>{
 const parsed=querySchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Filtro de e-mail inválido.');const q=parsed.data,{cursor,...filters}=q,scope={kind:'mail-list',workspace:p.workspaceId,user:p.userId,...filters},after=readMailCursor(cursor,scope);
 if(after&&!z.uuid().safeParse(after).success)throw new AppError(422,'Página inválida.');
 return withWorkspaceTransaction(p,async c=>{
  if(q.senderId&&!(await c.query("SELECT id FROM app.channel_sender WHERE id=$1 AND channel='EMAIL'",[q.senderId])).rowCount)throw new AppError(404,'Caixa não encontrada.');
  const rows=(await c.query("SELECT v.* FROM app.channel_conversation v JOIN app.channel_identity i ON i.workspace_id=v.workspace_id AND i.id=v.identity_id JOIN app.email_thread t ON t.workspace_id=v.workspace_id AND t.conversation_id=v.id WHERE v.channel='EMAIL' AND ($1::text IS NULL OR v.id>$1) AND($2::text IS NULL OR v.sender_id=$2) AND($3::text IS NULL OR position(lower($3) in lower(i.external_id||' '||t.subject))>0) AND($4::text IS NULL OR EXISTS(SELECT 1 FROM app.channel_message cm WHERE cm.workspace_id=v.workspace_id AND cm.conversation_id=v.id AND cm.direction=$4)) ORDER BY v.id LIMIT 101",[after,q.senderId??null,q.search?.trim()||null,q.direction??null])).rows;
  return {items:await Promise.all(rows.slice(0,100).map(row=>view(c,row))),nextCursor:rows.length>100?mailCursor(scope,rows[99].id):null};
 });
}
export async function readEmailConversation(p:Principal,id:string,cursor?:string):Promise<EmailThreadView>{
 const scope={kind:'mail-history',workspace:p.workspaceId,user:p.userId,conversation:id},after=readMailCursor(cursor,scope);
 if(after&&(!/^\d{1,19}$/.test(after)||BigInt(after)>9223372036854775807n))throw new AppError(422,'Página inválida.');
 return withWorkspaceTransaction(p,async c=>{const row=await conversationRow(c,id);if(row.channel!=='EMAIL')throw new AppError(404,'Conversa de e-mail não encontrada.');
  const messages=(await c.query('SELECT cm.*,em.subject,em.from_address,em.to_addresses,em.origin,em.classification,em.attachments,em.truncated,em.rfc_message_id,em.in_reply_to,em.reference_ids FROM app.channel_message cm JOIN app.email_message em ON em.workspace_id=cm.workspace_id AND em.message_id=cm.id WHERE cm.conversation_id=$1 AND($2::bigint IS NULL OR cm.message_order<$2) ORDER BY cm.message_order DESC LIMIT 101',[id,after])).rows;
  const convert=(message:Record<string,any>):EmailMessageView=>({...messageView(message),channel:'EMAIL',mail:{subject:message.subject,from:message.from_address,to:message.to_addresses,origin:message.origin,classification:message.classification,attachments:message.attachments,truncated:message.truncated,rfcMessageId:message.rfc_message_id,inReplyTo:message.in_reply_to,references:message.reference_ids}});
  return {channel:'EMAIL',conversation:await view(c,row),messages:messages.slice(0,100).map(convert).reverse(),nextCursor:messages.length>100?mailCursor(scope,String(messages[99].message_order)):null};
 });
}
