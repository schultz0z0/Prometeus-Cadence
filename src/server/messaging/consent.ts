import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
import {whatsappIdentityScope} from '../../domain/whatsapp-identity.ts';
import {ensurePhoneIdentity} from './replies.ts';
import {normalizeMailAddress} from '../../domain/mail-policy.ts';
const consentSchema=z.strictObject({requestId:z.uuid(),identityId:z.uuid(),purpose:z.enum(['service','campaign','test']),source:z.string().trim().min(1).max(200),occurredAt:z.iso.datetime(),evidence:z.string().trim().min(1).max(4000)});
const suppressionSchema=z.strictObject({requestId:z.uuid(),identityId:z.uuid(),scope:z.enum(['all','service','campaign','test']).default('all'),reason:z.string().trim().min(1).max(500)});
export async function recordConsent(p:Principal,input:unknown):Promise<void>{
 const parsed=consentSchema.safeParse(input);if(!parsed.success||Date.parse(parsed.data.occurredAt)>Date.now())throw new AppError(422,'Informe a origem, finalidade e evidência do consentimento.');const b=parsed.data;
 await withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'consent.record',input:b});if(await priorCommand(c,p,b.requestId,hash))return;
  const row=(await c.query('SELECT id FROM app.channel_identity WHERE id=$1',[b.identityId])).rows[0];if(!row)throw new AppError(404,'Contato não encontrado.');
  await c.query('INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,randomUUID(),b.identityId,b.purpose,b.source,b.occurredAt,b.evidence,p.userId]);
  await completeCommand(c,p,b.requestId,hash,{recorded:true},'consent.record');
 });
}
export async function suppressIdentity(p:Principal,input:unknown):Promise<void>{
 const parsed=suppressionSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Supressão inválida.');const b=parsed.data;
 await withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'contact.suppress',input:b});if(await priorCommand(c,p,b.requestId,hash))return;
  const row=(await c.query('SELECT id FROM app.channel_identity WHERE id=$1',[b.identityId])).rows[0];if(!row)throw new AppError(404,'Contato não encontrado.');
  await c.query('INSERT INTO app.contact_suppression(workspace_id,identity_id,scope,reason,actor_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[p.workspaceId,b.identityId,b.scope,b.reason,p.userId]);
  await completeCommand(c,p,b.requestId,hash,{suppressed:true},'contact.suppress');
 });
}
const leadConsentSchema=z.strictObject({requestId:z.uuid(),leadId:z.string().min(1).max(120),senderId:z.uuid(),phone:z.string().regex(/^\+[1-9]\d{6,14}$/),source:z.string().trim().min(1).max(200),occurredAt:z.iso.datetime(),evidence:z.string().trim().min(1).max(4000)});
export async function recordLeadConsent(p:Principal,input:unknown):Promise<void>{
 const parsed=leadConsentSchema.safeParse(input);if(!parsed.success||Date.parse(parsed.data.occurredAt)>Date.now())throw new AppError(422,'Revise telefone, origem e evidência do consentimento.');const b=parsed.data;
 await withWorkspaceTransaction(p,async c=>{
  await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'lead.consent',input:b});if(await priorCommand(c,p,b.requestId,hash))return;
  const lead=(await c.query('SELECT payload FROM app.lead WHERE id=$1',[b.leadId])).rows[0]?.payload;
  if(!lead)throw new AppError(404,'Lead não encontrado.');const normalized=String(lead.phone??'').trim().startsWith('+')?'+'+String(lead.phone).replace(/\D/g,''):null;
  if(normalized!==b.phone)throw new AppError(409,'O telefone do lead mudou. Revise o consentimento.');
  const sender=(await c.query('SELECT s.*,c.external_account_id,c.credentials_verified FROM app.channel_sender s JOIN app.channel_connection c ON c.workspace_id=s.workspace_id AND c.id=s.connection_id WHERE s.id=$1',[b.senderId])).rows[0];
  if(!sender?.credentials_verified||!sender.external_account_id)throw new AppError(409,'Verifique a conexão antes de registrar o consentimento.');
  const identity=await ensurePhoneIdentity(c,p,whatsappIdentityScope(sender.provider,sender.connection_id,sender.external_account_id),b.phone);
  await c.query('INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,randomUUID(),identity.id,'campaign',b.source,b.occurredAt,b.evidence,p.userId]);
  await completeCommand(c,p,b.requestId,hash,{recorded:true},'lead.consent');
 });
}
const emailConsentSchema=z.strictObject({requestId:z.uuid(),leadId:z.string().min(1).max(120),address:z.string().max(254),purpose:z.enum(['campaign','test']),source:z.string().trim().min(1).max(200),occurredAt:z.iso.datetime(),evidence:z.string().trim().min(1).max(4000)});
export async function recordEmailConsent(p:Principal,input:unknown):Promise<void>{
 const parsed=emailConsentSchema.safeParse(input);if(!parsed.success||Date.parse(parsed.data.occurredAt)>Date.now())throw new AppError(422,'Revise endereço, origem e evidência do consentimento.');
 const b=parsed.data;let address:string;try{address=normalizeMailAddress(b.address);}catch{throw new AppError(422,'Endereço inválido.');}
 await withWorkspaceTransaction(p,async c=>{await requireChannelAdmin(c);await lockWorkspace(c);const hash=commandHash({action:'email.consent',input:{...b,address}});if(await priorCommand(c,p,b.requestId,hash))return;
  const lead=(await c.query('SELECT payload FROM app.lead WHERE id=$1',[b.leadId])).rows[0]?.payload;if(!lead)throw new AppError(404,'Lead não encontrado.');
  let current:string;try{current=normalizeMailAddress(lead.email??'');}catch{throw new AppError(409,'O endereço atual do lead não é válido.');}if(current!==address)throw new AppError(409,'O endereço do lead mudou. Revise o consentimento.');
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'email',$3) ON CONFLICT(workspace_id,scope,external_id) DO NOTHING",[p.workspaceId,randomUUID(),address]);
  const identity=(await c.query("SELECT id FROM app.channel_identity WHERE scope='email' AND external_id=$1",[address])).rows[0];
  await c.query('INSERT INTO app.consent_evidence(workspace_id,id,identity_id,purpose,source,occurred_at,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.workspaceId,randomUUID(),identity.id,b.purpose,b.source,b.occurredAt,b.evidence,p.userId]);
  await completeCommand(c,p,b.requestId,hash,{recorded:true},'email.consent');
 });
}
