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
import {qualificationFingerprint} from '../../domain/qualification-policy.ts';
const schema=z.strictObject({requestId:z.uuid(),itemIds:z.array(z.string().min(1).max(120)).min(1).max(500).refine(ids=>new Set(ids).size===ids.length),skipConflicts:z.boolean().optional(),rejected:z.record(z.string().min(1).max(120),z.array(z.string().min(1).max(40)).max(20)).optional()});
const editable=new Set(['email','phone','site','city','state','cnpj','companyName','summary','qualification','reason','capital','size','legalNature','cnae','openedAt','address']);
type Skipped={itemId:string;name:string;reason:'edited'|'moved'|'unavailable'};
export async function applyJobResults(p:Principal,jobId:string,body:unknown):Promise<{applied:number;revision:number;skipped?:Skipped[]}>{
  const parsed=schema.safeParse(body);if(!parsed.success)throw new AppError(422,'Seleção inválida.');
  const {requestId,itemIds}=parsed.data,skip=parsed.data.skipConflicts===true,rejected=parsed.data.rejected??{},hash=hashValue({action:'prospecting.apply',jobId,itemIds:[...itemIds].sort(),...(skip?{skipConflicts:true}:{}),...(Object.keys(rejected).length?{rejected:Object.fromEntries(Object.entries(rejected).sort().map(([k,v])=>[k,[...v].sort()]))}:{})});
  if(Object.keys(rejected).some(id=>!itemIds.includes(id)))throw new AppError(422,'Seleção inválida.');
  return withWorkspaceTransaction(p,async c=>{
    requirePermission({...p,role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'data.write');await lockWorkspace(c);
    const old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[requestId])).rows[0];
    if(old){if(old.user_id!==p.userId||old.body_hash!==hash)throw new AppError(409,'Identificador já utilizado.');return old.result;}
    const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1 FOR UPDATE',[jobId])).rows[0];
    if(!job)throw new AppError(404,'Execução não encontrada.');
    if(job.checkpoint.purpose==='ai-connection-test')throw new AppError(409,'Teste de conexão não pode alterar contatos.');
    if(job.input.companyPeople)throw new AppError(409,'Revise e aplique as pessoas pela investigação da empresa.');
    if(job.input.companyResearch)throw new AppError(409,'Revise e aplique os fatos pela investigação da empresa.');
    if(job.input.enrichment){
      if(!['completed','partial'].includes(job.state))throw new AppError(409,'Aguarde o término do enriquecimento.');
      const result=(await c.query('SELECT app.apply_enrichment($1,$2::text[]) AS result',[jobId,itemIds])).rows[0].result;
      await c.query("INSERT INTO app.command_result VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[requestId,p.userId,hash,result]);
      await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),$1,'enrichment.apply')",[p.userId]);return result;
    }
    if(job.kind!=='qualification'||!['completed','partial'].includes(job.state))throw new AppError(409,'Aguarde o término da qualificação.');
    const items=(await c.query('SELECT * FROM app.prospecting_item WHERE job_id=$1 AND id=ANY($2::text[]) FOR UPDATE',[jobId,itemIds])).rows;
    // 20/11/2026: with skipConflicts (batch approval of the end-user screen) a company that cannot be applied is left out and listed; the rest goes through.
    const skipped:Skipped[]=[];
    if(skip){for(const id of itemIds){const row=items.find(i=>i.id===id);if(!row||row.applied)skipped.push({itemId:id,name:row?.name??'',reason:'unavailable'});}}
    else if(items.length!==itemIds.length||items.some(i=>i.applied))throw new AppError(409,'A seleção contém resultado indisponível.');
    const context=await readApprovedContext(c);
    if(Number(context?.version??0)!==Number(job.checkpoint.context?.version??0))throw new AppError(409,'O contexto mudou. Prepare uma nova qualificação.','RESULT_CONFLICT');
    if(job.checkpoint.product){const row=(await c.query('SELECT approved,archived FROM app.product_profile WHERE id=$1',[job.checkpoint.automation?.productId??job.checkpoint.productId])).rows[0];if(!row||row.archived||row.approved?.version!==job.checkpoint.product.version)throw new AppError(409,'O produto aprovado mudou. Revise a qualificação.','RESULT_CONFLICT');}
    const changes=[];
    // One locking read and two batch writes, so a 500-company approval holds the workspace lock briefly.
    const leads=new Map<string,any>((await c.query('SELECT id,payload FROM app.lead WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[items.map(i=>i.lead_id).filter(Boolean)])).rows.map(r=>[r.id,r.payload]));
    for(const item of items){
      if(item.applied)continue;
      const lead=leads.get(item.lead_id);
      if(!lead||lead.listId!==job.list_id){if(skip){skipped.push({itemId:item.id,name:item.name,reason:'moved'});continue;}throw new AppError(409,'O contato foi removido ou movido.','RESULT_CONFLICT');}
      if(item.payload.inputFingerprint&&item.payload.inputFingerprint!==hashValue(qualificationFingerprint(lead))){if(skip){skipped.push({itemId:item.id,name:item.name,reason:'edited'});continue;}throw new AppError(409,'O contato ou suas fontes mudou. Prepare novamente antes de aplicar.','RESULT_CONFLICT');}
      const proposed:Record<string,unknown>={};let edited=false;
      for(const result of item.payload.results as ModuleResult[]){
        if(result.status!=='pending_review')continue;
        for(const [key,value]of Object.entries(result.proposed)){
          if(rejected[item.id]?.includes(key))continue;
          if(!editable.has(key))throw new AppError(409,'A proposta contém campo inválido.');
          if(hashValue(lead[key]??null)!==hashValue((result.base as Record<string,unknown>)[key]??null)){if(skip){edited=true;break;}throw new AppError(409,`O campo ${key} de ${item.name} mudou. Prepare novamente. Não foi aplicada nenhuma alteração.`,'RESULT_CONFLICT');}
          proposed[key]=value;
        }
        if(edited)break;
      }
      if(edited){skipped.push({itemId:item.id,name:item.name,reason:'edited'});continue;}
      if(Object.keys(proposed).length)changes.push({item,lead:{...lead,...proposed}});
    }
    if(!changes.length&&!skip)throw new AppError(409,'A seleção não contém alterações propostas.');
    if(changes.length){
      await c.query('UPDATE app.lead l SET payload=v.payload FROM jsonb_to_recordset($1::jsonb) AS v(id text,payload jsonb) WHERE l.id=v.id',[JSON.stringify(changes.map(({lead})=>({id:lead.id,payload:lead})))]);
      await c.query("UPDATE app.prospecting_item SET applied=true,status='applied' WHERE job_id=$1 AND id=ANY($2::text[])",[jobId,changes.map(({item})=>item.id)]);
    }
    const revision=Number((await c.query(changes.length?"UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=current_setting('app.workspace_id') RETURNING revision":"SELECT revision FROM app.workspace_meta WHERE workspace_id=current_setting('app.workspace_id')")).rows[0].revision),result={applied:changes.length,revision,...(skip?{skipped}:{})};
    await c.query("INSERT INTO app.command_result VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[requestId,p.userId,hash,result]);
    await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),$1,'prospecting.apply')",[p.userId]);return result;
  });
}
