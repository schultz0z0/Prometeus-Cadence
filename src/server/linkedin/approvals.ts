import 'server-only';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {resolveAiRoute,type ConventionalRoute} from '../../domain/ai-routing.ts';
import {linkedinActionAllowed} from '../../domain/linkedin-capabilities.ts';
import {approveSchema,rejectSchema,type LinkedinApprovalView} from '../../domain/linkedin-approval.ts';
import {commentOutputJsonSchema,commentOutputSchema} from '../../domain/linkedin-sequence.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {readAiPolicy} from '../prospecting/ai/settings.ts';
import {conventionalConfig} from '../prospecting/ai/config.ts';
import {runConventionalJson} from '../prospecting/ai/json.ts';
import {linkedinCapabilityView} from './capabilities.ts';
import {capsVersion} from './connections.ts';
import {linkedinSqlError} from './people.ts';
import {unipileRequest,unipileSettings,UnipileMissing,UnipileRetry,type UnipileDeps} from './unipile.ts';
// 07A.3c: the approval queue of AI-written post comments, the module's only public action.
const sqlError=linkedinSqlError({
 LINKEDIN_CAMPAIGN_ACCESS:[403,'Somente proprietário, administrador ou operador aprova comentários.'],
 LINKEDIN_APPROVAL_NOT_FOUND:[404,'Comentário não encontrado.'],
 LINKEDIN_APPROVAL_CLOSED:[409,'Este comentário já foi decidido. Recarregue a lista.'],
 LINKEDIN_OPTED_OUT:[409,'Esta pessoa pediu para não ser contatada. Nada foi publicado.'],
 LINKEDIN_ACCOUNT_NOT_READY:[409,'A conta LinkedIn desta campanha não está pronta. Nada foi publicado.'],
 REVISION_CONFLICT:[409,'O comentário mudou em outra aba. Recarregue antes de continuar.'],
});
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{throw sqlError(e);});
const iso=(d:Date|null)=>d?d.toISOString():null;
export async function listLinkedinApprovals(p:Principal,raw:unknown):Promise<{approvals:LinkedinApprovalView[]}>{
 const q=z.object({tab:z.enum(['pending','history']).default('pending')}).safeParse(raw??{});if(!q.success)throw new AppError(422,'Filtro inválido.');
 return tx(p,async c=>{await c.query('SELECT app.linkedin_campaign_actor(false)');
  const rows=(await c.query(`SELECT a.id,a.revision,a.state,a.body,a.ai_body,a.post_text,a.post_url,a.post_date,a.created_at,a.expires_at,a.decided_at,
    p.id person_id,p.name,p.headline,p.company,c.id campaign_id,c.name campaign_name
   FROM app.linkedin_approval a JOIN app.linkedin_campaign_person p ON p.workspace_id=a.workspace_id AND p.id=a.person_id JOIN app.linkedin_campaign c ON c.workspace_id=a.workspace_id AND c.id=a.campaign_id
   WHERE ${q.data.tab==='pending'?"a.state='pending'":"a.state<>'pending'"} ORDER BY ${q.data.tab==='pending'?'a.created_at,a.id':'a.updated_at DESC,a.id'} LIMIT 200`)).rows;
  return {approvals:rows.map(r=>({id:r.id,revision:Number(r.revision),state:r.state,body:r.body,aiBody:r.ai_body,post:{text:r.post_text,url:r.post_url,date:iso(r.post_date)},
   person:{id:r.person_id,name:r.name,headline:r.headline,company:r.company},campaign:{id:r.campaign_id,name:r.campaign_name},createdAt:r.created_at.toISOString(),expiresAt:r.expires_at.toISOString(),decidedAt:iso(r.decided_at)}))};
 });
}
/** Approve the (possibly edited) text and publish it once. Rechecked: the comment capability, the account and the opt-out. */
export async function approveLinkedinComment(p:Principal,id:string,raw:unknown,deps:UnipileDeps={}):Promise<{state:'posted'|'uncertain'|'failed'}>{
 const parsed=approveSchema.safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,parsed.error?.issues[0]?.message??'Aprovação inválida.');const i=parsed.data;
 const claim=await tx(p,async c=>{
  const cap=await linkedinCapabilityView(c);
  if(!linkedinActionAllowed(cap.capabilities,'comment'))throw new AppError(409,cap.reason||'O fornecedor habilitado não oferece comentários.','LINKEDIN_UNAVAILABLE');
  unipileSettings();// a missing key fails before the claim: nothing reserved, nothing uncertain
  const r=(await c.query('SELECT app.claim_linkedin_comment($1,$2,$3,$4) v',[id,i.expectedRevision,i.body,i.requestId])).rows[0].v as {replay:boolean;state?:string;socialId:string;external:string;capabilitiesVersion:string};
  if(!r.replay&&r.capabilitiesVersion!==capsVersion(cap))throw new AppError(409,'A conta LinkedIn precisa ser verificada de novo. Nada foi publicado.','LINKEDIN_ACCOUNT_NOT_READY');
  return r;});
 if(claim.replay)return {state:(claim.state==='posting'?'uncertain':claim.state) as 'posted'|'uncertain'|'failed'};
 let outcome:'posted'|'uncertain'|'failed',remote:string|null=null;
 try{const r=await unipileRequest('POST',`/api/v1/posts/${encodeURIComponent(claim.socialId)}/comments`,{account_id:claim.external,text:i.body},deps);
  remote=typeof r?.comment_id==='string'?r.comment_id:null;outcome='posted';}
 catch(e){const status=e instanceof UnipileRetry?e.status:e instanceof UnipileMissing?404:undefined;
  // No status or a 5xx: the comment may be public already. Never repeated.
  outcome=status===undefined||status>=500?'uncertain':'failed';}
 await tx(p,c=>c.query('SELECT app.finish_linkedin_comment($1,$2,$3,$4)',[id,i.requestId,outcome,remote]));
 if(outcome==='failed')throw new AppError(422,'O LinkedIn recusou o comentário. Ele não será publicado.','LINKEDIN_COMMENT_FAILED');
 return {state:outcome};
}
export async function rejectLinkedinComment(p:Principal,id:string,raw:unknown):Promise<{revision:number}>{
 const parsed=rejectSchema.safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 return tx(p,async c=>({revision:Number((await c.query('SELECT app.reject_linkedin_comment($1,$2) v',[id,parsed.data.expectedRevision])).rows[0].v)}));
}

export interface CommentInput{workspaceId:string;runId:string;postText:string;guidance:string|null;person:{name:string;headline:string|null;company:string|null}}
export type CommentGenerator=(i:CommentInput)=>Promise<{text:string;usage:{provider:string;inputTokens?:number;outputTokens?:number}}|null>;
/** Platform AI, conventional HTTP route of the platform policy; null when no route is configured (the step is held). */
export function platformCommentGenerator(c:PoolClient):CommentGenerator{
 return async i=>{
  const policy=await readAiPolicy(c),resolved=resolveAiRoute({...policy,mode:'conventional-only',jevEnabled:false},conventionalConfig(i.workspaceId),null);
  const route:ConventionalRoute|null=resolved.route&&resolved.route.conventional.provider!=='codex-local'?resolved.route.conventional:null;
  if(!route)return null;
  const prompt=JSON.stringify({task:'Escreva um comentário curto (1 a 3 frases, até 600 caracteres) em português do Brasil para o post do LinkedIn abaixo, como quem leu o post e quer contribuir. Seja específico sobre o conteúdo do post. Não use links, hashtags, emojis em excesso nem peça reunião, ligação ou demonstração. Não invente fatos sobre a pessoa.',
   guidance:i.guidance,author:i.person,post:i.postText});
  const r=await runConventionalJson({operationId:'linkedin-comment:'+i.runId,workspaceId:i.workspaceId,signal:AbortSignal.timeout(60e3),route},
   {prompt,schema:commentOutputJsonSchema,maxOutputTokens:600,parse:v=>{const o=commentOutputSchema.safeParse(v);if(!o.success)throw new Error('LINKEDIN_COMMENT_INVALID');return o.data.comment;}});
  return {text:r.value,usage:r.usage};
 };
}
