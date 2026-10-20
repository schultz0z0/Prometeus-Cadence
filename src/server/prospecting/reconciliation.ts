import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from './ingestion.ts';
import {jobView} from './repository.ts';
import {ApifyAdapter} from './providers/apify.ts';
import {providerContext} from './steps.ts';
import {settleUsage} from './usage.ts';
import {hashValue} from './review.ts';
const schema=z.strictObject({runId:z.string().regex(/^[-\w]{1,100}$/).optional(),confirmNotStarted:z.literal(true).optional()}).refine(v=>Boolean(v.runId)!==Boolean(v.confirmNotStarted));
export async function reconcileJob(p:Principal,id:string,body:unknown){
  const parsed=schema.safeParse(body);if(!parsed.success)throw new AppError(422,'Vincule um run ou confirme que a chamada não foi iniciada.');
  const job=await withWorkspaceTransaction(p,async c=>{
    const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;if(!['owner','admin'].includes(role))throw new AppError(403,'Somente administradores podem reconciliar uma chamada externa.');
    const row=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[id])).rows[0];if(!row)throw new AppError(404,'Execução não encontrada.');
    if(row.state!=='needs_reconciliation')throw new AppError(409,'A execução não está aguardando reconciliação.');return row;
  });
  let run=job.provider_run;
  if(parsed.data.runId){
    if(!['MAPS','WEB','CNPJ'].includes(job.source))throw new AppError(409,'Esta execução não aceita vínculo de run.');
    const ctx=providerContext(job,job.source,hashValue({job:id,step:'start'}),AbortSignal.timeout(30000)),adapter=new ApifyAdapter();
    const [actor,remote]=await Promise.all([adapter.request(ctx,'/acts/'+ctx.profile.actor.replace('/','~')),adapter.request(ctx,'/actor-runs/'+parsed.data.runId)]);
    if(remote.data?.actId!==actor.data?.id||![remote.data?.buildId,remote.data?.buildNumber].includes(ctx.profile.build))throw new AppError(409,'O Actor/build do run não corresponde ao perfil confirmado.');
    run={provider:'apify',runId:parsed.data.runId,datasetId:remote.data.defaultDatasetId??null,profileId:ctx.profile.actor,build:ctx.profile.build,operationId:ctx.operationId};
  }
  return withWorkspaceTransaction(p,async c=>{
    await lockWorkspace(c);const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;if(!['owner','admin'].includes(role))throw new AppError(403,'Acesso administrativo necessário.');
    const current=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(current.state!=='needs_reconciliation'||current.revision!==job.revision)throw new AppError(409,'A execução mudou. Revise novamente.');
    if(parsed.data.confirmNotStarted){
      await c.query("DELETE FROM app.prospecting_attempt WHERE job_id=$1 AND (state IN('prepared','uncertain','failed') OR payload->'result'->>'kind'='uncertain')",[id]);run=null;
    }else{
      const operationId=hashValue({job:id,step:'start'});
      await settleUsage(c,id,{provider:'apify',operationId,units:{apifyRuns:1},costUsd:null,costKind:'unknown'});
      await c.query("UPDATE app.prospecting_attempt SET state='completed',payload=$2 WHERE job_id=$1 AND step='start'",[id,{result:{kind:'remote',run}}]);
    }
    const row=(await c.query("UPDATE app.prospecting_job SET state='queued',actor_id=$2,provider_run=$3,error_code=NULL,error_message=NULL,lease_until=NULL,lease_token=NULL,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[id,p.userId,run])).rows[0];
    await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),$1,'prospecting.reconcile')",[p.userId]);return jobView(row);
  });
}
