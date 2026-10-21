import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {AutomationActionReview,AutomationAuthorization,AutomationRuntime,AutomationOccurrence} from '../../domain/automation-runtime.ts';
import {aiRouteView} from '../../domain/ai-routing.ts';
import {nextOccurrence} from '../../domain/schedule.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {hashValue,createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {definitionInTransaction,runtimeInTransaction,runtimeView} from './repository.ts';
import {automationAuthorizationState} from './state.ts';
import {dispatchManualOccurrence} from './dispatch.ts';
import {assignEligibleLeads} from './assignments.ts';
const schema=z.strictObject({action:z.enum(['activate','run-once']),expectedRevision:z.number().int().min(1)}),confirmSchema=schema.extend({requestId:z.uuid(),reviewToken:z.string().min(1).max(8192)}),pauseSchema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().min(1)});
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
async function admin(c:PoolClient,p:Principal){requirePermission({...p,role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'workspace.settings');}
async function state(c:PoolClient,p:Principal,id:string,body:z.infer<typeof schema>){
 const definition=await definitionInTransaction(c,id),runtime=await runtimeInTransaction(c,id),analysis=await automationAuthorizationState(c,p,definition);
 if(Number(runtime.revision)!==body.expectedRevision)throw new AppError(409,'A automação mudou. Revise novamente.');
 if(body.action==='activate'&&definition.schedule&&!nextOccurrence(definition.schedule,new Date().toISOString()))analysis.blockers.push('A programação não tem uma ocorrência futura.');
 return {...analysis,definition,runtime,proof:{userId:p.userId,workspaceId:p.workspaceId,input:{automationId:id,...body},revision:Number(runtime.revision),profileVersion:hashValue({definition,draft:analysis.draft})}};
}
export async function prepareAutomationAction(p:Principal,id:string,input:unknown):Promise<AutomationActionReview>{
 const parsed=schema.safeParse(input);if(!parsed.success)throw new AppError(422,'Ação de automação inválida.');
 return withWorkspaceTransaction(p,async c=>{await admin(c,p);const s=await state(c,p,id,parsed.data),now=Date.now();return {token:createReviewToken(s.proof,secret(),now),expiresAt:new Date(now+600000).toISOString(),action:parsed.data.action,expectedRevision:parsed.data.expectedRevision,definition:s.definition,scope:{source:s.definition.payload.source,listId:s.definition.payload.listId,filters:s.input?.kind==='generation'?s.input.filters:s.definition.payload.filters,...(s.input?.kind==='generation'?{dedupScope:s.input.dedupScope}:{}),modules:s.draft.modules,criteria:s.definition.qualificationCriteria,dependsOnAutomationId:s.definition.dependsOnAutomationId,contextVersion:s.draft.context?.version??0,productVersion:s.draft.product?.version??null,productId:s.draft.productId},usage:s.usage,aiRoute:s.draft.aiRoute?aiRouteView(s.draft.aiRoute):null,effects:[`Até ${s.definition.payload.dailyLimit} empresas por ocorrência.`,parsed.data.action==='activate'?'Autorizar próximas ocorrências desta revisão, dentro dos limites.':'Executar uma vez; a recorrência e seu próximo horário não mudam.','Qualificações ficam pendentes de revisão. Nenhuma mensagem será enviada.'],blockers:s.blockers};});
}
export async function confirmAutomationAction(p:Principal,id:string,input:unknown):Promise<AutomationRuntime|AutomationOccurrence>{
 const parsed=confirmSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação inválida.');const body=parsed.data,hash=hashValue({type:'automation.action',id,action:body.action,expectedRevision:body.expectedRevision});
 return withWorkspaceTransaction(p,async c=>{
  await admin(c,p);await lockWorkspace(c);const old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[body.requestId])).rows[0];if(old){if(old.user_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result;}
  const s=await state(c,p,id,{action:body.action,expectedRevision:body.expectedRevision});verifyReviewToken(body.reviewToken,s.proof,secret());if(s.blockers.length)throw new AppError(409,s.blockers[0],'AUTOMATION_BLOCKED');
  const next=body.action==='activate'?nextOccurrence(s.definition.schedule!,new Date().toISOString()):null;
  const auth:AutomationAuthorization=(await c.query('SELECT app.authorize_automation($1,$2,$3,$4,$5,$6) AS payload',[id,body.expectedRevision,randomUUID(),body.action==='activate'?'schedule':'manual',s.draft,next])).rows[0].payload;
  const result=body.action==='activate'?runtimeView(await runtimeInTransaction(c,id)):await dispatchManualOccurrence(c,auth,body.requestId,assignEligibleLeads);
  await c.query('INSERT INTO app.command_result VALUES($1,$2,$3,$4,$5)',[p.workspaceId,body.requestId,p.userId,hash,result]);
  await c.query('UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1',[p.workspaceId]);await c.query('INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,$3)',[p.workspaceId,p.userId,'automation.'+body.action]);return result;
 });
}
export async function pauseAutomation(p:Principal,id:string,input:unknown):Promise<AutomationRuntime>{
 const parsed=pauseSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Pausa inválida.');const body=parsed.data,hash=hashValue({type:'automation.pause',id,expectedRevision:body.expectedRevision});
 return withWorkspaceTransaction(p,async c=>{
  await admin(c,p);await lockWorkspace(c);const old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[body.requestId])).rows[0];if(old){if(old.user_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result;}
  const runtime=await runtimeInTransaction(c,id);if(Number(runtime.revision)!==body.expectedRevision)throw new AppError(409,'A automação mudou.');
  await c.query('SELECT app.pause_automation($1,$2)',[id,body.expectedRevision]);const result=runtimeView(await runtimeInTransaction(c,id));
  await c.query('INSERT INTO app.command_result VALUES($1,$2,$3,$4,$5)',[p.workspaceId,body.requestId,p.userId,hash,result]);await c.query('UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1',[p.workspaceId]);await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,'automation.pause')",[p.workspaceId,p.userId]);return result;
 });
}
