import {randomUUID} from 'node:crypto';
import type {JobLease} from '../../domain/prospecting.ts';
import type {GenerationAdapters} from './steps.ts';
import type {QualificationAdapters} from './qualification.ts';
import {claimJob,heartbeat} from './lease.ts';
import {readLeasedJob} from './journal.ts';
import {runGeneration,runQualification} from './steps.ts';
import {withLeasedTransaction,workerPool} from './worker-db.ts';
import {withContextTransaction} from '../db/transaction.ts';
import {prospectingConfig} from './config.ts';
import {providerContext} from './steps.ts';
import {ApifyAdapter} from './providers/apify.ts';
import {runPlanning,type PlanningAdapters} from '../planning/execution.ts';
import {resolveCompanyPeople} from '../research/people.ts';
import {runCompanyResearch} from '../research/company.ts';
import type {ResearchAdapters} from '../../domain/company-research.ts';
import type {PeopleAdapters} from '../../domain/company-people.ts';
import {advanceJourney,advancePendingJourney} from '../research/journey.ts';
import {AppError} from '../errors.ts';
import {WaitingCapacity} from './usage.ts';
import {siteBrowserUnavailable} from './site-browser.ts';
type WorkerAdapters=GenerationAdapters&QualificationAdapters&PlanningAdapters&{research?:ResearchAdapters;people?:PeopleAdapters};
async function cleanRevoked(deps:GenerationAdapters,signal:AbortSignal,workspaceId?:string){
  const ticket=(await workerPool().query('SELECT app.claim_revoked_prospecting_cleanup($1) AS ticket',[workspaceId??null])).rows[0].ticket;
  if(!ticket)return false;
  const source=ticket.execution?.siteCrawler?.actor===ticket.run.profileId?'CRAWL':(['MAPS','WEB','CNPJ'] as const).find(s=>ticket.execution?.profiles?.[s]?.actor===ticket.run.profileId);
  if(!source)return false;
  let done=false;
  try{const ctx=providerContext({checkpoint:{execution:ticket.execution}},source,ticket.run.operationId,signal);const result=await(deps.apify??new ApifyAdapter()).abort(ctx,ticket.run);done=['cancelled','failed','succeeded'].includes(result.status);}catch{}
  await workerPool().query('SELECT app.ack_revoked_prospecting_cleanup($1,$2,$3,$4,$5)',[ticket.jobId,ticket.token,ticket.fence,ticket.run.runId,done]);return true;
}
export async function runWorkerOnce(deps:WorkerAdapters={},options:{workerId?:string;signal:AbortSignal;workspaceId?:string}):Promise<boolean>{
  if(await cleanRevoked(deps,options.signal,options.workspaceId))return true;
  if(!prospectingConfig().enabled)return false;
  if(await advancePendingJourney(options.workspaceId,false))return true;
  const lease=await claimJob(options.workerId??randomUUID(),options.workspaceId);if(!lease)return false;
  await runLeasedJob(lease,deps,options.signal);
  return true;
}
export async function runLeasedJob(lease:JobLease,deps:WorkerAdapters,shutdown:AbortSignal){
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,shutdown]);let checking=Promise.resolve();
  const timer=setInterval(()=>{checking=checking.then(async()=>{if(!await heartbeat(lease))controller.abort();}).catch(()=>controller.abort());},10000);
  try{
    const job=await readLeasedJob(lease);
    if(job.error_code==='WAITING_SITE_BROWSER')await withLeasedTransaction(lease,c=>c.query(
      'UPDATE app.prospecting_job SET error_code=NULL,error_message=NULL,revision=revision+1 WHERE id=$1',[lease.jobId]));
    switch(job.kind){
      case 'generation':await runGeneration(lease,{...deps,signal});break;
      case 'qualification':if(job.input?.companyPeople)await resolveCompanyPeople(lease,{...deps.people,apify:deps.people?.apify??deps.apify,generate:deps.people?.generate??deps.decisors,signal});else if(job.input?.companyResearch)await runCompanyResearch(lease,{...deps.research,apify:deps.research?.apify??deps.apify,signal});else await runQualification(lease,{...deps,signal});break;
      case 'planning':await runPlanning(lease,{...deps,generate:deps.planningGenerate,signal});break;
      default:throw Error('INVALID_JOB_KIND');
    }
    if(job.checkpoint?.journey)await advanceJourney(lease,false);
  }catch(error){
    if(error instanceof WaitingCapacity||siteBrowserUnavailable(error)){
      const retry=error instanceof WaitingCapacity
        ?{seconds:60,code:error.code,message:error.message}
        :{seconds:30,code:'WAITING_SITE_BROWSER',message:'A execução será retomada quando o navegador de coleta voltar.'};
      await withContextTransaction(workerPool(),{workspaceId:lease.workspaceId,userId:lease.actorId,role:'operator',sessionId:'worker'},c=>c.query(
        "UPDATE app.prospecting_job SET capacity_retry_at=clock_timestamp()+make_interval(secs=>$6),error_code=$4,error_message=$5,revision=revision+1,updated_at=now() WHERE id=$1 AND lease_token=$2 AND fence=$3 AND lease_until>clock_timestamp() AND state IN('running','waiting_provider')",
        [lease.jobId,lease.token,lease.fence,retry.code,retry.message,retry.seconds]));
    }else if(error instanceof AppError&&error.code==='JOURNEY_CHANGED')await advanceJourney(lease,false).catch(()=>{});
    // Other fencing or revocation keeps the durable journal.
  }
  finally{
    clearInterval(timer);await checking;
    try{await withContextTransaction(workerPool(),{workspaceId:lease.workspaceId,userId:lease.actorId,role:'operator',sessionId:'worker'},c=>c.query('UPDATE app.prospecting_job SET lease_until=now() WHERE id=$1 AND lease_token=$2 AND fence=$3',[lease.jobId,lease.token,lease.fence]));}catch{}
  }
}
