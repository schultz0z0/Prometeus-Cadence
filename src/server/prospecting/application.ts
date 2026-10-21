import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {ModuleResult} from '../../domain/prospecting.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {requirePermission} from '../auth/permissions.ts';
import {hashValue} from './review.ts';
import {lockWorkspace} from './ingestion.ts';
import {readApprovedContext} from '../context/repository.ts';
const schema=z.strictObject({requestId:z.uuid(),itemIds:z.array(z.string().min(1).max(120)).min(1).max(100).refine(ids=>new Set(ids).size===ids.length)});
const editable=new Set(['email','phone','site','city','state','cnpj','companyName','summary','qualification','reason']);
export async function applyJobResults(p:Principal,jobId:string,body:unknown):Promise<{applied:number;revision:number}>{
  const parsed=schema.safeParse(body);if(!parsed.success)throw new AppError(422,'Seleção inválida.');
  const {requestId,itemIds}=parsed.data,hash=hashValue({action:'prospecting.apply',jobId,itemIds:[...itemIds].sort()});
  return withWorkspaceTransaction(p,async c=>{
    requirePermission({...p,role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'data.write');await lockWorkspace(c);
    const old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[requestId])).rows[0];
    if(old){if(old.user_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result;}
    const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!job)throw new AppError(404,'Execução não encontrada.');
    if(job.checkpoint.purpose==='ai-connection-test')throw new AppError(409,'Teste de conexão não pode alterar contatos.');
    if(job.kind!=='qualification'||!['completed','partial'].includes(job.state))throw new AppError(409,'Aguarde o término da qualificação.');
    const items=(await c.query('SELECT * FROM app.prospecting_item WHERE job_id=$1 AND id=ANY($2::text[]) FOR UPDATE',[jobId,itemIds])).rows;
    if(items.length!==itemIds.length||items.some(i=>i.applied))throw new AppError(409,'A seleção contém resultado indisponível.');
    const context=await readApprovedContext(c);
    if(Number(context?.version??0)!==Number(job.checkpoint.context?.version??0))throw new AppError(409,'O contexto mudou. Prepare uma nova qualificação.','RESULT_CONFLICT');
    if(job.checkpoint.product){const row=(await c.query('SELECT approved,archived FROM app.product_profile WHERE id=$1',[job.checkpoint.automation?.productId??job.checkpoint.productId])).rows[0];if(!row||row.archived||row.approved?.version!==job.checkpoint.product.version)throw new AppError(409,'O produto aprovado mudou. Revise a qualificação.','RESULT_CONFLICT');}
    const changes=[];
    for(const item of items){
      const lead=(await c.query('SELECT payload FROM app.lead WHERE id=$1 FOR UPDATE',[item.lead_id])).rows[0]?.payload;
      if(!lead||lead.listId!==job.list_id)throw new AppError(409,'O contato foi removido ou movido.','RESULT_CONFLICT');
      const proposed:Record<string,unknown>={};
      for(const result of item.payload.results as ModuleResult[]){
        if(result.status!=='pending_review')continue;
        for(const [key,value]of Object.entries(result.proposed)){
          if(!editable.has(key))throw new AppError(409,'A proposta contém campo inválido.');
          if(hashValue(lead[key]??null)!==hashValue((result.base as Record<string,unknown>)[key]??null))throw new AppError(409,`O campo ${key} de ${item.name} mudou. Prepare novamente. Não foi aplicada nenhuma alteração.`,'RESULT_CONFLICT');
          proposed[key]=value;
        }
      }
      if(Object.keys(proposed).length)changes.push({item,lead:{...lead,...proposed}});
    }
    if(!changes.length)throw new AppError(409,'A seleção não contém alterações propostas.');
    for(const {item,lead}of changes){await c.query('UPDATE app.lead SET payload=$2 WHERE id=$1',[lead.id,lead]);await c.query("UPDATE app.prospecting_item SET applied=true,status='applied' WHERE job_id=$1 AND id=$2",[jobId,item.id]);}
    const revision=Number((await c.query("UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=current_setting('app.workspace_id') RETURNING revision")).rows[0].revision),result={applied:changes.length,revision};
    await c.query("INSERT INTO app.command_result VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[requestId,p.userId,hash,result]);
    await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),$1,'prospecting.apply')",[p.userId]);return result;
  });
}
