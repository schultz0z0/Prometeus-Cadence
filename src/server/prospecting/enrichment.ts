import type {JobLease,Evidence,Decision} from '../../domain/prospecting.ts';
import type {Lead} from '../../domain/model.ts';
import {validateDecisorEvidence,type Decisor,type EnrichmentResult} from '../../domain/enrichment.ts';
import {withLeasedTransaction} from './worker-db.ts';import {readLeasedJob,finishJob,performStep,handleStepFailure} from './journal.ts';
import {sourceResult,preflight,type QualificationAdapters} from './qualification.ts';
import {decide} from './ai/jev.ts';
import {providerContext} from './steps.ts';import {ApifyAdapter} from './providers/apify.ts';import {ProviderError} from './providers/transport.ts';
import {saveEvidence} from './evidence.ts';import {hashValue} from './review.ts';import {fetchEvidencePack} from './extraction/fetch-page.ts';
import {assertAiRouteCurrent} from './ai/route-guard.ts';import {conventionalUnit} from './ai/conventional.ts';import {generateDecisors} from './ai/decisors.ts';
import {qualificationFingerprint} from '../../domain/qualification-policy.ts';import {AppError} from '../errors.ts';
import type {EnrichmentCheckpoint,EnrichmentGroup} from './enrichment-context.ts';
import {prospectingConfig} from './config.ts';import {assertExecution} from '../billing/entitlements.ts';
export async function runEnrichment(lease:JobLease,deps:QualificationAdapters={}){
 const job=await readLeasedJob(lease),input=job.input;if(input.kind!=='qualification'||!input.enrichment||!job.checkpoint.enrichment)throw new AppError(409,'Revisão de enriquecimento indisponível.');
 try{
  if(job.state==='cancelling'){
   const unknown=await withLeasedTransaction(lease,async c=>(await c.query("SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND (state IN('prepared','uncertain') OR payload->'result'->>'kind'='uncertain') LIMIT 1",[lease.jobId])).rowCount);
   if(unknown){await finishJob(lease,'needs_reconciliation','CANCEL_UNCERTAIN');return;}
   if(!await cancelRemoteRuns(lease,job,deps))return;
   await finishJob(lease,'cancelled');return;
  }
  const checkpoint=job.checkpoint.enrichment as EnrichmentCheckpoint;
  const completed=await withLeasedTransaction(lease,async c=>(await c.query('SELECT source_ref,payload FROM app.prospecting_item WHERE job_id=$1',[lease.jobId])).rows);
  const done=new Set(completed.map(r=>r.source_ref));const group=checkpoint.groups.find(g=>!done.has(g.cnpj));
  if(!group){await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_job SET checkpoint=checkpoint||'{\"remoteTerminal\":true}'::jsonb,counts=$2 WHERE id=$1",[lease.jobId,{found:checkpoint.groups.length,inserted:job.counts.inserted,duplicates:0,rejected:completed.filter(r=>!r.payload.enrichment?.people?.length).length,pending:completed.filter(r=>r.payload.enrichment?.people?.length).length}]));await finishJob(lease,'completed');return;}
  const cache=await withLeasedTransaction(lease,async c=>(await c.query('SELECT * FROM app.enrichment_resolution WHERE cnpj=$1 AND contract=$2 AND expires_at>clock_timestamp() ORDER BY resolved_at DESC,id DESC LIMIT 1',[group.cnpj,checkpoint.contract])).rows[0]);
  if(cache){await record(lease,job,group,{cnpj:group.cnpj,people:cache.people,cacheId:cache.id,cached:true,charged:false,resolvedAt:new Date(cache.resolved_at).toISOString(),...(cache.assessment?{assessment:cache.assessment}:{})});return;}
  // A cache promised in the review cannot silently become a paid fresh lookup.
  const fresh=checkpoint.groups.filter(g=>!g.cacheId).slice(0,checkpoint.reserveCredits);
  if(group.cacheId||!fresh.some(g=>g.cnpj===group.cnpj)){await record(lease,job,group,null,group.cacheId?'CACHE_EXPIRED':'BUDGET_LIMIT');return;}
  const lead=job.checkpoint.bases[group.leadId] as Lead;
  const registry=await sourceResult(lease,job,lead,'registry',deps,{partners:true});if(registry===null)return;
  if(registry.cnpj&&registry.cnpj!==group.cnpj)throw new AppError(409,'A consulta não corresponde ao CNPJ revisado.','CNPJ_IDENTITY_MISMATCH');
  const names=Array.isArray(registry.facts?.decisionMakers)?registry.facts.decisionMakers.map((p:any)=>p.name).filter((n:any)=>typeof n==='string').slice(0,50):[];
  let site=lead.site;if(!site){const website=await sourceResult(lease,job,lead,'website',deps);if(website===null)return;site=website.site;}
  const linked=await sourceResult(lease,job,{...lead,name:[lead.companyName||lead.name,...names.slice(0,2),'diretor sócio contato site:linkedin.com/in/'].join(' ')},'website',deps,{suffix:'linkedin'});if(linked===null)return;
  const pages:Evidence[]=[...(registry.evidence??[]),...(linked.evidence??[])];
  const linkedProfile=linked.evidence?.find(e=>{try{const u=new URL(e.url);return u.protocol==='https:'&&!u.username&&!u.password&&/(^|\.)linkedin\.com$/.test(u.hostname)&&u.pathname.startsWith('/in/');}catch{return false;}})?.url;
  for(const [index,url]of [site,linkedProfile??linked.site].filter((u,i,a):u is string=>!!u&&a.indexOf(u)===i).entries()){
   const collected=await performStep(lease,'decisor-evidence:'+group.leadId+':'+index,'public-web',{},()=> (deps.collect??fetchEvidencePack)(url,{signal:deps.signal??new AbortController().signal},index===0));pages.push(...collected);
  }
  const unique=[...new Map(pages.slice(0,12).map(e=>[e.hash,{...e,text:e.text.slice(0,6000),truncated:e.truncated||e.text.length>6000}])).values()];
  const evidence=await withLeasedTransaction(lease,async c=>{const ids=await saveEvidence(c,lease.jobId,group.leadId,unique);return unique.slice(0,ids.length).map((e,i)=>({...e,id:ids[i]}));});
  let people:Decisor[]=[],assessment:Decision|undefined;
  if(evidence.length){
   const route=job.checkpoint.execution.aiRoute.conventional,step='decisors:'+group.leadId,operationId=hashValue({job:lease.jobId,step});
   const slot=(release:boolean)=>withLeasedTransaction(lease,async c=>Boolean((await c.query('SELECT app.codex_prospecting_slot($1,$2,$3,$4) AS ok',[lease.jobId,lease.token,lease.fence,release])).rows[0].ok));
   const result=await performStep(lease,step,route.provider==='codex-local'?'codex':route.provider,{[conventionalUnit(route.provider)]:1},async()=>{
    await withLeasedTransaction(lease,c=>assertAiRouteCurrent(c,job,operationId));
    const generated=await(deps.decisors??generateDecisors)({workspaceId:lease.workspaceId,operationId,signal:deps.signal??new AbortController().signal,route,acquireSlot:()=>slot(false),releaseSlot:async()=>{await slot(true);}},{company:lead,knownNames:names,evidence,context:job.checkpoint.context,product:job.checkpoint.product,request:{targetCompany:lead.name,cnpj:group.cnpj}});
    try{return {people:validateDecisorEvidence(generated.value,evidence,lead,names,registry.phone?[registry.phone]:[]),usage:generated.usage,invalid:false};}
    catch{return {people:[] as Decisor[],usage:generated.usage,invalid:true};}
   },r=>r.usage);if(result.invalid)throw new ProviderError('INVALID_DECISOR_RESULT');people=result.people;
   if(job.checkpoint.execution.aiRoute.decisionProvider==='jev'){
    assessment=await performStep(lease,'decisor-assessment:'+group.leadId,'openrouter',{jevCalls:1},async()=>{
     await preflight(lease,job,deps,true);
     return (deps.decide??decide)({operationId:hashValue({job:lease.jobId,step:'decisor-assessment:'+group.leadId}),signal:deps.signal??new AbortController().signal,credential:process.env.OPENROUTER_API_KEY??''},{company:job.checkpoint.context,product:job.checkpoint.product,request:{targetCompany:lead.name,cnpj:group.cnpj},intent:'contact-evidence',criteria:'Assess explicit personal contact attribution to the named decision maker at this company. Registry/QSA names alone, generic company contacts and guessed emails are insufficient. Report conflicts; never claim delivery or WhatsApp verification.',facts:{company:lead.name,cnpj:group.cnpj,people},evidence});
    },r=>r.usage);
   }
  }
  const resolution=await withLeasedTransaction(lease,async c=>{
   await assertExecution(c);if(!prospectingConfig().enabled||prospectingConfig().version!==job.checkpoint.execution.version)throw new AppError(409,'A configuração mudou. Revise antes de aplicar.','PROFILE_CHANGED');
   await assertAiRouteCurrent(c,job);
   await c.query("SELECT set_config('app.enrichment_token',$1,true),set_config('app.enrichment_fence',$2,true)",[lease.token,String(lease.fence)]);
   const prior=(await c.query('SELECT * FROM app.enrichment_resolution WHERE cnpj=$1 AND contract=$2 AND expires_at>clock_timestamp() ORDER BY resolved_at DESC,id DESC LIMIT 1',[group.cnpj,checkpoint.contract])).rows[0];if(prior)return {row:prior,cached:true};
   const row=(await c.query("INSERT INTO app.enrichment_resolution(workspace_id,id,cnpj,contract,job_id,lead_id,people,expires_at,assessment) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+$8::interval,$9) RETURNING *",[lease.workspaceId,hashValue({job:lease.jobId,cnpj:group.cnpj}),group.cnpj,checkpoint.contract,lease.jobId,group.leadId,JSON.stringify(people),people.length?'30 days':'1 day',assessment??null])).rows[0];return{row,cached:false};
  });
  await record(lease,job,group,{cnpj:group.cnpj,people:resolution.row.people,cacheId:resolution.row.id,cached:resolution.cached,charged:!resolution.cached&&people.length>0,resolvedAt:new Date(resolution.row.resolved_at).toISOString(),...(resolution.row.assessment?{assessment:resolution.row.assessment}:{})});
 }catch(error){await handleStepFailure(lease,error);}
}
async function cancelRemoteRuns(lease:JobLease,job:any,deps:QualificationAdapters){
 const starts=await withLeasedTransaction(lease,async c=>(await c.query("SELECT step,payload FROM app.prospecting_attempt WHERE job_id=$1 AND provider='apify' AND state='completed' AND payload->'result'->'run'->>'runId' IS NOT NULL",[lease.jobId])).rows);
 let pending=false;const adapter=deps.apify??new ApifyAdapter();
 for(const start of starts){
  const run=start.payload.result.run,source=start.step.startsWith('registry:')?'CNPJ':'WEB',step='abort:'+run.runId,operation=hashValue({job:lease.jobId,step});
  const prior=await withLeasedTransaction(lease,async c=>{const old=(await c.query('SELECT * FROM app.prospecting_attempt WHERE id=$1',[operation])).rows[0];if(old)return old;await c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,provider,step,state,payload) VALUES(current_setting('app.workspace_id'),$1,$2,'apify',$3,'prepared',$4)",[lease.jobId,operation,step,{reservedUnits:{},source,runId:run.runId,cleanup:true}]);return null;});
  if(prior&&prior.state!=='completed'){await finishJob(lease,'needs_reconciliation','ABORT_OUTCOME_UNKNOWN');return false;}
  const ctx=providerContext(job,source,operation,deps.signal??new AbortController().signal);
  try{
   const remote=prior?['cancelled','failed','succeeded'].includes(prior.payload.result?.status)?{status:prior.payload.result.status}:await adapter.poll(ctx,run):await adapter.abort(ctx,run);
   if(!['cancelled','failed','succeeded'].includes(remote.status))pending=true;
   await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_attempt SET state='completed',payload=payload||$2::jsonb WHERE id=$1",[operation,{result:{status:remote.status}}]));
  }catch{await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_attempt SET state='uncertain' WHERE id=$1",[operation]));throw new ProviderError('ABORT_OUTCOME_UNKNOWN',0,true);}
 }
 if(!pending)await withLeasedTransaction(lease,c=>c.query("UPDATE app.prospecting_job SET checkpoint=checkpoint||'{\"remoteTerminal\":true}'::jsonb WHERE id=$1",[lease.jobId]));
 return !pending;
}
async function record(lease:JobLease,job:any,group:EnrichmentGroup,result:EnrichmentResult|null,code?:string){
 await withLeasedTransaction(lease,async c=>{const lead=job.checkpoint.bases[group.leadId],useful=!!result?.people.length;
  await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,source_ref,name,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,job_id,id) DO NOTHING",[lease.workspaceId,lease.jobId,hashValue({job:lease.jobId,cnpj:group.cnpj}),group.leadId,group.cnpj,lead.name,useful?'pending_review':'skipped',{results:[],enrichment:result??{cnpj:group.cnpj,people:[],cacheId:'',cached:false,charged:false,resolvedAt:new Date().toISOString()},reasons:code?[code]:useful?[]:['NO_PERSONAL_CONTACT_EVIDENCE'],inputFingerprint:hashValue(qualificationFingerprint(lead))}]);
  await c.query("UPDATE app.prospecting_job SET counts=counts||jsonb_build_object('found',(SELECT count(*) FROM app.prospecting_item WHERE job_id=$1),'pending',(SELECT count(*) FROM app.prospecting_item WHERE job_id=$1 AND NOT applied AND jsonb_array_length(COALESCE(payload->'enrichment'->'people','[]'::jsonb))>0),'rejected',(SELECT count(*) FROM app.prospecting_item WHERE job_id=$1 AND jsonb_array_length(COALESCE(payload->'enrichment'->'people','[]'::jsonb))=0)),revision=revision+1,updated_at=clock_timestamp() WHERE id=$1",[lease.jobId]);
 });
}
