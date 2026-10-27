import type {PoolClient} from 'pg';
import type {ConnectionCheck,ConventionalRoute} from '../../../domain/ai-routing.ts';
import type {JobLease} from '../../../domain/prospecting.ts';
import {assertJobLease} from '../repository.ts';
import {platformAiWorkspace} from './platform.ts';
export async function readConnectionCheck(c:PoolClient,route:ConventionalRoute,freshOperationId?:string):Promise<ConnectionCheck|null>{
 const r=(await c.query('SELECT app.platform_ai_check($1,$2,$3,$4,$5,$6) AS data',[platformAiWorkspace(),route.provider,route.model,route.configFingerprint,route.contractVersion,freshOperationId??null])).rows[0]?.data;
 // An interrupted process can leave a dispatched attempt without reaching the
 // failure handler. Its journal shadows any older successful attestation.
 const pending=(await c.query(`SELECT a.id,a.job_id,a.created_at FROM app.prospecting_attempt a
  JOIN app.prospecting_job j ON j.workspace_id=a.workspace_id AND j.id=a.job_id
  WHERE a.provider=$1 AND (a.state IN('prepared','started','uncertain') OR (a.state='failed' AND a.payload->>'resultUnavailable'='true'))
   AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'provider'=$2
   AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'model'=$3
   AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'configFingerprint'=$4
   AND j.checkpoint->'execution'->'aiRoute'->'conventional'->>'contractVersion'=$5
   AND ($6::timestamptz IS NULL OR a.created_at>=$6)
   AND ($7::text IS NULL OR a.id<>$7)
  ORDER BY a.created_at DESC,a.id DESC LIMIT 1`,[route.provider==='codex-local'?'codex':route.provider,route.provider,route.model,route.configFingerprint,route.contractVersion,r?.checked_at??null,freshOperationId??null])).rows[0];
 if(pending)return{...route,checkedAt:new Date(pending.created_at).toISOString(),outcome:'uncertain',jobId:pending.job_id,operationId:pending.id,code:'CONVENTIONAL_ATTEMPT_UNRESOLVED'};
 return r?{...route,checkedAt:new Date(r.checked_at).toISOString(),outcome:r.outcome,jobId:r.job_id,operationId:r.operation_id,code:r.code}:null;
}
export async function recordConnectionCheck(c:PoolClient,lease:JobLease,data:{operationId:string;route:ConventionalRoute;outcome:ConnectionCheck['outcome'];code?:string;checkedAt?:string}){
 await assertJobLease(c,lease,true,true);const r=data.route;
 await c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome,code,checked_at) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz,clock_timestamp())) ON CONFLICT(workspace_id,operation_id) DO NOTHING",[lease.jobId,data.operationId,r.provider,r.model,r.configFingerprint,r.contractVersion,data.outcome,data.code??null,data.checkedAt??null]);
}
