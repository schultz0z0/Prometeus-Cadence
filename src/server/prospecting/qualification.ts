import type {JobLease,JobInput,Evidence,ModuleResult,Decision,Generation,ProviderUsage} from '../../domain/prospecting.ts';
import type {Lead,CompanyProfile} from '../../domain/model.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {readLeasedJob,finishJob,performStep,handleStepFailure} from './journal.ts';
import {recordModuleResult} from './results.ts';
import {saveEvidence} from './evidence.ts';
import {fetchEvidencePack} from './extraction/fetch-page.ts';
import {extractContacts,checkEmailDns} from './extraction/contacts.ts';
import {chooseNextModule,suggestedQualification} from './ai/policy.ts';
import {decide} from './ai/jev.ts';
import {generate} from './ai/codex.ts';
import {hashValue} from './review.ts';
import {ApifyAdapter} from './providers/apify.ts';
import type {SourceAdapter} from './providers/types.ts';
import {providerContext} from './steps.ts';
import {ProviderError} from './providers/transport.ts';
import {AppError} from '../errors.ts';
import {runConventional,conventionalUnit} from './ai/conventional.ts';
import {assertAiRouteCurrent} from './ai/route-guard.ts';
import {diagnoseCodex} from './ai/diagnostics.ts';
import {recordConnectionCheck} from './ai/connection.ts';
import type {AiRoute} from '../../domain/ai-routing.ts';
import {syncOccurrenceJob} from '../automations/assignments.ts';
export interface QualificationAdapters{
  signal?:AbortSignal;apify?:SourceAdapter;conventional?:typeof runConventional;diagnose?:typeof diagnoseCodex;
  collect?:typeof fetchEvidencePack;
  decide?:typeof decide;generate?:typeof generate;
}
async function collectEvidence(lease:JobLease,job:any,lead:Lead,deep:boolean,deps:QualificationAdapters):Promise<Evidence[]>{
  return performStep(lease,'evidence:'+lead.id+':'+deep,'public-web',{},async()=>{
    if(!lead.site)return[];
    const pages=job.checkpoint.purpose==='ai-connection-test'?[{id:'connection-sample',url:'https://example.com/',fetchedAt:new Date().toISOString(),text:'Evidência sintética de teste: clínica odontológica fictícia com consultas e ortodontia. Não representa uma empresa real.',hash:hashValue('connection-sample-v1'),truncated:false}]:await (deps.collect??fetchEvidencePack)(lead.site,{signal:deps.signal??new AbortController().signal},deep);
    return withLeasedTransaction(lease,async c=>{
      const ids=await saveEvidence(c,lease.jobId,lead.id,pages);
      return pages.slice(0,ids.length).map((e,i)=>({...e,id:ids[i]}));
    });
  });
}
async function sourceResult(lease:JobLease,job:any,lead:Lead,module:'registry'|'website',deps:QualificationAdapters){
  const source=module==='registry'?'CNPJ':'WEB',step=module+':'+lead.id;
  const ctx=providerContext(job,source,hashValue({job:lease.jobId,step}),deps.signal??new AbortController().signal),adapter=deps.apify??new ApifyAdapter();
  const input:Extract<JobInput,{kind:'generation'}>={kind:'generation',source,destination:{mode:'existing',listId:lead.listId},filters:module==='registry'?{term:lead.name,cnpj:lead.cnpj!}:{term:lead.name,location:[lead.city,lead.state].filter(Boolean).join(', ')||'Brasil'},limit:1,dedupScope:'workspace'};
  const started=await performStep(lease,step,'apify',{apifyRuns:1},()=>adapter.start(ctx,input),r=>({provider:'apify',operationId:ctx.operationId,units:r.kind==='uncertain'?{}:{apifyRuns:1},costUsd:null,costKind:'unknown'}));
  if(started.kind==='uncertain'){await finishJob(lease,'needs_reconciliation','START_UNCERTAIN');return null;}
  if(started.kind==='inline')return started.page.candidates[0]??{};
  const remote=await adapter.poll(ctx,started.run);if(['failed','cancelled'].includes(remote.status))throw new ProviderError('REMOTE_FAILED');
  if(remote.status!=='succeeded')return null;
  return(await adapter.readPage(ctx,remote.run,null,1)).candidates[0]??{};
}
export async function runQualification(lease:JobLease,deps:QualificationAdapters={}){
  const job=await readLeasedJob(lease),input=job.input as JobInput;
  if(input.kind!=='qualification')throw Error('INVALID_JOB_KIND');
  let current:{leadId:string;module:ModuleResult['module']}|undefined;
  try{
    if(job.state==='cancelling'){
      const unknown=await withLeasedTransaction(lease,async c=>(await c.query("SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND (state IN('prepared','uncertain') OR payload->'result'->>'kind'='uncertain') LIMIT 1",[lease.jobId])).rowCount);
      if(unknown){await finishJob(lease,'needs_reconciliation','CANCEL_UNCERTAIN');return;}
      const starts=await withLeasedTransaction(lease,async c=>(await c.query("SELECT payload FROM app.prospecting_attempt WHERE job_id=$1 AND provider='apify' AND state='completed'",[lease.jobId])).rows);
      let pending=false;
      for(const row of starts){const run=row.payload.result?.run;if(run){const source=row.payload.result.run.profileId===job.checkpoint.execution.profiles.WEB.actor?'WEB':'CNPJ';const state=await(deps.apify??new ApifyAdapter()).abort(providerContext(job,source,run.operationId,deps.signal??new AbortController().signal),run);if(!['cancelled','failed','succeeded'].includes(state.status))pending=true;}}
      if(!pending)await finishJob(lease,'cancelled');return;
    }
    for(const leadId of input.leadIds){
      const prior:ModuleResult[]=await withLeasedTransaction(lease,async c=>(await c.query('SELECT payload FROM app.prospecting_item WHERE job_id=$1 AND lead_id=$2',[lease.jobId,leadId])).rows[0]?.payload.results??[]);
      const module=chooseNextModule(input,prior);if(!module)continue;
      current={leadId,module};
      const base=job.checkpoint.bases[leadId] as Lead;
      const lead={...base,...Object.assign({},...prior.map(r=>r.proposed))} as Lead;
      const result:ModuleResult={module,status:'pending_review',proposed:{},base:{},reasons:[],evidenceIds:[],usage:null,contextVersion:job.checkpoint.context?.version??0};
      if(module==='summary'&&input.summaryPolicy==='fits'&&!prior.some(r=>r.module==='qualify'&&r.proposed.qualification==='qualified')){result.status='skipped';result.reasons=['SUMMARY_REQUIRES_FIT'];}
      else if(module==='registry'||module==='website'){
        if(module==='registry'&&!lead.cnpj){result.status='skipped';result.reasons=['NO_CNPJ'];}
        else if(module==='website'&&lead.site){result.status='skipped';result.reasons=['ALREADY_HAS_SITE'];}
        else{const source=await sourceResult(lease,job,lead,module,deps);if(source===null)return;
          result.evidenceIds=await withLeasedTransaction(lease,c=>saveEvidence(c,lease.jobId,lead.id,'evidence' in source?source.evidence??[]:[]));
          for(const key of (module==='website'?['site']:['cnpj','companyName','city','state']) as (keyof Lead)[])if(source[key as keyof typeof source])Object.assign(result.proposed,{[key]:source[key as keyof typeof source]});if(!Object.keys(result.proposed).length){result.status='skipped';result.reasons=['NO_RESULT'];}}
      }else if(module==='validateEmail'){
        const validation=lead.email?await checkEmailDns(lead.email):null;result.status='succeeded';result.reasons=[!validation?'NO_EMAIL':validation.format?'FORMAT_VALID':'FORMAT_INVALID',validation?.dns===true?'MAIL_DOMAIN_FOUND':'MAIL_DOMAIN_UNKNOWN','MAILBOX_NOT_VERIFIED'];
      }else{
        const evidence=await collectEvidence(lease,job,lead,input.modules.includes('deep'),deps);result.evidenceIds=evidence.map(e=>e.id);
        if(!evidence.length){result.status='skipped';result.reasons=['NO_EVIDENCE'];}
        else if(module==='deep'){result.status='succeeded';result.reasons=['PUBLIC_PAGES_ONLY'];}
        else if(module==='email'||module==='phone'){
          const facts=extractContacts(evidence),value=module==='email'?facts.emails[0]:facts.phones[0];
          if(value)result.proposed={[module]:value};else{result.status='skipped';result.reasons=['CONTACT_NOT_FOUND'];}
        }else{
          const context=job.checkpoint.context as CompanyProfile|null,criteria=JSON.stringify({offer:context?.offer,idealCustomer:context?.idealCustomer,products:context?.products,pains:context?.pains,customCriteria:job.checkpoint.automation?.qualificationCriteria,product:job.checkpoint.product});
          const aiRoute=job.checkpoint.execution?.aiRoute as AiRoute|undefined;
          const cacheKey=hashValue({aiRoute,contract:'jev-decisions-v1',model:'typesafe/jev-1.13',criteria,evidence:evidence.map(e=>e.hash),facts:{name:lead.name,cnpj:lead.cnpj}});
          if(module==='qualify'&&aiRoute?.decisionProvider!=='jev'&&aiRoute){
            const classified=await conventionalStep(lease,job,leadId,'qualify',criteria,evidence,deps);
            if(classified.task!=='qualify')throw Error('INVALID_TASK');result.decision=classified.decision;result.usage=classified.decision.usage;result.proposed={qualification:suggestedQualification(classified.decision),reason:classified.reason};result.reasons=['UNCALIBRATED_SUGGESTION','CONVENTIONAL_EVIDENCE_REVIEW'];
          }else if(module==='qualify'){
            const cached=await withLeasedTransaction(lease,async c=>(await c.query('SELECT payload FROM app.prospecting_cache WHERE key=$1 AND created_at>now()-interval \'1 day\'',[cacheKey])).rows[0]?.payload as Decision|undefined);
            const decision=cached?{...cached,evidenceIds:evidence.map(e=>e.id),usage:{...cached.usage,operationId:hashValue({job:lease.jobId,leadId,module}),units:{},costUsd:null,costKind:'unknown' as const}}:await performStep(lease,module+':'+leadId,'openrouter',{jevCalls:1},async()=>{await preflight(lease,job,deps,true);return (deps.decide??decide)({operationId:hashValue({job:lease.jobId,leadId,module}),signal:deps.signal??new AbortController().signal,credential:process.env.OPENROUTER_API_KEY??''},{criteria,evidence,facts:{name:lead.name,cnpj:lead.cnpj}});},r=>r.usage);
            if(!cached)await withLeasedTransaction(lease,c=>c.query("INSERT INTO app.prospecting_cache VALUES(current_setting('app.workspace_id'),$1,$2,now()) ON CONFLICT(workspace_id,key) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()",[cacheKey,decision]));
            result.decision=decision;result.proposed={qualification:suggestedQualification(decision)};result.reasons=['UNCALIBRATED_SUGGESTION','CONFIDENCE_IS_NOT_ACCURACY'];
            if(input.escalation==='ambiguous'&&suggestedQualification(decision)!=='pending'&&decision.confidence!==null&&decision.confidence<0.7){
              const opinion=await generateStep(lease,job,leadId,'second_opinion',criteria,evidence,deps);result.proposed.reason=opinion.summary;result.reasons.push('SECOND_OPINION_REVIEW_REQUIRED');
            }
          }else if(module==='summary'){
            const generated=await generateStep(lease,job,leadId,'summary',criteria,evidence,deps);result.proposed={summary:generated.summary};result.evidenceIds=generated.evidenceIds;
          }
        }
      }
      for(const key of Object.keys(result.proposed) as (keyof Lead)[])Object.assign(result.base,{[key]:base[key]??null});
      await withLeasedTransaction(lease,c=>recordModuleResult(c,lease,leadId,result));
      return;
    }
    await withLeasedTransaction(lease,async c=>{
      const rows=(await c.query('SELECT payload FROM app.prospecting_item WHERE job_id=$1',[lease.jobId])).rows;
      const failed=rows.some(r=>r.payload.results.some((m:ModuleResult)=>m.status==='failed'));
      if(job.checkpoint.purpose==='ai-connection-test'&&!failed&&rows.some(r=>r.payload.results.some((m:ModuleResult)=>m.module==='summary'&&m.status==='pending_review'&&m.proposed.summary))){
        // Use the durable attempt start conservatively, never the resume time.
        const attempt=(await c.query("SELECT created_at FROM app.prospecting_attempt WHERE job_id=$1 AND step=$2 AND state='completed'",[lease.jobId,'summary:'+input.leadIds[0]])).rows[0];
        if(attempt)await recordConnectionCheck(c,lease,{operationId:lease.jobId+':probe',route:job.checkpoint.execution.aiRoute.conventional,outcome:'success',checkedAt:new Date(attempt.created_at).toISOString()});
      }
      await c.query('UPDATE app.prospecting_job SET counts=$2 WHERE id=$1',[lease.jobId,{found:input.leadIds.length,inserted:0,duplicates:0,rejected:0,pending:rows.length}]);
      await c.query('UPDATE app.prospecting_job SET state=$2,revision=revision+1,updated_at=now() WHERE id=$1',[lease.jobId,failed?'partial':'completed']);
      const {releaseUnused}=await import('./usage.ts');await releaseUnused(c,lease.jobId);
      if(job.checkpoint.automation)await syncOccurrenceJob(c,job.checkpoint.automation.occurrenceId);
    });
  }catch(error){
    if(current&&!(error instanceof AppError)&&!(error instanceof Error&&error.constructor.name==='UncertainStep')){
      await withLeasedTransaction(lease,c=>recordModuleResult(c,lease,current!.leadId,{module:current!.module,status:'failed',proposed:{},base:{},reasons:[error instanceof ProviderError?error.code:'MODULE_FAILED'],evidenceIds:[],usage:null,contextVersion:job.checkpoint.context?.version??0}));return;
    }
    await handleStepFailure(lease,error);
  }
}
async function preflight(lease:JobLease,job:any,deps:QualificationAdapters,jev=false,freshOperationId?:string){
 await withLeasedTransaction(lease,c=>assertAiRouteCurrent(c,job,freshOperationId));
 const route=job.checkpoint.execution.aiRoute as AiRoute;
 if(jev&&route.conventional.provider==='codex-local'){
  const diagnostic=await(deps.diagnose??diagnoseCodex)();
  if(!diagnostic.authenticated)throw new AppError(409,'O Codex local precisa de autenticação ChatGPT.','AI_COMPANION_UNAVAILABLE');
  await withLeasedTransaction(lease,c=>assertAiRouteCurrent(c,job));
 }
}
async function conventionalStep(lease:JobLease,job:any,leadId:string,task:'qualify'|'summary'|'second_opinion',criteria:string,evidence:Evidence[],deps:QualificationAdapters){
 const route=(job.checkpoint.execution.aiRoute as AiRoute).conventional,step=task+':'+leadId,operationId=hashValue({job:lease.jobId,step});
 const slot=(release:boolean)=>withLeasedTransaction(lease,async c=>Boolean((await c.query('SELECT app.codex_prospecting_slot($1,$2,$3,$4) AS ok',[lease.jobId,lease.token,lease.fence,release])).rows[0].ok));
 return performStep(lease,step,route.provider==='codex-local'?'codex':route.provider,{[conventionalUnit(route.provider)]:1},async()=>{
  // This callback runs only for a newly prepared intent, never journal replay.
  await preflight(lease,job,deps,false,operationId);
  try{return await(deps.conventional??runConventional)({operationId,workspaceId:lease.workspaceId,signal:deps.signal??new AbortController().signal,route,acquireSlot:()=>slot(false),releaseSlot:async()=>{await slot(true);}},{task,criteria,evidence,facts:{name:job.checkpoint.bases[leadId].name}});}
  catch(error){await withLeasedTransaction(lease,c=>recordConnectionCheck(c,lease,{operationId,route,outcome:error instanceof ProviderError&&error.uncertain?'uncertain':'failed',code:error instanceof ProviderError?error.code:'CONVENTIONAL_FAILED'}));throw error;}
 },r=>r.task==='qualify'?r.decision.usage:r.generation.usage);
}
async function generateStep(lease:JobLease,job:any,leadId:string,task:'summary'|'second_opinion',criteria:string,evidence:Evidence[],deps:QualificationAdapters):Promise<Generation>{
 const result=await conventionalStep(lease,job,leadId,task,criteria,evidence,deps);if(result.task==='qualify')throw Error('INVALID_TASK');return result.generation;
}
