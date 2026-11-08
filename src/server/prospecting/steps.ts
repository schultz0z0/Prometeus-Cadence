import type {JobLease,RemoteRun,JobInput} from '../../domain/prospecting.ts';
import type {SourceAdapter,ProviderContext} from './providers/types.ts';
import {ApifyAdapter} from './providers/apify.ts';
import {ApolloAdapter} from './providers/apollo.ts';
import {providerProfile} from './providers/profiles.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {readLeasedJob,performStep,finishJob,handleStepFailure,UncertainStep} from './journal.ts';
import {ingestPage} from './ingestion.ts';
import {ProviderError} from './providers/transport.ts';
import {hashValue} from './review.ts';
import {workerApolloKey} from '../integrations/connections.ts';
import {admitDiscoveryPage,markDiscoveryRunDone} from './discovery-admission.ts';
import type {QualificationAdapters} from './qualification.ts';
export {runQualification} from './qualification.ts';
export interface GenerationAdapters{apify?:SourceAdapter;apollo?:ApolloAdapter;signal?:AbortSignal;collect?:QualificationAdapters['collect']}
export function providerContext(job:any,source:'MAPS'|'WEB'|'CNPJ'|'APOLLO'|'CRAWL',operationId:string,signal:AbortSignal):ProviderContext{
  const execution=job.checkpoint.execution;
  if(source==='CRAWL')return{operationId,signal,profile:{source:'WEB',actor:execution.siteCrawler.actor,build:execution.siteCrawler.build,ppe:false},credential:process.env.APIFY_TOKEN??'',maxChargeUsd:execution.maxChargeUsd??0,maxPages:execution.siteCrawler.maxPages};
  return{operationId,signal,profile:providerProfile(source,source==='APOLLO'?undefined:execution?.profiles?.[source]),credential:source==='APOLLO'?process.env.APOLLO_API_KEY??'':process.env.APIFY_TOKEN??'',maxChargeUsd:execution?.maxChargeUsd??0,maxPages:execution?.maxPages??0};
}
export async function runGeneration(lease:JobLease,adapters:GenerationAdapters={}){
  const job=await readLeasedJob(lease),input=job.input as JobInput;
  if(input.kind!=='generation')throw Error('INVALID_JOB_KIND');
  const admission=job.checkpoint.discoveryScanLimit as number|undefined,scanLimit=admission??input.limit;
  const batch=Number(job.checkpoint.mapsBatch??0),startStep=batch?'start:'+batch:'start';
  const finishDiscovery=async(inserted:number,found=job.counts.found)=>{
    if(admission&&inserted<input.limit&&found<scanLimit&&batch===0){
      await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_job SET provider_run=NULL,state='running',checkpoint=checkpoint||'{\"mapsBatch\":1,\"cursor\":null,\"exhausted\":false}'::jsonb WHERE id=$1 AND state IN('running','waiting_provider')",[lease.jobId]));return;
    }
    await finishJob(lease,admission&&inserted<input.limit?'partial':'completed',admission&&inserted<input.limit?'VERIFIED_DISCOVERY_SHORTFALL':undefined);
  };
  const ctx=providerContext(job,input.source,lease.jobId+':'+startStep,adapters.signal??new AbortController().signal),apify=adapters.apify??new ApifyAdapter();
  try{
    let run=job.provider_run as RemoteRun|null;
    if(job.state==='cancelling'){
      if(admission){
        const pending=await withLeasedTransaction(lease,c=>c.query(
          "SELECT payload->'result'->'run' AS run FROM app.prospecting_attempt WHERE job_id=$1 AND provider='apify' AND payload->'result'->'run'->>'runId' IS NOT NULL AND NOT $2::jsonb ? (payload->'result'->'run'->>'runId') ORDER BY created_at LIMIT 1",
          [lease.jobId,JSON.stringify(job.checkpoint.cleanupDone??[])]));
        run=pending.rows[0]?.run??null;
      }
      if(run){
       const cleanupSource=admission&&run.profileId===job.checkpoint.execution?.siteCrawler?.actor?'CRAWL':(['WEB','CNPJ'] as const).find(source=>admission&&run!.profileId===job.checkpoint.execution?.profiles?.[source]?.actor)??input.source;
       const cleanupCtx=providerContext(job,cleanupSource,ctx.operationId,ctx.signal);
       const step='abort:'+run.runId,operation=hashValue({job:lease.jobId,step});
       const prior=await withLeasedTransaction(lease,async c=>{const existing=(await c.query('SELECT * FROM app.prospecting_attempt WHERE id=$1',[operation])).rows[0];if(existing)return existing;await c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,provider,step,state,payload) VALUES(current_setting('app.workspace_id'),$1,$2,'apify',$3,'prepared',$4)",[lease.jobId,operation,step,{reservedUnits:{},runId:run!.runId,cleanup:true,source:cleanupSource}]);return null;});
       if(prior&&prior.state!=='completed'){await finishJob(lease,'needs_reconciliation','ABORT_OUTCOME_UNKNOWN');return;}
       try{
        const remote=prior?['cancelled','failed','succeeded'].includes(prior.payload.result?.status)?{status:prior.payload.result.status}:await apify.poll(cleanupCtx,run):await apify.abort({...cleanupCtx,operationId:operation},run);
        const terminal=['cancelled','failed','succeeded'].includes(remote.status);
        await withLeasedTransaction(lease,async c=>{await c.query("UPDATE app.prospecting_attempt SET state='completed',payload=payload||$2::jsonb WHERE id=$1",[operation,{result:{status:remote.status}}]);if(terminal&&!admission)await c.query("UPDATE app.prospecting_job SET checkpoint=checkpoint||'{\"remoteTerminal\":true}'::jsonb WHERE id=$1",[lease.jobId]);});
        if(admission){if(terminal)await markDiscoveryRunDone(lease,run.runId);return;}
        if(!terminal)return;
       }catch{await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_attempt SET state='uncertain' WHERE id=$1",[operation]));throw new ProviderError('ABORT_OUTCOME_UNKNOWN',0,true);}
      }
      else if((await withLeasedTransaction(lease,c=>c.query("SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND(state IN('prepared','uncertain') OR payload->'result'->>'kind'='uncertain')",[lease.jobId]))).rowCount){await finishJob(lease,'needs_reconciliation','CANCEL_UNCERTAIN');return;}
      await finishJob(lease,'cancelled');return;
    }
    if(job.checkpoint.exhausted===true||job.counts.found>=scanLimit||(admission&&job.counts.inserted>=input.limit)){await finishDiscovery(job.counts.inserted);return;}
    if(input.source==='APOLLO'){
      const pageNo=Number(job.checkpoint.cursor??1),apollo=adapters.apollo??new ApolloAdapter();
      // A workspace connection supplies its own key, read for the reviewed revision just before the call: a revoked or replaced key stops here.
      const own=job.checkpoint.execution?.apolloConnection as {id:string;revision:number}|null|undefined;
      const page=await performStep(lease,'apollo-page:'+pageNo,'apollo',{apolloPages:1},async()=>{
        // Only a changed or revoked connection maps to CONNECTION_REVOKED; lost leases and timeouts keep their own handling.
        const credential=own?await withLeasedTransaction(lease,c=>workerApolloKey(c,lease.workspaceId,own)).catch(e=>{if(e instanceof Error&&e.message==='CONNECTION_CHANGED')throw new ProviderError('CONNECTION_REVOKED');throw e;})
          :job.checkpoint.execution?.apolloCredential==='central'?ctx.credential:(()=>{throw new ProviderError('CONNECTION_REQUIRED');})();
        return apollo.search({...ctx,credential},input,pageNo);
      });
      await withLeasedTransaction(lease,c=>ingestPage(c,lease,page));
      if(page.exhausted||job.counts.found+page.rawCount>=input.limit)await finishJob(lease,'completed');return;
    }
    if(!run){
      const batchInput={...input,limit:scanLimit-job.counts.found,...(batch?{filters:{...input.filters,term:input.filters.term+' '+(input.filters.location??'')}}:{})};
      const started=await performStep(lease,startStep,'apify',{apifyRuns:1},()=>apify.start(ctx,batchInput),result=>({provider:'apify',operationId:ctx.operationId,units:result.kind==='uncertain'?{}:{apifyRuns:1},costUsd:null,costKind:'unknown'}));
      if(started.kind==='uncertain'){await finishJob(lease,'needs_reconciliation','START_UNCERTAIN');return;}
      if(started.kind==='inline'){
        const page=admission?await admitDiscoveryPage(lease,job,started.page,{...adapters,signal:ctx.signal}):started.page;if(!page)return;
        const counts=await withLeasedTransaction(lease,c=>ingestPage(c,lease,page));
        if(page.exhausted||page.rawCount>=scanLimit-job.counts.found||job.counts.inserted+counts.inserted>=input.limit)await finishDiscovery(job.counts.inserted+counts.inserted,job.counts.found+page.rawCount);return;
      }
      run=started.run;await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_job SET provider_run=$2,state=CASE WHEN state='cancelling' THEN state ELSE 'waiting_provider' END WHERE id=$1",[lease.jobId,run]));
    }
    const state=await apify.poll(ctx,run);
    if(['failed','cancelled','succeeded'].includes(state.status)){
      if(admission)await markDiscoveryRunDone(lease,run.runId);
      else await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_job SET checkpoint=checkpoint||'{\"remoteTerminal\":true}'::jsonb WHERE id=$1",[lease.jobId]));
    }
    if(['failed','cancelled'].includes(state.status))throw new ProviderError('REMOTE_'+state.status.toUpperCase());
    await withLeasedTransaction(lease,c=>c.query('UPDATE app.prospecting_job SET provider_run=$2 WHERE id=$1',[lease.jobId,state.run]));
    if(state.status!=='succeeded')return;
    const remaining=scanLimit-job.counts.found;
    const raw=await apify.readPage(ctx,state.run,job.checkpoint.cursor??null,Math.min(admission?Math.min(5,input.limit-job.counts.inserted):100,remaining));
    const page=admission?await admitDiscoveryPage(lease,job,raw,{...adapters,signal:ctx.signal}):raw;if(!page)return;
    const counts=await withLeasedTransaction(lease,c=>ingestPage(c,lease,page));
    if(page.exhausted||page.rawCount>=remaining||(admission&&job.counts.inserted+counts.inserted>=input.limit))await finishDiscovery(job.counts.inserted+counts.inserted,job.counts.found+page.rawCount);
  }catch(error){await handleStepFailure(lease,error);}
}
