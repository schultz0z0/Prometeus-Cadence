import type {JobLease} from '../../domain/prospecting.ts';
import {workerPool} from './worker-db.ts';
export async function claimJob(workerId:string,workspaceId?:string):Promise<JobLease|null>{
  const limit=Number(process.env.PROSPECTING_GLOBAL_CONCURRENCY??1);
  const row=(await workerPool().query('SELECT * FROM app.claim_prospecting_job($1,$2,$3)',[workerId,Number.isInteger(limit)&&limit>=1&&limit<=32?limit:1,workspaceId??null])).rows[0];
  return row?{workspaceId:row.workspace_id,jobId:row.job_id,actorId:row.actor_id,token:row.token,expiresAt:new Date(row.expires_at).toISOString(),fence:Number(row.fence)}:null;
}
export async function heartbeat(lease:JobLease){return Boolean((await workerPool().query('SELECT app.heartbeat_prospecting_job($1,$2,$3) AS alive',[lease.jobId,lease.token,lease.fence])).rows[0].alive);}
