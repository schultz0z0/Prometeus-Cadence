import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Lead} from '../../domain/model.ts';
import type {MessageView,PreparedSend,Review,TemplateView,OutboundContent} from '../../domain/whatsapp.ts';
import {evaluateSendPolicy} from '../../domain/whatsapp-policy.ts';
import {renderMessage} from '../../domain/cadence.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {createReviewToken,verifyReviewToken,hashValue} from '../prospecting/review.ts';
import {AppError} from '../errors.ts';
import {requireChannelAdmin,connectionRow,senderView,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
import {channelCallbackUrl} from '../channels/webhook-auth.ts';
import {contentSchema} from '../channels/schemas.ts';
import {conversationRow,messageView} from './repository.ts';
export const replySchema=z.strictObject({content:contentSchema});
const consentProof=z.strictObject({source:z.string().trim().min(1).max(200),occurredAt:z.iso.datetime(),evidence:z.string().trim().min(1).max(4000)});
export const channelTestSchema=z.strictObject({senderId:z.uuid(),phone:z.string().regex(/^\+[1-9]\d{6,14}$/),content:contentSchema,consent:consentProof.optional()});
const confirmation={requestId:z.uuid(),reviewToken:z.string().max(8192)};
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
async function requireReplyMember(c:PoolClient){if(!(await c.query('SELECT app.current_role() AS role')).rows[0]?.role)throw new AppError(403,'Seu acesso ao workspace foi removido.');}
export async function ensurePhoneIdentity(c:PoolClient,p:Principal,scope:string,phone:string){
 const exact=(await c.query('SELECT * FROM app.channel_identity WHERE scope=$1 AND (external_id=$2 OR phone=$3) ORDER BY id LIMIT 2',[scope,phone.slice(1),phone])).rows;
 if(exact.length>1)throw new AppError(409,'Há mais de uma identidade para esse telefone. Revise o vínculo do contato.');if(exact[0])return exact[0];
 const id=randomUUID();await c.query('INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,phone) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,scope,external_id) DO NOTHING',[p.workspaceId,id,scope,phone.slice(1),phone]);
 return (await c.query('SELECT * FROM app.channel_identity WHERE scope=$1 AND external_id=$2',[scope,phone.slice(1)])).rows[0];
}
export async function replyState(c:PoolClient,p:Principal,target:{conversationId:string}|{connectionId:string},input:z.infer<typeof replySchema>|z.infer<typeof channelTestSchema>){
 const test='connectionId'in target;if(test)await requireChannelAdmin(c);else await requireReplyMember(c);
 const conversation=!test?await conversationRow(c,target.conversationId):null;
 const senderId=test?(input as z.infer<typeof channelTestSchema>).senderId:conversation.sender_id;
 const row=(await c.query('SELECT * FROM app.channel_sender WHERE id=$1',[senderId])).rows[0];if(!row)throw new AppError(404,'Remetente não encontrado.');
 const sender=senderView(row),conn=await connectionRow(c,sender.connectionId);if(test&&conn.id!==target.connectionId)throw new AppError(404,'Remetente não pertence à conexão.');
 const testInput=test?input as z.infer<typeof channelTestSchema>:null,scope=conn.provider+':'+conn.external_account_id;
 const identities=test?(await c.query('SELECT * FROM app.channel_identity WHERE scope=$1 AND (external_id=$2 OR phone=$3) ORDER BY id LIMIT 2',[scope,testInput!.phone.slice(1),testInput!.phone])).rows:[];
 if(identities.length>1)throw new AppError(409,'Revise as identidades desse telefone antes do teste.');
 const identity=test?identities[0]??null:(await c.query('SELECT * FROM app.channel_identity WHERE id=$1',[conversation.identity_id])).rows[0];
 const lead=conversation?.lead_id?(await c.query('SELECT payload FROM app.lead WHERE id=$1',[conversation.lead_id])).rows[0]?.payload as Lead:undefined;
 let content:OutboundContent=input.content;
 if(lead)content=content.kind==='text'?{kind:'text',text:renderMessage(content.text,lead).text}:{...content,variables:Object.fromEntries(Object.entries(content.variables).map(([k,v])=>[k,renderMessage(v,lead).text]))};
 const template=content.kind==='template'?(await c.query('SELECT payload FROM app.channel_remote_template WHERE connection_id=$1 AND id=$2',[conn.id,content.templateId])).rows[0]?.payload as TemplateView??null:null;
 const purpose=test?'test':'service',consents=identity?(await c.query('SELECT id FROM app.consent_evidence WHERE identity_id=$1 AND purpose=$2 AND occurred_at<=clock_timestamp() ORDER BY id',[identity.id,purpose])).rows:[];
 const suppressions=identity?(await c.query("SELECT scope FROM app.contact_suppression WHERE identity_id=$1 AND scope IN('all',$2) ORDER BY scope",[identity.id,purpose])).rows:[];
 const declared=testInput?.consent,declaredValid=!!declared&&Date.parse(declared.occurredAt)<=Date.now();
 const limits=(await c.query('SELECT * FROM app.messaging_limits')).rows[0],currentNow=new Date().toISOString();
 const eligibility=evaluateSendPolicy({now:currentNow,lastInboundAt:identity?.last_inbound_at?.toISOString()??null,purpose,hasOptIn:consents.length>0||declaredValid,suppressed:suppressions.length>0,senderReady:sender.ready&&conn.state==='ready'&&(!conn.token_expires_at||conn.token_expires_at.getTime()>Date.now()),content,template});
 const blockers=[...eligibility.blockers];if(!limits||!sender.dailyLimit)blockers.push('EXPLICIT_LIMITS_REQUIRED');
 try{channelCallbackUrl(conn.provider,conn.public_id);}catch{blockers.push('PUBLIC_HTTPS_REQUIRED');}
 if(declared&&!declaredValid)blockers.push('INVALID_CONSENT_TIME');
 const identityView=identity?{scope:identity.scope,externalId:identity.external_id,phone:identity.phone}:{scope,externalId:testInput!.phone.slice(1),phone:testInput!.phone};
 const snapshot:PreparedSend={connectionId:conn.id,connectionRevision:Number(conn.revision),senderId:sender.id,identity:identityView,content,purpose};
 let preview=content.kind==='text'?content.text:template?template.components.map(part=>part.text.replace(/\{\{\s*(\w+)\s*\}\}/g,(_match,key:string)=>content.kind==='template'?content.variables[part.type+'.'+key]??'{{'+key+'}}':'')).join('\n'):'Template indisponível';
 if(preview.length>4096)blockers.push('PREVIEW_TOO_LARGE');
 const proof={workspaceId:p.workspaceId,actorId:p.userId,target,input,snapshot,senderRevision:sender.revision,identity:identity??null,leadHash:lead?hashValue(lead):null,consents,suppressions,templateHash:template?.hash??null,limits:limits??null};
 return {snapshot,blockers,proof,sender,conn,identity,conversation,preview,template,declared,lead};
}
async function prepare(p:Principal,target:{conversationId:string}|{connectionId:string},input:unknown):Promise<Review<PreparedSend>&{preview:string}>{
 const parsed=('connectionId'in target?channelTestSchema:replySchema).safeParse(input);if(!parsed.success)throw new AppError(422,'Revise destinatário, conteúdo e consentimento.');
 return withWorkspaceTransaction(p,async c=>{const state=await replyState(c,p,target,parsed.data);return {token:createReviewToken(state.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),snapshot:state.snapshot,blockers:state.blockers,preview:state.preview};});
}
async function confirm(p:Principal,target:{conversationId:string}|{connectionId:string},input:unknown):Promise<MessageView>{
 const parsed=('connectionId'in target?channelTestSchema.extend(confirmation):replySchema.extend(confirmation)).safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação da mensagem inválida.');const {requestId,reviewToken,...body}=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  if('connectionId'in target)await requireChannelAdmin(c);else await requireReplyMember(c);await lockWorkspace(c);
  const hash=commandHash({action:'message.confirm',target,input:body}),old=await priorCommand<MessageView>(c,p,requestId,hash);if(old)return old;
  const state=await replyState(c,p,target,body);verifyReviewToken(reviewToken,state.proof,secret());if(state.blockers.length)throw new AppError(409,'Envio bloqueado: '+state.blockers[0]);
  const identity=state.identity??await ensurePhoneIdentity(c,p,state.snapshot.identity.scope,state.snapshot.identity.phone!);
  if(state.declared)await c.query('INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,randomUUID(),identity.id,'test',state.declared.source,state.declared.occurredAt,state.declared.evidence,p.userId]);
  let conversation=state.conversation;
  if(!conversation){
   await c.query('INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,sender_id,identity_id) DO NOTHING',[p.workspaceId,randomUUID(),state.conn.id,state.sender.id,identity.id]);
   conversation=(await c.query('SELECT * FROM app.channel_conversation WHERE sender_id=$1 AND identity_id=$2',[state.sender.id,identity.id])).rows[0];
  }
  const proof={senderRevision:state.sender.revision,replyEpoch:Number(identity.reply_epoch),templateHash:state.template?.hash??null,leadId:state.lead?.id??null,leadHash:state.lead?hashValue(state.lead):null};
  const id=(await c.query('SELECT app.enqueue_reviewed_message($1,$2,$3,$4,$5,$6) AS id',[state.sender.id,identity.id,conversation.id,state.snapshot,proof,state.preview])).rows[0].id;
  const result=messageView((await c.query('SELECT * FROM app.channel_message WHERE id=$1',[id])).rows[0]);await completeCommand(c,p,requestId,hash,result,'message.confirm');return result;
 });
}
export const prepareReply=(p:Principal,conversationId:string,input:unknown)=>prepare(p,{conversationId},input);
export const confirmReply=(p:Principal,conversationId:string,input:unknown)=>confirm(p,{conversationId},input);
export const prepareChannelTest=(p:Principal,connectionId:string,input:unknown)=>prepare(p,{connectionId},input);
export const confirmChannelTest=(p:Principal,connectionId:string,input:unknown)=>confirm(p,{connectionId},input);
