import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {CandidatePage,JobLease,IngestCounts,JobInput} from '../../domain/prospecting.ts';
import {AppError} from '../errors.ts';
import {assertJobLease} from './repository.ts';
import {strongIdentities,normalizeCandidate} from './normalize.ts';
import {hashValue} from './review.ts';
import {settleUsage} from './usage.ts';
import {saveEvidence} from './evidence.ts';
export async function lockWorkspace(c:PoolClient){await c.query("SELECT revision FROM app.workspace_meta WHERE workspace_id=current_setting('app.workspace_id') FOR UPDATE");}
export async function ingestPage(c:PoolClient,lease:JobLease,page:CandidatePage):Promise<IngestCounts>{
  await lockWorkspace(c);await assertJobLease(c,lease);
  await c.query("SELECT set_config('app.billing_job_id',$1,true),set_config('app.billing_job_token',$2,true),set_config('app.billing_job_fence',$3,true)",[lease.jobId,lease.token,String(lease.fence)]);
  if(page.candidates.length>100||page.rawCount>100||page.rawCount<page.candidates.length||page.rawCount<0)throw new AppError(422,'Lote inválido.');
  const hash=hashValue(page),prior=(await c.query('SELECT * FROM app.prospecting_receipt WHERE job_id=$1 AND id=$2',[lease.jobId,page.receiptId])).rows[0];
  if(prior){if(prior.body_hash!==hash)throw new AppError(409,'Recibo já utilizado.');return prior.counts;}
  const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0],input=job.input as JobInput;
  if(input.kind!=='generation')throw new AppError(409,'Tipo de execução incompatível.');
  const counts:IngestCounts={found:page.rawCount,inserted:0,duplicates:0,rejected:page.rejected.length,pending:0};
  if(job.counts.found+page.rawCount>input.limit)throw new AppError(422,'Quantidade acima do limite confirmado.');
  for(const candidate of page.candidates){
    let normalized;try{normalized=normalizeCandidate(candidate,input.source);}catch{counts.rejected++;continue;}
    const identities=strongIdentities(normalized),existing=(await c.query('SELECT lead_id FROM app.lead_identity WHERE identity=ANY($1::text[]) AND ($2 OR list_id=$3) LIMIT 1',[identities,input.dedupScope==='workspace',job.list_id])).rows[0];
    const id=randomUUID(),leadId=existing?.lead_id??randomUUID();
    if(existing)counts.duplicates++;
    else{
      const {sourceRef:_ref,...fields}=normalized;
      const lead={...fields,id:leadId,listId:job.list_id,qualification:'pending',createdAt:new Date().toISOString()};
      await c.query("INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES(current_setting('app.workspace_id'),$1,$2,$3)",[leadId,job.list_id,lead]);
      for(const identity of identities)await c.query("INSERT INTO app.lead_identity VALUES(current_setting('app.workspace_id'),$1,$2,$3) ON CONFLICT DO NOTHING",[job.list_id,identity,leadId]);
      await saveEvidence(c,lease.jobId,leadId,candidate.evidence??[]);counts.inserted++;
    }
    await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,source_ref,name,status) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,job_id,source_ref) DO NOTHING",[lease.jobId,id,leadId,normalized.sourceRef,normalized.name,existing?'duplicate':'inserted']);
  }
  const next=Object.fromEntries(Object.keys(counts).map(k=>[k,Number(job.counts[k]??0)+counts[k as keyof IngestCounts]]));
  await settleUsage(c,lease.jobId,page.usage);
  await c.query("INSERT INTO app.prospecting_receipt VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[lease.jobId,page.receiptId,hash,counts]);
  await c.query("UPDATE app.prospecting_job SET counts=$2,checkpoint=checkpoint||$3::jsonb,revision=revision+1,updated_at=now() WHERE id=$1",[lease.jobId,next,{cursor:page.nextCursor,exhausted:page.exhausted}]);
  if(counts.inserted)await c.query("UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=current_setting('app.workspace_id')");
  return counts;
}
