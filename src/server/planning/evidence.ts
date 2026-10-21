import 'server-only';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {JobLease} from '../../domain/prospecting.ts';
import type {PlanningEvidence} from '../../domain/planning.ts';
import {assertJobLease} from '../prospecting/repository.ts';
import {hashValue} from '../prospecting/review.ts';
import {AppError} from '../errors.ts';
import {planningEvidenceSchema} from './contracts.ts';
export async function planningWriteLease(c:PoolClient,lease:JobLease){
 await assertJobLease(c,lease);
 const row=(await c.query("SELECT 1 FROM app.prospecting_job WHERE id=$1 AND kind='planning'",[lease.jobId])).rows[0];
 if(!row)throw new AppError(409,'Esta execução não é uma análise de planejamento.');
 await c.query("SELECT set_config('app.planning_lease_token',$1,true),set_config('app.planning_lease_fence',$2,true)",[lease.token,String(lease.fence)]);
}
export async function savePlanningEvidence(c:PoolClient,lease:JobLease,sources:PlanningEvidence[]):Promise<PlanningEvidence[]>{
 await planningWriteLease(c,lease);
 if(sources.length>20||new Set(sources.map(s=>s.id)).size!==sources.length||sources.filter(s=>s.kind==='public_page').length>3)throw new AppError(422,'Fontes inválidas.');
 const result:PlanningEvidence[]=[];
 for(const source of sources){
  const hash=hashValue(source),old=(await c.query('SELECT body_hash,payload FROM app.planning_evidence WHERE job_id=$1 AND id=$2',[lease.jobId,source.id])).rows[0];
  if(old){if(old.body_hash!==hash)throw new AppError(409,'A fonte já foi registrada com outro conteúdo.');result.push(old.payload);continue;}
  const parsed=planningEvidenceSchema.safeParse(source);
  if(!parsed.success||source.hash!==createHash('sha256').update(source.text).digest('hex'))throw new AppError(422,'Fonte inválida ou hash divergente.');
  await c.query('INSERT INTO app.planning_evidence(workspace_id,job_id,id,body_hash,payload) VALUES($1,$2,$3,$4,$5)',[lease.workspaceId,lease.jobId,source.id,hash,source]);
  result.push(source);
 }
 return result;
}
