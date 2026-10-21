import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {ConversationView,MessageView} from '../../domain/whatsapp.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {conversationRow,conversationView,messageView} from './repository.ts';
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
