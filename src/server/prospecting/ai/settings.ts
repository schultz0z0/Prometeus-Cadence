import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../../domain/workspace.ts';
import {defaultAiPolicy,type AiPolicy} from '../../../domain/ai-routing.ts';
import {withWorkspaceTransaction} from '../../db/transaction.ts';
import {AppError} from '../../errors.ts';
import {lockWorkspace} from '../ingestion.ts';
import {hashValue} from '../review.ts';
import {isPlatformAiAdmin,platformAiWorkspace} from './platform.ts';
const schema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().min(0),policy:z.strictObject({mode:z.enum(['auto','conventional-only','hybrid-required']),conventionalProvider:z.enum(['codex-local','chatgpt-oauth','openai','gemini']).nullable(),jevEnabled:z.boolean()})});
export async function requireAiAdmin(c:PoolClient){if(!await isPlatformAiAdmin(c))throw new AppError(403,'Somente a administração da plataforma pode configurar ou testar provedores de IA.','PLATFORM_ADMIN_REQUIRED');}
export async function readAiPolicy(c:PoolClient):Promise<AiPolicy>{return (await c.query('SELECT app.platform_ai_policy($1) AS policy',[platformAiWorkspace()])).rows[0]?.policy??{...defaultAiPolicy};}
export async function saveAiPolicy(p:Principal,input:unknown):Promise<AiPolicy>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Configuração de IA inválida.');const b=parsed.data;
 return withWorkspaceTransaction(p,async c=>{
  await requireAiAdmin(c);await c.query("INSERT INTO app.workspace_meta(workspace_id) VALUES(current_setting('app.workspace_id')) ON CONFLICT DO NOTHING");await lockWorkspace(c);const hash=hashValue({action:'ai.policy.save',policy:b.policy});
  const old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[b.requestId])).rows[0];
  if(old){if(old.user_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result;}
  const current=await readAiPolicy(c);if(current.revision!==b.expectedRevision)throw new AppError(409,'A configuração mudou em outra aba. Revise antes de salvar.','AI_POLICY_CHANGED');
  const next={...b.policy,revision:current.revision+1};
  await c.query("INSERT INTO app.ai_policy(workspace_id,revision,mode,conventional_provider,jev_enabled) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE SET revision=EXCLUDED.revision,mode=EXCLUDED.mode,conventional_provider=EXCLUDED.conventional_provider,jev_enabled=EXCLUDED.jev_enabled",[next.revision,next.mode,next.conventionalProvider,next.jevEnabled]);
  await c.query("INSERT INTO app.command_result VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[b.requestId,p.userId,hash,next]);
  await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),$1,'ai.policy.save')",[p.userId]);return next;
 });
}
