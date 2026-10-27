import {randomUUID} from 'node:crypto';
import type {GenerationAdapters} from './steps.ts';
import type {QualificationAdapters} from './qualification.ts';
import {claimJob,heartbeat} from './lease.ts';
import {readLeasedJob} from './journal.ts';
import {runGeneration,runQualification} from './steps.ts';
import {workerPool} from './worker-db.ts';
import {withContextTransaction} from '../db/transaction.ts';
import {prospectingConfig} from './config.ts';
import {providerContext} from './steps.ts';
import {ApifyAdapter} from './providers/apify.ts';
import {runPlanning,type PlanningAdapters} from '../planning/execution.ts';
import {runCompanyResearch} from '../research/company.ts';
import type {ResearchAdapters} from '../../domain/company-research.ts';
async function cleanRevoked(deps:GenerationAdapters,signal:AbortSignal,workspaceId?:string){
  const ticket=(await workerPool().query('SELECT app.claim_revoked_prospecting_cleanup($1) AS ticket',[workspaceId??null])).rows[0].ticket;
  if(!ticket)return false;
  const source=(['MAPS','WEB','CNPJ'] as const).find(s=>ticket.execution?.profiles?.[s]?.actor===ticket.run.profileId);
  if(!source)return false;
  let done=false;
  try{const ctx=providerContext({checkpoint:{execution:ticket.execution}},source,ticket.run.operationId,signal);const result=await(deps.apify??new ApifyAdapter()).abort(ctx,ticket.run);done=['cancelled','failed','succeeded'].includes(result.status);}catch{}
  await workerPool().query('SELECT app.ack_revoked_prospecting_cleanup($1,$2,$3,$4,$5)',[ticket.jobId,ticket.token,ticket.fence,ticket.run.runId,done]);return true;
}
export async function runWorkerOnce(deps:GenerationAdapters&QualificationAdapters&PlanningAdapters&{research?:ResearchAdapters}={},options:{workerId?:string;signal:AbortSignal;workspaceId?:string}):Promise<boolean>{
  if(await cleanRevoked(deps,options.signal,options.workspaceId))return true;
  if(!prospectingConfig().enabled)return false;
  const lease=await claimJob(options.workerId??randomUUID(),options.workspaceId);if(!lease)return false;
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,options.signal]);let checking=Promise.resolve();
  const timer=setInterval(()=>{checking=checking.then(async()=>{if(!await heartbeat(lease))controller.abort();}).catch(()=>controller.abort());},10000);
  try{
    const job=await readLeasedJob(lease);
    switch(job.kind){
      case 'generation':await runGeneration(lease,{...deps,signal});break;
      case 'qualification':if(job.input?.companyResearch)await runCompanyResearch(lease,{...deps.research,apify:deps.research?.apify??deps.apify,signal});else await runQualification(lease,{...deps,signal});break;
      case 'planning':await runPlanning(lease,{...deps,generate:deps.planningGenerate,signal});break;
      default:throw Error('INVALID_JOB_KIND');
    }
  }catch{ /* Fencing/revocation leaves the durable journal for reconciliation. */ }
  finally{
    clearInterval(timer);await checking;
    try{await withContextTransaction(workerPool(),{workspaceId:lease.workspaceId,userId:lease.actorId,role:'operator',sessionId:'worker'},c=>c.query('UPDATE app.prospecting_job SET lease_until=now() WHERE id=$1 AND lease_token=$2 AND fence=$3',[lease.jobId,lease.token,lease.fence]));}catch{}
  }return true;
}
