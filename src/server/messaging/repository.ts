import 'server-only';
import type {PoolClient} from 'pg';
import type {ConversationView,MessageView,MessageState} from '../../domain/whatsapp.ts';
import {AppError} from '../errors.ts';
export async function conversationRow(c:PoolClient,id:string,lock=false){
 const row=(await c.query('SELECT * FROM app.channel_conversation WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];if(!row)throw new AppError(404,'Conversa não encontrada.');return row;
}
export async function conversationView(c:PoolClient,row:Record<string,any>):Promise<ConversationView>{
 const identity=(await c.query('SELECT * FROM app.channel_identity WHERE id=$1',[row.identity_id])).rows[0];
 const unread=(await c.query("SELECT count(*) AS count FROM app.channel_message WHERE conversation_id=$1 AND direction='inbound' AND message_order>COALESCE((SELECT message_order FROM app.channel_conversation_read WHERE conversation_id=$1 AND user_id=current_setting('app.user_id')),0)",[row.id])).rows[0].count;
 return {id:row.id,senderId:row.sender_id,identityId:identity.id,identity:{scope:identity.scope,externalId:identity.external_id,phone:identity.phone},leadId:row.lead_id,unread:Number(unread),lastMessageAt:row.last_message_at?.toISOString()??null};
}
export function messageView(row:Record<string,any>):MessageView{return {id:row.id,conversationId:row.conversation_id,direction:row.direction,text:row.text,mediaKind:row.media_kind,state:row.state as MessageState,remoteId:row.remote_id,createdAt:row.created_at.toISOString()};}
