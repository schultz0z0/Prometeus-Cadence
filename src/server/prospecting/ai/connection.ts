import type {PoolClient} from 'pg';
import type {ConnectionCheck,ConventionalRoute} from '../../../domain/ai-routing.ts';
import type {JobLease} from '../../../domain/prospecting.ts';
import {assertJobLease} from '../repository.ts';
export async function readConnectionCheck(c:PoolClient,route:ConventionalRoute):Promise<ConnectionCheck|null>{
 const r=(await c.query('SELECT * FROM app.ai_connection_check WHERE provider=$1 AND model=$2 AND config_fingerprint=$3 AND contract_version=$4 ORDER BY checked_at DESC,id DESC LIMIT 1',[route.provider,route.model,route.configFingerprint,route.contractVersion])).rows[0];
 return r?{...route,checkedAt:new Date(r.checked_at).toISOString(),outcome:r.outcome,jobId:r.job_id,operationId:r.operation_id,code:r.code}:null;
}
export async function recordConnectionCheck(c:PoolClient,lease:JobLease,data:{operationId:string;route:ConventionalRoute;outcome:ConnectionCheck['outcome'];code?:string}){
 await assertJobLease(c,lease,true,true);const r=data.route;
 await c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome,code) VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,operation_id) DO NOTHING",[lease.jobId,data.operationId,r.provider,r.model,r.configFingerprint,r.contractVersion,data.outcome,data.code??null]);
}
