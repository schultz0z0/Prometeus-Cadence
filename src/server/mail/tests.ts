import 'server-only';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {MailSend} from '../../domain/mail.ts';
import type {MessageView,Review} from '../../domain/whatsapp.ts';
import {normalizeMailAddress,validateRenderedMail,renderMailBody} from '../../domain/mail-policy.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {mailboxRow} from './repository.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
import {encryptCredential,decryptCredential} from '../channels/crypto.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {createMailboxChallenge} from './providers/smtp-imap.ts';
import {AppError} from '../errors.ts';
import {messageView} from '../messaging/repository.ts';
const common={messageId:z.uuid(),expectedRevision:z.number().int().min(1)},content=z.strictObject({kind:z.literal('email'),subject:z.string().max(200),text:z.string().max(65536),signature:z.string().max(4096)});
const proofSchema=z.strictObject({...common,mode:z.literal('proof')}),testSchema=z.strictObject({...common,mode:z.literal('test'),to:z.string().max(254),content,consent:z.strictObject({source:z.string().trim().min(1).max(200),occurredAt:z.iso.datetime(),evidence:z.string().trim().min(1).max(4000)})});
const schema=z.discriminatedUnion('mode',[proofSchema,testSchema]);
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
function aad(p:Principal,id:string,revision:number){return {workspaceId:p.workspaceId,connectionId:'mail-test:'+p.userId+':'+id,provider:'smtp-imap' as const,revision};}
function material(p:Principal,id:string,input:z.infer<typeof schema>){const challenge=createMailboxChallenge(id,input.expectedRevision);return Buffer.from(JSON.stringify(encryptCredential({nonce:challenge.nonce},aad(p,id,input.expectedRevision)))).toString('base64url');}
async function state(c:PoolClient,p:Principal,id:string,input:z.infer<typeof schema>,opaque:string){
 await requireChannelAdmin(c);const box=await mailboxRow(c,id),sender=(await c.query('SELECT * FROM app.channel_sender WHERE connection_id=$1',[id])).rows[0];if(Number(box.revision)!==input.expectedRevision)throw new AppError(409,'A caixa mudou.');
 let nonce:string;try{nonce=decryptCredential(JSON.parse(Buffer.from(opaque,'base64url').toString()),aad(p,id,input.expectedRevision)).nonce;if(!/^[A-Za-z0-9_-]{43}$/.test(nonce))throw Error();}catch{throw new AppError(409,'Gere uma nova revisão do teste.');}
 const proof=input.mode==='proof',limits=(await c.query('SELECT * FROM app.messaging_limits')).rows[0],channel=(await c.query("SELECT * FROM app.messaging_channel_limits WHERE channel='EMAIL'")).rows[0],blockers:string[]=[];
 if(!sender||!limits||!channel||!sender.daily_limit)blockers.push('EXPLICIT_LIMITS_REQUIRED');
 if(proof){if(box.provider!=='smtp-imap'||!box.send_verified||!box.read_verified||!box.baseline_at||box.sync_state!=='ready'||box.sync_gap||box.state!=='verifying')blockers.push('MAILBOX_BASELINE_REQUIRED');}
 else if(box.state!=='ready'||!sender?.ready)blockers.push('SENDER_UNAVAILABLE');
 let to='';try{to=normalizeMailAddress(proof?box.address:input.to);}catch{blockers.push('VALID_EMAIL_REQUIRED');}
 const body=proof?{kind:'email' as const,subject:'Confirmação da sua caixa — Prometeus Cadence',text:'Confirmação da caixa Prometeus Cadence\n\n'+nonce+'\n\nEsta mensagem confirma somente a conexão da própria caixa.',signature:box.signature}:input.content;
 blockers.push(...validateRenderedMail(body));if(body.signature!==box.signature)blockers.push('MAIL_SIGNATURE_CHANGED');
 if(!proof&&Date.parse(input.consent.occurredAt)>Date.now())blockers.push('INVALID_CONSENT_TIME');
 const identity=(await c.query("SELECT * FROM app.channel_identity WHERE scope='email' AND external_id=$1",[to])).rows[0],suppressions=identity?(await c.query("SELECT scope FROM app.contact_suppression WHERE identity_id=$1 AND scope IN('all','test') ORDER BY scope",[identity.id])).rows:[];if(suppressions.length)blockers.push('CONTACT_SUPPRESSED');
 const snapshot:MailSend={connectionId:id,connectionRevision:Number(box.revision),senderId:sender?.id??'',address:box.address??'',to,content:body,rfcMessageId:'<'+input.messageId+'@'+(box.address?.split('@')[1]??'invalid')+'>',thread:null,purpose:'test',unsubscribeUrl:null};
 const nonceHash=proof?createHash('sha256').update(JSON.stringify([id,input.expectedRevision,nonce])).digest('hex'):null;
 const preview=body.subject+'\n\n'+renderMailBody(body);
 return {snapshot,blockers,preview,nonceHash,sender,identity,proof:{workspaceId:p.workspaceId,actorId:p.userId,id,input,snapshot,sender:sender??null,mailbox:{revision:box.revision,state:box.state,signature:box.signature,baselineAt:box.baseline_at,read:box.read_verified,send:box.send_verified,syncState:box.sync_state,gap:box.sync_gap},limits,channel,identity:identity??null,suppressions}};
}
export async function prepareMailTest(p:Principal,id:string,input:unknown):Promise<Review<MailSend>&{preview:string;material:string}>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise o destinatário, a mensagem e a autorização do teste.');const opaque=material(p,id,parsed.data);
 return withWorkspaceTransaction(p,async c=>{const value=await state(c,p,id,parsed.data,opaque);return {material:opaque,token:createReviewToken(value.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),snapshot:value.snapshot,preview:value.preview,blockers:value.blockers};});
}
export async function confirmMailTest(p:Principal,id:string,input:unknown):Promise<MessageView>{
 const confirmations={requestId:z.uuid(),reviewToken:z.string().max(8192),material:z.string().max(32768)},parsed=z.discriminatedUnion('mode',[proofSchema.extend(confirmations),testSchema.extend(confirmations)]).safeParse(input);
 if(!parsed.success)throw new AppError(422,'Confirmação do teste inválida.');const {requestId,reviewToken,material:opaque,...body}=parsed.data;
 return withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'mail.test',id,input:{...body,material:opaque}}),old=await priorCommand<MessageView>(c,p,requestId,hash);if(old)return old;
  const value=await state(c,p,id,body,opaque);verifyReviewToken(reviewToken,value.proof,secret());if(value.blockers.length)throw new AppError(409,'Teste bloqueado: '+value.blockers[0]);
  await c.query('SELECT app.enqueue_mail_test($1,$2,$3,$4,$5,$6)',[body.messageId,{...value.snapshot,channel:'EMAIL'},{senderRevision:Number(value.sender.revision),replyEpoch:Number(value.identity?.reply_epoch??0)},value.preview,value.nonceHash,body.mode==='test'?body.consent:null]);
  const result=messageView((await c.query('SELECT * FROM app.channel_message WHERE id=$1',[body.messageId])).rows[0]);await completeCommand(c,p,requestId,hash,result,'mail.test');return result;
 });
}
