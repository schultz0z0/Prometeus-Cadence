import type {JobLease,RemoteRun,JobInput} from '../../domain/prospecting.ts';
import type {SourceAdapter,ProviderContext} from './providers/types.ts';
import {ApifyAdapter} from './providers/apify.ts';
import {ApolloAdapter} from './providers/apollo.ts';
import {providerProfile} from './providers/profiles.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {readLeasedJob,performStep,finishJob,handleStepFailure,UncertainStep} from './journal.ts';
import {ingestPage} from './ingestion.ts';
import {ProviderError} from './providers/transport.ts';
export {runQualification} from './qualification.ts';
export interface GenerationAdapters{apify?:SourceAdapter;apollo?:ApolloAdapter;signal?:AbortSignal}
export function providerContext(job:any,source:'MAPS'|'WEB'|'CNPJ'|'APOLLO',operationId:string,signal:AbortSignal):ProviderContext{
  const execution=job.checkpoint.execution;
  return{operationId,signal,profile:providerProfile(source,source==='APOLLO'?undefined:execution?.profiles?.[source]),credential:source==='APOLLO'?process.env.APOLLO_API_KEY??'':process.env.APIFY_TOKEN??'',maxChargeUsd:execution?.maxChargeUsd??0,maxPages:execution?.maxPages??0};
}
export async function runGeneration(lease:JobLease,adapters:GenerationAdapters={}){
  const job=await readLeasedJob(lease),input=job.input as JobInput;
  if(input.kind!=='generation')throw Error('INVALID_JOB_KIND');
  const ctx=providerContext(job,input.source,lease.jobId+':start',adapters.signal??new AbortController().signal),apify=adapters.apify??new ApifyAdapter();
  try{
    let run=job.provider_run as RemoteRun|null;
    if(job.state==='cancelling'){
      if(run){const remote=await apify.abort(ctx,run);if(!['cancelled','failed','succeeded'].includes(remote.status))return;}
      else if((await withLeasedTransaction(lease,c=>c.query('SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1',[lease.jobId]))).rowCount){await finishJob(lease,'needs_reconciliation','CANCEL_UNCERTAIN');return;}
      await finishJob(lease,'cancelled');return;
    }
    if(job.checkpoint.exhausted===true||job.counts.found>=input.limit){await finishJob(lease,'completed');return;}
    if(input.source==='APOLLO'){
      const pageNo=Number(job.checkpoint.cursor??1),apollo=adapters.apollo??new ApolloAdapter();
      const page=await performStep(lease,'apollo-page:'+pageNo,'apollo',{apolloPages:1},()=>apollo.search(ctx,input,pageNo));
      await withLeasedTransaction(lease,c=>ingestPage(c,lease,page));
      if(page.exhausted||job.counts.found+page.rawCount>=input.limit)await finishJob(lease,'completed');return;
    }
    if(!run){
      const started=await performStep(lease,'start','apify',{apifyRuns:1},()=>apify.start(ctx,input),result=>({provider:'apify',operationId:ctx.operationId,units:result.kind==='uncertain'?{}:{apifyRuns:1},costUsd:null,costKind:'unknown'}));
      if(started.kind==='uncertain'){await finishJob(lease,'needs_reconciliation','START_UNCERTAIN');return;}
      if(started.kind==='inline'){await withLeasedTransaction(lease,c=>ingestPage(c,lease,started.page));if(started.page.exhausted)await finishJob(lease,'completed');return;}
      run=started.run;await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_job SET provider_run=$2,state=CASE WHEN state='cancelling' THEN state ELSE 'waiting_provider' END WHERE id=$1",[lease.jobId,run]));
    }
    const state=await apify.poll(ctx,run);
    if(['failed','cancelled'].includes(state.status))throw new ProviderError('REMOTE_'+state.status.toUpperCase());
    await withLeasedTransaction(lease,c=>c.query('UPDATE app.prospecting_job SET provider_run=$2 WHERE id=$1',[lease.jobId,state.run]));
    if(state.status!=='succeeded')return;
    const remaining=input.limit-job.counts.found;if(remaining<=0){await finishJob(lease,'completed');return;}
    const page=await apify.readPage(ctx,state.run,job.checkpoint.cursor??null,Math.min(100,remaining));
    await withLeasedTransaction(lease,c=>ingestPage(c,lease,page));
    if(page.exhausted||page.rawCount>=remaining)await finishJob(lease,'completed');
  }catch(error){await handleStepFailure(lease,error);}
}
