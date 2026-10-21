import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {ProductView} from '../../domain/products.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {idSchema} from '../prospecting/schemas.ts';
import {hashValue} from '../prospecting/review.ts';
import {lockWorkspace} from '../prospecting/ingestion.ts';
import {productView} from './repository.ts';
export const productProfileSchema=z.strictObject({name:z.string().trim().min(1).max(160),offer:z.string().max(4000),idealCustomer:z.string().max(4000),differentiators:z.string().max(4000),socialProof:z.string().max(4000),sources:z.string().max(4000)});
const bodySchema=z.strictObject({requestId:z.uuid(),id:idSchema.optional(),expectedRevision:z.number().int().min(0),action:z.enum(['save-draft','approve','archive']),profile:productProfileSchema.optional(),sourceJobId:idSchema.optional()});
export async function saveProduct(p:Principal,input:unknown):Promise<ProductView>{
 const parsed=bodySchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Revise os campos do produto.');
 const body=parsed.data,{requestId,...values}=body,hash=hashValue({type:'product.save',...values});
 return withWorkspaceTransaction(p,async c=>{
  requirePermission({...p,role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'context.approve');
  await c.query('INSERT INTO app.workspace_meta(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[p.workspaceId]);
  await lockWorkspace(c);
  const old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[requestId])).rows[0];
  if(old){if(old.user_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result;}
  const row=body.id?(await c.query('SELECT * FROM app.product_profile WHERE id=$1 FOR UPDATE',[body.id])).rows[0]:null;
  if(body.id&&!row)throw new AppError(404,'Produto não encontrado.');
  if(Number(row?.revision??0)!==body.expectedRevision)throw new AppError(409,'O produto mudou. Revise antes de salvar.');
  if(!row&&(body.action!=='save-draft'||!body.profile))throw new AppError(422,'Crie um rascunho de produto primeiro.');
  if(body.action==='save-draft'&&!body.profile)throw new AppError(422,'Informe o perfil do produto.');
  if(body.sourceJobId){
   const source=(await c.query("SELECT p.payload,j.input,j.state FROM app.planning_proposal p JOIN app.prospecting_job j ON j.workspace_id=p.workspace_id AND j.id=p.job_id WHERE p.job_id=$1",[body.sourceJobId])).rows[0];
   if(!source||!['completed','partial'].includes(source.state)||source.input.task!=='context_read'||source.input.target?.kind!=='product'||source.input.target.productId!==body.id)throw new AppError(409,'A proposta não corresponde a este produto.');
  }
  const id=body.id??randomUUID(),revision=body.expectedRevision+1,draft=body.profile??row.draft;
  if(row?.archived&&body.action!=='archive')throw new AppError(409,'Este produto foi arquivado.');
  if(body.action==='approve'&&(!draft.name.trim()||!draft.offer.trim()||!draft.idealCustomer.trim()))throw new AppError(422,'Preencha nome, oferta e público antes de aprovar.');
  const approved=body.action==='approve'?{...draft,version:revision,approvedAt:new Date().toISOString()}:row?.approved??null;
  const archived=body.action==='archive',origin=body.sourceJobId?{sourceJobId:body.sourceJobId,humanReviewed:true}: {manual:true};
  const view:ProductView={id,revision,draft,approved,archived};
  if(row)await c.query('UPDATE app.product_profile SET revision=$2,draft=$3,approved=$4,archived=$5,origin=$6,updated_at=now() WHERE id=$1',[id,revision,draft,approved,archived,origin]);
  else await c.query('INSERT INTO app.product_profile(workspace_id,id,revision,draft,approved,archived,origin) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.workspaceId,id,revision,draft,approved,archived,origin]);
  await c.query('INSERT INTO app.product_profile_version(workspace_id,product_id,version,action,payload,origin,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[p.workspaceId,id,revision,body.action,view,origin,p.userId]);
  await c.query('UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1',[p.workspaceId]);
  await c.query('INSERT INTO app.command_result VALUES($1,$2,$3,$4,$5)',[p.workspaceId,requestId,p.userId,hash,view]);
  await c.query('INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,$3)',[p.workspaceId,p.userId,'product.'+body.action]);
  return view;
 });
}
