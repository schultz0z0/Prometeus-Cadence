import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {ModuleId,ModuleResult,Units} from '../../domain/prospecting.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {lockWorkspace} from './ingestion.ts';
import {jobView} from './repository.ts';
import {ApifyAdapter} from './providers/apify.ts';
import {providerContext} from './steps.ts';
import {settleUsage,releaseUnused} from './usage.ts';
const schema=z.strictObject({operationId:z.string().min(1).max(120).optional(),runId:z.string().regex(/^[-\w]{1,100}$/).optional(),confirmNotStarted:z.literal(true).optional(),resultUnavailable:z.literal(true).optional()}).refine(v=>[v.runId,v.confirmNotStarted,v.resultUnavailable].filter(Boolean).length===1);
const unresolvedSql="(state IN('prepared','uncertain') OR payload->'result'->>'kind'='uncertain')";
const sourceFor=(job:any,attempt:any)=>job.kind==='generation'?job.source:attempt.step.startsWith('website:')?'WEB':attempt.step.startsWith('registry:')?'CNPJ':null;
export async function reconcileJob(p:Principal,id:string,body:unknown,deps:{apify?:ApifyAdapter}={}){
  const parsed=schema.safeParse(body);if(!parsed.success)throw new AppError(422,'Selecione uma chamada e uma ação de reconciliação.');
  const selection=parsed.data;
  const {job,attempt}=await withWorkspaceTransaction(p,async c=>{
    const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;
    if(!['owner','admin'].includes(role))throw new AppError(403,'Somente administradores podem reconciliar uma chamada externa.');
    const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[id])).rows[0];if(!job)throw new AppError(404,'Execução não encontrada.');
    if(job.state!=='needs_reconciliation')throw new AppError(409,'A execução não está aguardando reconciliação.');
    const attempts=(await c.query(`SELECT * FROM app.prospecting_attempt WHERE job_id=$1 AND ${unresolvedSql} ORDER BY created_at,id`,[id])).rows;
    const attempt=selection.operationId?attempts.find(a=>a.id===selection.operationId):attempts.length===1?attempts[0]:null;
    if(!attempt)throw new AppError(409,'Selecione a chamada incerta exibida no histórico.');
    return{job,attempt};
  });
  const source=sourceFor(job,attempt);let run:any=null;
  if(selection.runId){
    if(attempt.provider!=='apify'||!['MAPS','WEB','CNPJ'].includes(source))throw new AppError(409,'Esta chamada não permite vínculo de run Apify. Registre o resultado indisponível ou confira se não foi iniciada.');
    const ctx=providerContext(job,source,attempt.id,AbortSignal.timeout(30000)),adapter=deps.apify??new ApifyAdapter();
    const [actor,remote]=await Promise.all([adapter.request(ctx,'/acts/'+ctx.profile.actor.replace('/','~')),adapter.request(ctx,'/actor-runs/'+selection.runId)]);
    if(remote?.data?.actId!==actor?.data?.id||![remote?.data?.buildId,remote?.data?.buildNumber].includes(ctx.profile.build)||!/^[-\w]{1,100}$/.test(remote?.data?.defaultDatasetId??''))throw new AppError(409,'O Actor/build/dataset do run não corresponde ao perfil confirmado.');
    run={provider:'apify',runId:selection.runId,datasetId:remote.data.defaultDatasetId,profileId:ctx.profile.actor,build:ctx.profile.build,operationId:attempt.id};
  }
  return withWorkspaceTransaction(p,async c=>{
    await lockWorkspace(c);const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;if(!['owner','admin'].includes(role))throw new AppError(403,'Acesso administrativo necessário.');
    const current=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(current.state!=='needs_reconciliation'||String(current.revision)!==String(job.revision))throw new AppError(409,'A execução mudou. Revise novamente.');
    if(!(await c.query(`SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND id=$2 AND ${unresolvedSql} FOR UPDATE`,[id,attempt.id])).rowCount)throw new AppError(409,'Esta chamada já foi reconciliada.');
    const units:Units=attempt.payload.reservedUnits??(attempt.provider==='apify'?{apifyRuns:1}:attempt.provider==='apollo'?{apolloPages:1}:attempt.provider==='openrouter'?{jevCalls:1}:attempt.provider==='codex'?{codexCalls:1}:{});
    let state='queued',providerRun=current.provider_run;
    if(selection.confirmNotStarted){
      await c.query('DELETE FROM app.prospecting_attempt WHERE job_id=$1 AND id=$2',[id,attempt.id]);
      if(job.kind==='generation'&&attempt.step==='start')providerRun=null;
    }else{
      await settleUsage(c,id,{provider:attempt.provider,operationId:attempt.id,units,costUsd:null,costKind:'unknown'});
      await c.query('UPDATE app.prospecting_attempt SET state=$3,payload=$4,remote_id=$5 WHERE job_id=$1 AND id=$2',[id,attempt.id,selection.resultUnavailable?'failed':'completed',{reservedUnits:units,...(run?{result:{kind:'remote',run}}:{resultUnavailable:true})},run?.runId??null]);
      if(run&&job.kind==='generation')providerRun=run;
      if(selection.resultUnavailable){
        if(job.kind==='generation')state=current.counts.found>0?'partial':'failed';
        else{
          const [step,leadId]=attempt.step.split(':'),module=(step==='second_opinion'?'qualify':step) as ModuleId;
          if(!job.input.leadIds.includes(leadId)||!['registry','website','qualify','summary'].includes(module))throw new AppError(409,'Esta chamada precisa de resolução administrativa adicional.');
          const previous=(await c.query('SELECT * FROM app.prospecting_item WHERE job_id=$1 AND lead_id=$2 FOR UPDATE',[id,leadId])).rows[0];
          const results:ModuleResult[]=previous?.payload.results??[];
          if(!results.some(r=>r.module===module)){
            const result:ModuleResult={module,status:'failed',proposed:{},base:{},evidenceIds:[],usage:null,reasons:['PROVIDER_RESULT_UNAVAILABLE','USAGE_ACKNOWLEDGED'],contextVersion:job.checkpoint.context?.version??0};
            await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status,payload) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,'failed',$5) ON CONFLICT(workspace_id,job_id,id) DO UPDATE SET payload=EXCLUDED.payload,status='failed'",[id,previous?.id??randomUUID(),leadId,job.checkpoint.bases[leadId].name,{results:[...results,result]}]);
          }
        }
      }
    }
    if((await c.query(`SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND ${unresolvedSql} LIMIT 1`,[id])).rowCount)state='needs_reconciliation';
    const row=(await c.query("UPDATE app.prospecting_job SET state=$2,actor_id=$3,provider_run=$4,error_code=$5,error_message=$6,lease_until=NULL,lease_token=NULL,fence=fence+1,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *",[id,state,p.userId,providerRun,selection.resultUnavailable?'RESULT_UNAVAILABLE':null,selection.resultUnavailable?'Consumo registrado por confirmação administrativa; resultado indisponível, sem repetir a chamada.':null])).rows[0];
    if(['failed','partial'].includes(state))await releaseUnused(c,id);
    await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES(current_setting('app.workspace_id'),$1,'prospecting.reconcile')",[p.userId]);return jobView(row);
  });
}
