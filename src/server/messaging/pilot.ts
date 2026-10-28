import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {PilotAdapters,PilotResult} from '../../domain/channel-evidence.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {AppError} from '../errors.ts';
import {messageDeliveryEvidence} from './delivery-evidence.ts';
const fields={connectionId:z.uuid(),messageId:z.uuid(),ownedRecipient:z.string().trim().min(3).max(254)};
const prepareSchema=z.strictObject(fields),confirmSchema=z.strictObject({...fields,requestId:z.uuid(),reviewToken:z.string().max(8192)});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
async function state(c:PoolClient,p:Principal,input:z.infer<typeof prepareSchema>){
 await requireChannelAdmin(c);
 const row=(await c.query(`SELECT m.*,c.revision AS connection_revision,c.state AS connection_state,i.external_id,i.phone,v.lead_id
  FROM app.channel_message m JOIN app.channel_connection c ON c.workspace_id=m.workspace_id AND c.id=m.connection_id
  JOIN app.channel_identity i ON i.workspace_id=m.workspace_id AND i.id=m.identity_id
  JOIN app.channel_conversation v ON v.workspace_id=m.workspace_id AND v.id=m.conversation_id
  WHERE m.id=$1 AND c.id=$2 AND m.direction='outbound' AND m.purpose='test'`,[input.messageId,input.connectionId])).rows[0];
 if(!row)throw new AppError(404,'Teste desse canal não encontrado.');
 if(row.connection_state!=='ready'||![row.external_id,row.phone].includes(input.ownedRecipient))throw new AppError(409,'A conexão ou o destinatário mudou. Revise o teste.','PILOT_CHANGED');
 return {row,proof:{kind:'channel.pilot',workspaceId:p.workspaceId,actorId:p.userId,...input,revision:Number(row.connection_revision)}};
}
export async function prepareChannelPilot(p:Principal,input:unknown){
 const parsed=prepareSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise a mensagem e o destinatário do teste.');
 return withWorkspaceTransaction(p,async c=>{const s=await state(c,p,parsed.data);return {token:createReviewToken(s.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),delivery:messageDeliveryEvidence(s.row)!};});
}
// Optional observation refreshes existing authenticated ingress. Its return value is never receipt authority.
export async function runChannelPilot(p:Principal,input:unknown,deps:Partial<PilotAdapters>={}):Promise<PilotResult>{
 const parsed=confirmSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação de observação inválida.');
 const {reviewToken,requestId,...body}=parsed.data,hash=commandHash({action:'channel.pilot',input:body});
 const initial=await withWorkspaceTransaction(p,async c=>{const s=await state(c,p,body);verifyReviewToken(reviewToken,s.proof,secret());return {...s,prior:await priorCommand<PilotResult>(c,p,requestId,hash)};});
 if(initial.prior)return initial.prior;
 if(initial.row.remote_id&&deps.observe)await deps.observe(initial.row.remote_id);
 return withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const s=await state(c,p,body);verifyReviewToken(reviewToken,s.proof,secret());
  const prior=await priorCommand<PilotResult>(c,p,requestId,hash);if(prior)return prior;
  const inbound=(await c.query(`SELECT m.id FROM app.channel_message m LEFT JOIN app.email_message e ON e.workspace_id=m.workspace_id AND e.message_id=m.id
   WHERE m.conversation_id=$1 AND m.direction='inbound' AND m.message_order>$2 AND $3::timestamptz IS NOT NULL AND m.occurred_at>=$3
    AND (m.channel='WHATSAPP' OR (e.classification='human' AND NOT e.truncated AND NOT EXISTS(SELECT 1 FROM app.email_thread t WHERE t.workspace_id=e.workspace_id AND t.id=e.thread_id AND t.needs_review)))
   ORDER BY m.message_order LIMIT 1`,[s.row.conversation_id,s.row.message_order,s.row.accepted_at])).rows[0];
  const stopped=!!inbound&&Boolean((await c.query(`SELECT 1 FROM app.cadence_enrollment e
   LEFT JOIN app.cadence_enrollment_channel ec ON ec.workspace_id=e.workspace_id AND ec.enrollment_id=e.id
   JOIN app.channel_identity i ON i.workspace_id=e.workspace_id AND i.id=$1
   WHERE (e.identity_id=$1 OR ec.identity_id=$1) AND e.state='stopped' AND e.stop_reason='reply' AND i.last_reply_at>=$2 LIMIT 1`,[s.row.identity_id,s.row.created_at])).rowCount);
  const result:PilotResult={outboundId:s.row.id,inboundId:inbound?.id??null,delivery:messageDeliveryEvidence(s.row)!,stoppedEnrollment:stopped};
  await c.query('SELECT app.record_channel_pilot($1,$2,$3,$4,$5)',[requestId,body.connectionId,body.messageId,Number(s.row.connection_revision),body.ownedRecipient]);
  await completeCommand(c,p,requestId,hash,result,'channel.pilot');return result;
 });
}
