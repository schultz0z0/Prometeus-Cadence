import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {Review,MessageView} from '../../domain/whatsapp.ts';
import type {ReconciliationSnapshot} from '../../domain/cadence-runtime.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand,senderView} from '../channels/repository.ts';
import {decryptCredential} from '../channels/crypto.ts';
import {providerAdapter} from '../channels/connections.ts';
import {messageView} from './repository.ts';
import {mailReconciliationState} from './email-reconciliation.ts';
const schema=z.strictObject({resolution:z.enum(['accepted','not_accepted']),remoteId:z.string().min(1).max(512).nullable(),evidence:z.string().trim().min(40).max(4000),reference:z.url().max(2000),proofKind:z.literal('provider-log'),verifiedByUser:z.literal(true)});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
async function state(p:Principal,messageId:string,input:z.infer<typeof schema>){
 const ctx=await withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);const row=(await c.query('SELECT state FROM app.message_outbox WHERE message_id=$1',[messageId])).rows[0];if(!row)throw new AppError(404,'Mensagem não encontrada.');if(row.state!=='uncertain')throw new AppError(409,'A mensagem não está mais incerta.');
  return (await c.query('SELECT app.inspect_uncertain_message($1) AS context',[messageId])).rows[0].context;
 });
 if(ctx.connection.channel==='EMAIL')return mailReconciliationState(p,ctx,messageId,input);
 if(ctx.connection.provider==='openwa'){
  if(input.resolution!=='accepted'||!input.remoteId)throw new AppError(409,'Uma busca vazia não comprova que a mensagem não foi enviada. O resultado continua incerto.','OPENWA_NON_ACCEPTANCE_UNPROVEN');
  const url=new URL(input.reference),appOrigin=new URL(process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210').origin;
  if(url.origin!==appOrigin||url.pathname!=='/messages/whatsapp'||url.username||url.password||url.hash)throw new AppError(422,'Use o endereço do inbox WhatsApp deste aplicativo como referência.');
  const record=ctx.credential,config={provider:ctx.connection.provider,connectionId:ctx.connection.id,revision:Number(record.revision),identifiers:record.identifiers,credentials:decryptCredential(record.envelope,{workspaceId:p.workspaceId,connectionId:ctx.connection.id,provider:'openwa',revision:Number(record.revision)}),sender:senderView(ctx.sender),templates:[]};
  const remote=await providerAdapter('openwa').lookupMessage(config,input.remoteId);
  if(remote?.kind!=='accepted'||remote.evidence?.accountId!==record.verified_account_id||remote.evidence?.from!==ctx.sender.address||remote.evidence?.to!==ctx.outbox.prepared_send.identity.externalId)throw new AppError(409,'A API não comprovou a mensagem desta sessão, remetente e destinatário. O resultado continua incerto.');
  const snapshot:ReconciliationSnapshot={...input,messageId,attemptId:ctx.attempt.id,verification:'provider-api',remoteStatus:remote.evidence?.status};
  return {ctx,snapshot,proof:{workspaceId:p.workspaceId,actorId:p.userId,snapshot,fence:Number(ctx.attempt.fence),attemptOutcome:ctx.attempt.outcome}};
 }
 const url=new URL(input.reference),hosts=ctx.connection.provider==='meta'?['business.facebook.com','developers.facebook.com']:['console.twilio.com'];
 if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.includes(url.hostname))throw new AppError(422,'Informe uma referência do painel do próprio provedor.');
 if((input.resolution==='accepted'&&!input.remoteId)||(input.resolution==='not_accepted'&&input.remoteId))throw new AppError(422,'Revise o resultado e o identificador remoto.');
 let verification:ReconciliationSnapshot['verification']='administrator-evidence';
 if(input.resolution==='accepted'&&ctx.connection.provider==='twilio'){
  const record=ctx.credential,config={provider:ctx.connection.provider,connectionId:ctx.connection.id,revision:Number(record.revision),identifiers:record.identifiers,credentials:decryptCredential(record.envelope,{workspaceId:p.workspaceId,connectionId:ctx.connection.id,provider:ctx.connection.provider,revision:Number(record.revision)}),sender:senderView(ctx.sender),templates:[]};
  const remote=await providerAdapter('twilio').lookupMessage(config,input.remoteId!);
  if(remote?.kind!=='accepted'||remote.evidence?.accountId!==record.verified_account_id||remote.evidence?.from!=='whatsapp:'+ctx.sender.address||remote.evidence?.to!=='whatsapp:'+ctx.outbox.prepared_send.identity.phone)throw new AppError(409,'O registro remoto não corresponde ao remetente e destinatário desta tentativa.');verification='provider-api';
 }
 const snapshot:ReconciliationSnapshot={...input,messageId,attemptId:ctx.attempt.id,verification};
 return {ctx,snapshot,proof:{workspaceId:p.workspaceId,actorId:p.userId,snapshot,fence:Number(ctx.attempt.fence),attemptOutcome:ctx.attempt.outcome}};
}
export async function prepareReconciliation(p:Principal,messageId:string,input:unknown):Promise<Review<ReconciliationSnapshot>>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Registre a evidência e confirme sua verificação no provedor.');const value=await state(p,messageId,parsed.data);
 return {token:createReviewToken(value.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),snapshot:value.snapshot,blockers:[]};
}
export async function confirmReconciliation(p:Principal,input:unknown):Promise<MessageView>{
 const parsed=schema.extend({messageId:z.uuid(),requestId:z.uuid(),reviewToken:z.string().max(8192)}).safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação da evidência inválida.');const {messageId,requestId,reviewToken,...body}=parsed.data,hash=commandHash({action:'message.reconcile',messageId,input:body});
 const cached=await withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);return priorCommand<MessageView>(c,p,requestId,hash);});if(cached)return cached;
 const value=await state(p,messageId,body);verifyReviewToken(reviewToken,value.proof,secret());
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const old=await priorCommand<MessageView>(c,p,requestId,hash);if(old)return old;
  await c.query('SELECT app.admin_reconcile_message($1,$2,$3,$4,$5)',[messageId,value.snapshot.attemptId,body.resolution,body.remoteId,value.snapshot]);
  const result=messageView((await c.query('SELECT * FROM app.channel_message WHERE id=$1',[messageId])).rows[0]);await completeCommand(c,p,requestId,hash,result,'message.reconcile');return result;
 });
}
