import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {MailSend} from '../../domain/mail.ts';
import type {Review,MessageView} from '../../domain/whatsapp.ts';
import {evaluateMailPolicy,validateMailContent,normalizeMailAddress} from '../../domain/mail-policy.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {createReviewToken,verifyReviewToken,hashValue} from '../prospecting/review.ts';
import {commandHash,priorCommand,completeCommand,connectionRow} from '../channels/repository.ts';
import {AppError} from '../errors.ts';
import {messageView} from './repository.ts';
const schema=z.strictObject({messageId:z.uuid(),content:z.strictObject({kind:z.literal('email'),subject:z.string().max(200),text:z.string().max(65536),signature:z.string().max(4096)})});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
const subjectKey=(value:string)=>value.replace(/^(?:(?:re|fw|fwd):\s*)+/i,'').trim().toLowerCase();
async function state(c:PoolClient,p:Principal,conversationId:string,input:z.infer<typeof schema>){
 if(!(await c.query('SELECT app.current_role() AS role')).rows[0]?.role)throw new AppError(403,'Acesso removido.');
 const conv=(await c.query("SELECT * FROM app.channel_conversation WHERE id=$1 AND channel='EMAIL'",[conversationId])).rows[0];if(!conv)throw new AppError(404,'Conversa de e-mail não encontrada.');
 const thread=(await c.query('SELECT * FROM app.email_thread WHERE conversation_id=$1',[conversationId])).rows[0],sender=(await c.query('SELECT * FROM app.channel_sender WHERE id=$1',[conv.sender_id])).rows[0],conn=await connectionRow(c,conv.connection_id),box=(await c.query('SELECT * FROM app.email_mailbox WHERE id=$1',[conn.id])).rows[0];
 const identity=(await c.query('SELECT * FROM app.channel_identity WHERE id=$1',[conv.identity_id])).rows[0];
 const inbound=(await c.query("SELECT em.*,cm.occurred_at FROM app.email_message em JOIN app.channel_message cm ON cm.workspace_id=em.workspace_id AND cm.id=em.message_id WHERE cm.conversation_id=$1 AND cm.direction='inbound' AND em.classification='human' AND NOT em.truncated ORDER BY cm.message_order DESC LIMIT 1",[conversationId])).rows[0];
 const suppressions=(await c.query("SELECT scope FROM app.contact_suppression WHERE identity_id=$1 AND scope IN('all','service') ORDER BY scope",[identity.id])).rows;
 const limits=(await c.query('SELECT * FROM app.messaging_limits')).rows[0],channelLimit=(await c.query("SELECT * FROM app.messaging_channel_limits WHERE channel='EMAIL'")).rows[0];
 const blockers=validateMailContent(input.content);let to='';try{to=normalizeMailAddress(identity.external_id);}catch{blockers.push('VALID_EMAIL_REQUIRED');}
 if(thread.needs_review)blockers.push('EMAIL_THREAD_REVIEW_REQUIRED');
 if(input.content.signature!==box.signature)blockers.push('MAIL_SIGNATURE_CHANGED');
 if(subjectKey(input.content.subject)!==subjectKey(thread.subject)&&subjectKey(input.content.subject)!==subjectKey(inbound?.subject??''))blockers.push('EMAIL_SUBJECT_THREAD_MISMATCH');
 if(!inbound?.rfc_message_id)blockers.push('EMAIL_REPLY_REFERENCE_REQUIRED');
 if(inbound&&inbound.from_address!==to)blockers.push('EMAIL_REPLY_IDENTITY_CHANGED');
 if(!limits||!channelLimit||!sender.daily_limit)blockers.push('EXPLICIT_LIMITS_REQUIRED');
 const policy=evaluateMailPolicy({now:new Date().toISOString(),purpose:'service',authorized:false,suppressed:suppressions.length>0,hasInbound:!!inbound,sendReady:sender.ready&&conn.state==='ready'&&box.state==='ready'&&!box.bounce_paused,syncState:box.sync_state,lastSyncedAt:box.last_synced_at?.toISOString()??null});blockers.push(...policy.blockers);
 const refs=[...(inbound?.reference_ids??[]),...(inbound?.rfc_message_id?[inbound.rfc_message_id]:[])].filter((v,i,arr)=>arr.indexOf(v)===i).slice(-100);
 const snapshot:MailSend={connectionId:conn.id,connectionRevision:Number(conn.revision),senderId:sender.id,address:sender.address,to,content:input.content,rfcMessageId:'<'+input.messageId+'@'+sender.address.split('@')[1]+'>',thread:{remoteThreadId:thread.remote_thread_id,inReplyTo:inbound?.rfc_message_id??null,references:refs},purpose:'service',unsubscribeUrl:null};
 const preview=input.content.subject+'\n\n'+input.content.text+(input.content.signature?'\n\n'+input.content.signature:'');if(Buffer.byteLength(preview)>65536)blockers.push('EMAIL_TEXT_INVALID');
 return {snapshot,preview,blockers:[...new Set(blockers)],proof:{workspaceId:p.workspaceId,actorId:p.userId,conversationId,input,snapshot,thread,identity,inbound,senderRevision:Number(sender.revision),mailbox:{state:box.state,signature:box.signature,bouncePaused:box.bounce_paused},suppressions,limits,channelLimit},sender,identity};
}
export async function prepareMailReply(p:Principal,conversationId:string,input:unknown):Promise<Review<MailSend>&{preview:string}>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise assunto, mensagem e identificação do rascunho.');
 return withWorkspaceTransaction(p,async c=>{const value=await state(c,p,conversationId,parsed.data);return {snapshot:value.snapshot,preview:value.preview,blockers:value.blockers,token:createReviewToken(value.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString()};});
}
export async function confirmMailReply(p:Principal,conversationId:string,input:unknown):Promise<MessageView>{
 const parsed=schema.extend({requestId:z.uuid(),reviewToken:z.string().max(8192)}).safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação de e-mail inválida.');const {requestId,reviewToken,...body}=parsed.data;
 return withWorkspaceTransaction(p,async c=>{await lockWorkspace(c);const hash=commandHash({action:'mail.reply',conversationId,body}),old=await priorCommand<MessageView>(c,p,requestId,hash);if(old)return old;
  const value=await state(c,p,conversationId,body);verifyReviewToken(reviewToken,value.proof,secret());if(value.blockers.length)throw new AppError(409,'Envio bloqueado: '+value.blockers[0]);
  const proof={senderRevision:Number(value.sender.revision),replyEpoch:Number(value.identity.reply_epoch),contentHash:hashValue(value.snapshot.content)};
  await c.query('SELECT app.enqueue_reviewed_mail($1,$2,$3,$4,$5)',[body.messageId,conversationId,{...value.snapshot,channel:'EMAIL'},proof,value.preview]);
  const result=messageView((await c.query('SELECT * FROM app.channel_message WHERE id=$1',[body.messageId])).rows[0]);await completeCommand(c,p,requestId,hash,result,'mail.reply');return result;
 });
}
