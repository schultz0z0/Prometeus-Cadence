import 'server-only';
import type {PoolClient} from 'pg';
import type {JobLease} from '../../domain/prospecting.ts';
import type {PlanningProposal,PlanningEvidence} from '../../domain/planning.ts';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {hashValue} from '../prospecting/review.ts';
import {planningWriteLease} from './evidence.ts';
import {validatePlanningResult} from './contracts.ts';
export async function savePlanningProposal(c:PoolClient,lease:JobLease,proposal:PlanningProposal):Promise<void>{
 await planningWriteLease(c,lease);
 const hash=hashValue(proposal),old=(await c.query('SELECT body_hash FROM app.planning_proposal WHERE job_id=$1',[lease.jobId])).rows[0];
 if(old){if(old.body_hash!==hash)throw new AppError(409,'Uma proposta diferente já foi registrada.');return;}
 const job=(await c.query('SELECT input FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0];
 const sources:PlanningEvidence[]=(await c.query('SELECT payload FROM app.planning_evidence WHERE job_id=$1',[lease.jobId])).rows.map(r=>r.payload);
 const {task,contractVersion,jobId,base,evidenceIds,recommendedOptionId,...content}=proposal;
 const value=task==='message_preview'?{...content,evidenceIds}:content;
 if(jobId!==lease.jobId||task!==job.input.task||contractVersion!=='planning-v1'||!base||!Number.isInteger(base.contextVersion)||!Number.isInteger(base.workspaceRevision)||!(base.productVersion===null||Number.isInteger(base.productVersion))||!Array.isArray(evidenceIds)||evidenceIds.some(id=>!sources.some(s=>s.id===id))||!validatePlanningResult(task,value,sources).success)throw new AppError(422,'Proposta inválida ou sem fontes deste job.');
 if(recommendedOptionId!==null&&(!('options' in proposal)||!proposal.options.some(o=>o.id===recommendedOptionId)))throw new AppError(422,'Recomendação inválida.');
 await c.query('INSERT INTO app.planning_proposal(workspace_id,job_id,body_hash,payload) VALUES($1,$2,$3,$4)',[lease.workspaceId,lease.jobId,hash,proposal]);
}
export async function readPlanningProposal(p:Principal,jobId:string):Promise<PlanningProposal>{return withWorkspaceTransaction(p,async c=>{
 const row=(await c.query('SELECT payload FROM app.planning_proposal WHERE job_id=$1',[jobId])).rows[0];
 if(!row)throw new AppError(404,'Proposta não encontrada.');
 const proposal=row.payload as PlanningProposal;
 const assessment=(await c.query("SELECT payload FROM app.prospecting_attempt WHERE job_id=$1 AND step='planning:rank' AND state='completed'",[jobId])).rows[0]?.payload?.result;
 const recommendedOptionId=assessment?.recommendedOptionId;
 if(recommendedOptionId&&'options' in proposal&&proposal.options.some(o=>o.id===recommendedOptionId))return {...proposal,recommendedOptionId};
 return proposal;
});}
