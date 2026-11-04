import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {templateSchema,type LinkedinTemplateView} from '../../domain/linkedin-sequence.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {linkedinSqlError} from './people.ts';
// 07A.3b: reusable LinkedIn texts for invite notes and sequence steps.
const sqlError=linkedinSqlError({
 LINKEDIN_CAMPAIGN_ACCESS:[403,'Somente proprietário, administrador ou operador edita templates do LinkedIn.'],
 LINKEDIN_TEMPLATE_NOT_FOUND:[404,'Template não encontrado.'],
 REVISION_CONFLICT:[409,'O template mudou em outra aba. Recarregue antes de continuar.'],
});
export async function listLinkedinTemplates(p:Principal):Promise<{templates:LinkedinTemplateView[]}>{
 return withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.linkedin_campaign_actor(false)');
  const rows=(await c.query('SELECT id,name,kind,body,revision,updated_at FROM app.linkedin_template WHERE archived_at IS NULL ORDER BY updated_at DESC,id')).rows;
  return {templates:rows.map(r=>({id:r.id,name:r.name,kind:r.kind,body:r.body,revision:Number(r.revision),updatedAt:r.updated_at.toISOString()}))};}).catch(e=>{throw sqlError(e);});
}
const saveInput=z.strictObject({id:z.uuid(),expectedRevision:z.number().int().min(0),template:templateSchema});
export async function saveLinkedinTemplate(p:Principal,raw:unknown):Promise<{id:string;revision:number}>{
 const parsed=saveInput.safeParse(raw);if(!parsed.success)throw new AppError(422,parsed.error.issues[0]?.message??'Template inválido.');const i=parsed.data;
 return withWorkspaceTransaction(p,async c=>({id:i.id,revision:Number((await c.query('SELECT app.save_linkedin_template($1,$2,$3,$4,$5) v',[i.id,i.template.name,i.template.kind,i.template.body,i.expectedRevision])).rows[0].v)})).catch(e=>{throw sqlError(e);});
}
export async function archiveLinkedinTemplate(p:Principal,id:string,raw:unknown):Promise<{archived:true}>{
 const parsed=z.strictObject({expectedRevision:z.number().int().min(1)}).safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 return withWorkspaceTransaction(p,async c=>{await c.query('SELECT app.archive_linkedin_template($1,$2)',[id,parsed.data.expectedRevision]);return {archived:true as const};}).catch(e=>{throw sqlError(e);});
}
