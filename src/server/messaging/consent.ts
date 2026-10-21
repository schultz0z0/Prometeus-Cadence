import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {requireChannelAdmin,commandHash,priorCommand,completeCommand} from '../channels/repository.ts';
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
