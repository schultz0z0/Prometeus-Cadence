import type {JobLease,JobInput,Evidence,ModuleResult,Decision,Generation,ProviderUsage,Candidate} from '../../domain/prospecting.ts';
import {siteBrowserUnavailable,type SiteBrowser} from './site-browser.ts';
import type {Lead,CompanyProfile} from '../../domain/model.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {readLeasedJob,finishJob,performStep,performSiteRead,handleStepFailure} from './journal.ts';
import {recordModuleResult} from './results.ts';
import {saveEvidence} from './evidence.ts';
import {fetchEvidencePack} from './extraction/fetch-page.ts';
import {extractContacts,extractCnpjs,checkEmailDns} from './extraction/contacts.ts';
import {chooseNextModule,suggestedQualification} from './ai/policy.ts';
import {decide} from './ai/jev.ts';
import {generate} from './ai/codex.ts';
import {hashValue} from './review.ts';
import {ApifyAdapter} from './providers/apify.ts';
import {normalizeCnpj,normalizeSite} from './normalize.ts';
import type {SourceAdapter} from './providers/types.ts';
import {providerContext} from './steps.ts';
import {ProviderError} from './providers/transport.ts';
import {AppError} from '../errors.ts';
import {runConventional,conventionalUnit} from './ai/conventional.ts';
import {assertAiRouteCurrent} from './ai/route-guard.ts';
import {diagnoseCodex} from './ai/diagnostics.ts';
import {ensureOAuthCompanion} from './ai/json.ts';
import {recordConnectionCheck} from './ai/connection.ts';
import type {AiRoute} from '../../domain/ai-routing.ts';
import {syncOccurrenceJob} from '../automations/assignments.ts';
import {qualificationSkipReason,assessEmail} from '../../domain/qualification-policy.ts';
import {runEnrichment} from './enrichment.ts';
import {buildAiSkill} from '../../domain/ai-skills.ts';
import type {DecisorGenerator} from './ai/decisors.ts';
export interface QualificationAdapters{
  signal?:AbortSignal;apify?:SourceAdapter;siteBrowser?:SiteBrowser;conventional?:typeof runConventional;diagnose?:typeof diagnoseCodex;
  collect?:(...args:Parameters<typeof fetchEvidencePack>)=>Promise<Evidence[]>;checkEmail?:typeof checkEmailDns;decisors?:DecisorGenerator;
  decide?:typeof decide;generate?:typeof generate;
}

const discoveryLimit=5;
const platformDomains=['google.com','google.com.br','googleusercontent.com','gstatic.com','goo.gl','google.site','instagram.com','facebook.com','linkedin.com','youtube.com','whatsapp.com','wa.me','linktr.ee','cnpj.biz','casadosdados.com.br','econodata.com.br','apontador.com.br','guiamais.com.br'];
export function institutionalSite(value:unknown){
  const site=normalizeSite(value);
  if(!site)return undefined;
  const host=new URL(site).hostname;
  return platformDomains.some(domain=>host===domain||host.endsWith('.'+domain))?undefined:site;
}
const siteWords=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().match(/[a-z0-9]+/g)??[];
const identityWords=(value:string)=>{
  const words=siteWords(value);
  return words.length===1?words:words.filter(word=>word.length>2);
};

export const phoneIdentity=(value:string)=>value.replace(/\D/g,'').replace(/^55(?=\d{10,11}$)/,'');
const containsWords=(text:string,words:string[])=>words.length>0&&` ${text} `.includes(` ${words.join(' ')} `);
const matchesName=(text:string,name:string[])=>containsWords(
  (name.length===1&&name[0].length<=2?siteWords(text):identityWords(text)).join(' '),name);
const companyNames=(lead:Lead)=>[lead.name,lead.companyName].filter((name):name is string=>Boolean(name)).map(identityWords);

export function companySiteCandidates(candidates:Candidate[],lead:Lead,{allowTitleMatch=false}={}){
  const names=companyNames(lead),phone=phoneIdentity(lead.phone??'');
  return candidates.filter(candidate=>{
    const site=institutionalSite(candidate.site);
    if(!site)return false;
    const host=new URL(site).hostname;
    const hostLabels=host.split('.').map(label=>label.replace(/-/g,''));
    return names.some(words=>matchesName(candidate.name,words)&&(
      allowTitleMatch||
      (words.join('').length>2&&hostLabels.includes(words.join('')))||
      Boolean(phone&&extractContacts(candidate.evidence??[]).phones.some(value=>phoneIdentity(value)===phone))
    ));
  });
}

export function verifySiteContent(lead:Lead,pages:Evidence[]){
  const body=pages.map(page=>page.text).join(' ');
  if(!companyNames(lead).some(name=>matchesName(body,name)))return false;
  const cnpj=normalizeCnpj(lead.cnpj),cnpjs=extractCnpjs(pages);
  if(cnpj&&cnpjs.length)return cnpjs.includes(cnpj);
  const phone=phoneIdentity(lead.phone??''),phones=extractContacts(pages).phones.map(phoneIdentity);
  return Boolean(phone&&phones.includes(phone));
}

async function mapsEvidence(lease:JobLease,lead:Lead):Promise<Evidence[]>{
  if(lead.source!=='MAPS')return[];
  return performStep(lease,'maps-evidence:'+lead.id,'public-web',{},()=>withLeasedTransaction(lease,async c=>{
    const {rows}=await c.query(
      `SELECT e.* FROM app.lead_evidence e JOIN app.prospecting_job j
        ON j.workspace_id=e.workspace_id AND j.id=e.job_id
        WHERE e.lead_id=$1 AND j.kind='generation' AND j.source='MAPS'
        ORDER BY e.fetched_at DESC,e.id LIMIT 3`,[lead.id]);
    const evidence:Evidence[]=rows.map(row=>({id:row.id,url:row.url,text:row.text,hash:row.hash,truncated:row.truncated,fetchedAt:new Date(row.fetched_at).toISOString()}));
    const ids=await saveEvidence(c,lease.jobId,lead.id,evidence);
    return evidence.slice(0,ids.length).map((item,index)=>({...item,id:ids[index]}));
  }));
}
async function researchEvidence(lease:JobLease,lead:Lead):Promise<Evidence[]>{
 return performStep(lease,'research-evidence:'+lead.id,'public-web',{},()=>withLeasedTransaction(lease,async c=>{
  const {rows}=await c.query(`
   SELECT DISTINCT ON(s.source_kind) s.* FROM app.research_source s
   JOIN app.research_case r ON r.workspace_id=s.workspace_id AND r.job_id=s.job_id AND r.lead_id=s.lead_id
   WHERE s.lead_id=$1 AND s.attribution='company' AND s.fetched_at>now()-interval '7 days'
    AND r.basis->>'name'=$2 AND (r.basis->>'site') IS NOT DISTINCT FROM $3
    AND (r.basis->>'cnpj') IS NOT DISTINCT FROM $4 AND (r.basis->>'phone') IS NOT DISTINCT FROM $5
   ORDER BY s.source_kind,s.fetched_at DESC,s.id LIMIT 3`,
   [lead.id,lead.name,lead.site??null,lead.cnpj??null,lead.phone??null]);
  const pages:Evidence[]=rows.map(row=>({id:row.id,url:row.url,text:row.text,hash:row.hash,fetchedAt:new Date(row.fetched_at).toISOString(),truncated:false}));
  const ids=await saveEvidence(c,lease.jobId,lead.id,pages);
  return pages.slice(0,ids.length).map((page,index)=>({...page,id:ids[index]}));
 }));
}
async function collectEvidence(lease:JobLease,job:any,lead:Lead,deep:boolean,deps:QualificationAdapters,verify=false):Promise<Evidence[]>{
  const site=lead.site;if(!site)return[];
  const step=verify?'verify-site:'+lead.id+':'+hashValue(new URL(site).host):'evidence:'+lead.id+':'+deep;
  return performSiteRead<Evidence[]>(lease,step,async()=>{
    let pages=job.checkpoint.purpose==='ai-connection-test'?[{id:'connection-sample',url:'https://example.com/',fetchedAt:new Date().toISOString(),text:'Evidência sintética de teste: clínica odontológica fictícia com consultas e ortodontia. Não representa uma empresa real.',hash:hashValue('connection-sample-v1'),truncated:false}]:await (deps.collect??fetchEvidencePack)(site,{signal:deps.signal??new AbortController().signal,browser:deps.siteBrowser},deep);
    if(verify){
      const requested=new URL(site);
      pages=pages.filter(page=>{
        const canonical=institutionalSite(page.url);
        if(!canonical)return false;
        const received=new URL(canonical);
        return received.host===requested.host&&(requested.protocol==='http:'||received.protocol==='https:');
      });
      if(!verifySiteContent(lead,pages))return[];
    }
    return pages;
  },async(c,pages)=>{
    const ids=await saveEvidence(c,lease.jobId,lead.id,pages);
    return pages.slice(0,ids.length).map((e,i)=>({...e,id:ids[i]}));
  });
}
export async function sourceResult(lease:JobLease,job:any,lead:Lead,module:'registry'|'website',deps:QualificationAdapters,options:{partners?:boolean;suffix?:string}={}):Promise<Partial<Candidate>|null>{const result=await sourceResults(lease,job,lead,module,deps,options);return result===null?null:result[0]??{};}
export async function sourceResults(lease:JobLease,job:any,lead:Lead,module:'registry'|'website'|'maps',deps:QualificationAdapters,options:{partners?:boolean;suffix?:string;limit?:number;beforeStart?:(operationId:string)=>Promise<void>;onTerminal?:(runId:string)=>Promise<void>}={}):Promise<Candidate[]|null>{
  const source=module==='registry'?'CNPJ':module==='maps'?'MAPS':'WEB',step=module+':'+lead.id+(options.suffix?':'+options.suffix:'');
  const ctx=providerContext(job,source,hashValue({job:lease.jobId,step}),deps.signal??new AbortController().signal),adapter=deps.apify??new ApifyAdapter();
  if(job.checkpoint.registryFirst){
    const cached=await withLeasedTransaction(lease,async c=>(await c.query(
      "SELECT payload->'lookup' AS lookup FROM app.prospecting_attempt WHERE id=$1 AND job_id=$2 AND state='completed'",
      [ctx.operationId,lease.jobId])).rows[0]?.lookup as Candidate[]|undefined);
    if(cached)return cached;
  }
  const remember=async (candidates:Candidate[])=>{
    if(job.checkpoint.registryFirst)await withLeasedTransaction(lease,c=>c.query(
      "UPDATE app.prospecting_attempt SET payload=payload||jsonb_build_object('lookup',$3::jsonb) WHERE id=$1 AND job_id=$2 AND state='completed'",
      [ctx.operationId,lease.jobId,JSON.stringify(candidates)]));
    return candidates;
  };
  if(options.partners)ctx.profile.partners=true;
  const limit=Math.min(5,Math.max(1,options.limit??1));
  const requestedCnpj=module==='registry'?normalizeCnpj(lead.cnpj):undefined;
  let differentCnpj=false;
  function matchingCandidates(candidates:Candidate[]){
    if(module!=='registry')return candidates.slice(0,limit);
    return candidates.filter(candidate=>{
      const cnpj=normalizeCnpj(candidate.cnpj);
      if(cnpj&&cnpj!==requestedCnpj)differentCnpj=true;
      return Boolean(cnpj&&cnpj===requestedCnpj);
    }).slice(0,limit);
  }
  function noMatch(){
    if(differentCnpj)throw new ProviderError('CNPJ_IDENTITY_MISMATCH');
    return [];
  }
  const input:Extract<JobInput,{kind:'generation'}>={kind:'generation',source,destination:{mode:'existing',listId:lead.listId},filters:module==='registry'?{term:lead.name,cnpj:lead.cnpj!}:{term:lead.name,location:[lead.city,lead.state].filter(Boolean).join(', ')||'Brasil'},limit,dedupScope:'workspace'};
  const started=await performStep(lease,step,'apify',{apifyRuns:1},async()=>{await options.beforeStart?.(ctx.operationId);return adapter.start(ctx,input);},r=>({provider:'apify',operationId:ctx.operationId,units:r.kind==='uncertain'?{}:{apifyRuns:1},costUsd:null,costKind:'unknown'}));
  if(started.kind==='uncertain'){await finishJob(lease,'needs_reconciliation','START_UNCERTAIN');return null;}
  if(started.kind==='inline'){
    const matching=matchingCandidates(started.page.candidates);
    return remember(matching.length?matching:noMatch());
  }
  const remote=await adapter.poll(ctx,started.run);
  if(['succeeded','failed','cancelled'].includes(remote.status))await options.onTerminal?.(started.run.runId);
  if(['failed','cancelled'].includes(remote.status))throw new ProviderError('REMOTE_FAILED');
  if(remote.status!=='succeeded')return null;
  // Registry datasets may include free notice rows before the requested company.
  // Keep dataset paging distinct from the one-company lookup limit.
  let cursor:string|null=null;
  for(let page=0;page<20;page++){
    const result=await adapter.readPage(ctx,remote.run,cursor,module==='registry'?100:limit);
    const matching=matchingCandidates(result.candidates);
    if(matching.length)return remember(matching);
    if(result.exhausted||!result.nextCursor)return remember(noMatch());
    cursor=result.nextCursor;
  }
  throw new ProviderError('LOOKUP_PAGE_LIMIT');
}
export async function runQualification(lease:JobLease,deps:QualificationAdapters={}){
  const job=await readLeasedJob(lease),input=job.input as JobInput;
  if(input.kind!=='qualification')throw Error('INVALID_JOB_KIND');
  if(input.enrichment)return runEnrichment(lease,deps);
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
      if(lead.site&&!institutionalSite(lead.site))lead.site=undefined;
      const discovered=prior.find(item=>item.module==='website'&&item.proposed.site===lead.site&&item.reasons.includes('SITE_VERIFIED'));
      const result:ModuleResult={module,status:'pending_review',proposed:{},base:{},reasons:[],evidenceIds:[],usage:null,contextVersion:job.checkpoint.context?.version??0};
      const skip=qualificationSkipReason(base,input.options,!!job.checkpoint.processed?.[leadId]);
      if(skip){result.status='skipped';result.reasons=[skip];}
      else if(module==='summary'&&input.summaryPolicy==='fits'&&!prior.some(r=>r.module==='qualify'&&r.proposed.qualification==='qualified')){result.status='skipped';result.reasons=['SUMMARY_REQUIRES_FIT'];}
      else if(module==='registry'||module==='website'){
        let registryCnpj=normalizeCnpj(lead.cnpj),searched:string[]=[];
        if(module==='registry'&&!registryCnpj){
          const evidence=await collectEvidence(lease,job,lead,input.modules.includes('deep'),deps,Boolean(discovered)),cnpjs=extractCnpjs(evidence);result.evidenceIds=evidence.map(e=>e.id);
          if(cnpjs.length===1)registryCnpj=cnpjs[0];
          else if(!cnpjs.length&&job.checkpoint.execution.profiles.WEB?.actor){
            // Maps leads rarely print the CNPJ on their own site: take up to two candidates from public search results; the registry decides below.
            // Maps names carry taglines ("| Implantes - 24h"), and directories quote their own CNPJ next to the company, so nothing here is trusted yet.
            const tradeName=lead.name.split(/\s+[|–-]\s+/)[0];
            const found=await sourceResults(lease,job,{...lead,name:`"${tradeName}" ${lead.city??''} CNPJ`.replace(/\s+/g,' ')},'website',deps,{limit:5,suffix:'cnpj'});if(found===null)return;
            const words=identityWords(tradeName),hits=found.flatMap(r=>r.evidence??[]).filter(e=>matchesName(e.text,words));
            searched=[...new Set(extractCnpjs(hits))].slice(0,2);
            if(searched.length)result.evidenceIds.push(...await withLeasedTransaction(lease,c=>saveEvidence(c,lease.jobId,lead.id,hits.filter(e=>extractCnpjs([e]).some(cnpj=>searched.includes(cnpj))))));
            else{result.status='skipped';result.reasons=['NO_CNPJ'];}
          }
          else{result.status='skipped';result.reasons=[cnpjs.length?'AMBIGUOUS_CNPJ':'NO_CNPJ'];}
        }
        if(module==='website'&&lead.site){result.status='skipped';result.reasons=['ALREADY_HAS_SITE'];}
        else if(result.status!=='skipped'){
          let source:Partial<Candidate>={},candidates:Candidate[]=[];
          if(searched.length){
            // A CNPJ that came from a search result is kept only when the registry agrees on the city and on the name, phone or postal code.
            const fold=(value?:string)=>siteWords(value??'').join(' '),phone=phoneIdentity(lead.phone??''),cep=(value?:string)=>value?.match(/\b\d{5}-?\d{3}\b/)?.[0].replace('-','');
            const confirmed:Candidate[]=[];
            for(const cnpj of searched){
              const looked=await sourceResults(lease,job,{...lead,cnpj},'registry',deps,{limit:1,suffix:'cnpj:'+cnpj});if(looked===null)return;
              const found=looked[0];if(!found)continue;
              const sameCity=!!lead.city&&!!found.city&&fold(lead.city)===fold(found.city);
              const sameCompany=companyNames(lead).some(words=>matchesName([found.name,found.companyName].filter(Boolean).join(' '),words))||Boolean(phone&&found.phone&&phoneIdentity(found.phone)===phone);
              const sameAddress=!!cep(lead.address)&&cep(lead.address)===cep(found.address);
              if(sameCity&&(sameCompany||sameAddress))confirmed.push(found);
            }
            if(confirmed.length===1){source=confirmed[0];registryCnpj=normalizeCnpj(source.cnpj);}
            else{result.status='skipped';result.reasons=[confirmed.length?'AMBIGUOUS_CNPJ':'CNPJ_NOT_CORROBORATED'];}
          }else{
            const looked=await sourceResults(lease,job,{...lead,cnpj:registryCnpj},module,deps,{limit:module==='website'?discoveryLimit:1});if(looked===null)return;
            candidates=looked;source=candidates[0]??{};
          }
          if(module==='website'){
            source={};
            for(const candidate of companySiteCandidates(candidates,lead)){
              const site=institutionalSite(candidate.site)!;
              const evidence=await collectEvidence(lease,job,{...lead,site},input.modules.includes('deep'),deps,true);
              if(!evidence.length)continue;
              source={site:institutionalSite(evidence[0].url)};result.evidenceIds=evidence.map(page=>page.id);result.reasons=['SITE_VERIFIED'];break;
            }
          }
          if(module==='registry'&&source.cnpj&&source.cnpj!==registryCnpj)throw new ProviderError('CNPJ_IDENTITY_MISMATCH');
          result.evidenceIds.push(...await withLeasedTransaction(lease,c=>saveEvidence(c,lease.jobId,lead.id,source.evidence??[])));
          for(const key of (module==='website'?['site']:['cnpj','companyName','city','state','capital','size','legalNature','cnae','openedAt','address']) as (keyof Lead)[])if(source[key as keyof typeof source])Object.assign(result.proposed,{[key]:source[key as keyof typeof source]});if(!Object.keys(result.proposed).length&&result.status!=='skipped'){result.status='skipped';result.reasons=['NO_RESULT'];}}
      }else if(module==='validateEmail'){
        const validation=lead.email?await (deps.checkEmail??checkEmailDns)(lead.email):null;result.status='succeeded';result.reasons=[!validation?'NO_EMAIL':validation.format?'FORMAT_VALID':'FORMAT_INVALID',validation?.dns===true?'MAIL_DOMAIN_FOUND':'MAIL_DOMAIN_UNKNOWN','MAILBOX_NOT_VERIFIED'];
        if(validation&&lead.email)result.emailAssessment=assessEmail(lead.email,validation,new Date().toISOString());
      }else{
        const pages=await collectEvidence(lease,job,lead,input.modules.includes('deep'),deps,Boolean(discovered));
        const evidence=pages.length||!['qualify','summary'].includes(module)?pages:await mapsEvidence(lease,lead);
        if(['qualify','summary'].includes(module))evidence.push(...await researchEvidence(lease,lead));
        result.evidenceIds=evidence.map(e=>e.id);
        if(!evidence.length){result.status='skipped';result.reasons=['NO_EVIDENCE'];}
        else if(module==='deep'){result.status='succeeded';result.reasons=['PUBLIC_PAGES_ONLY'];}
        else if(module==='email'||module==='phone'){
          const facts=extractContacts(evidence),value=module==='email'?facts.emails[0]:facts.phones[0];
          if(value)result.proposed={[module]:value};else{result.status='skipped';result.reasons=['CONTACT_NOT_FOUND'];}
        }else{
          const context=job.checkpoint.context as CompanyProfile|null,criteria=JSON.stringify({offer:context?.offer,idealCustomer:context?.idealCustomer,products:context?.products,pains:context?.pains,customCriteria:job.checkpoint.automation?.qualificationCriteria,product:job.checkpoint.product,language:input.options?.language??'pt-BR'});
          const aiRoute=job.checkpoint.execution?.aiRoute as AiRoute|undefined;
          const skill=buildAiSkill('qualify',{company:context,product:job.checkpoint.product,request:{criteria:job.checkpoint.automation?.qualificationCriteria,modules:input.modules},language:input.options?.language});
          const cacheKey=hashValue({aiRoute,skill,contract:'jev-decisions-v1',model:'typesafe/jev-1.13',criteria,evidence:evidence.map(e=>e.hash),facts:{name:lead.name,cnpj:lead.cnpj}});
          if(module==='qualify'&&aiRoute?.decisionProvider!=='jev'&&aiRoute){
            const classified=await conventionalStep(lease,job,leadId,'qualify',criteria,evidence,deps);
            if(classified.task!=='qualify')throw Error('INVALID_TASK');result.decision=classified.decision;result.usage=classified.decision.usage;result.proposed={qualification:suggestedQualification(classified.decision),reason:classified.reason};result.reasons=['UNCALIBRATED_SUGGESTION','CONVENTIONAL_EVIDENCE_REVIEW'];
          }else if(module==='qualify'){
            const cached=await withLeasedTransaction(lease,async c=>(await c.query('SELECT payload FROM app.prospecting_cache WHERE key=$1 AND created_at>now()-interval \'1 day\'',[cacheKey])).rows[0]?.payload as Decision|undefined);
            const decision=cached?{...cached,evidenceIds:evidence.map(e=>e.id),usage:{...cached.usage,operationId:hashValue({job:lease.jobId,leadId,module}),units:{},costUsd:null,costKind:'unknown' as const}}:await performStep(lease,module+':'+leadId,'openrouter',{jevCalls:1},async()=>{await preflight(lease,job,deps,true);return (deps.decide??decide)({operationId:hashValue({job:lease.jobId,leadId,module}),signal:deps.signal??new AbortController().signal,credential:process.env.OPENROUTER_API_KEY??''},{criteria,evidence,facts:{name:lead.name,cnpj:lead.cnpj},company:context,product:job.checkpoint.product,request:{criteria:job.checkpoint.automation?.qualificationCriteria,modules:input.modules},language:input.options?.language});},r=>r.usage);
            if(!cached)await withLeasedTransaction(lease,async c=>{await assertAiRouteCurrent(c,job);await c.query("INSERT INTO app.prospecting_cache VALUES(current_setting('app.workspace_id'),$1,$2,now()) ON CONFLICT(workspace_id,key) DO UPDATE SET payload=EXCLUDED.payload,created_at=now()",[cacheKey,decision]);});
            result.decision=decision;result.proposed={qualification:suggestedQualification(decision)};result.reasons=['UNCALIBRATED_SUGGESTION','CONFIDENCE_IS_NOT_ACCURACY'];
            if(input.escalation==='ambiguous'&&suggestedQualification(decision)!=='pending'&&decision.confidence!==null&&decision.confidence<0.7){
              const opinion=await generateStep(lease,job,leadId,'second_opinion',criteria,evidence,deps);result.proposed.reason=opinion.summary;result.reasons.push('SECOND_OPINION_REVIEW_REQUIRED');
            }
          }else if(module==='summary'){
            const generated=await generateStep(lease,job,leadId,'summary',criteria,evidence,deps);result.proposed={summary:generated.summary};result.evidenceIds=generated.evidenceIds;
          }
        }
      }
      if(!skip&&result.status!=='failed'&&input.options?.disqualifyNoEmail&&!chooseNextModule(input,[...prior,result])&&!lead.email&&[...prior,result].some(r=>r.module==='email'&&r.reasons.includes('CONTACT_NOT_FOUND'))){result.status='pending_review';result.proposed.qualification='disqualified';result.proposed.reason='E-mail não encontrado nas fontes coletadas; regra de seleção configurada pelo usuário.';result.reasons.push('USER_NO_EMAIL_RULE');}
      for(const key of Object.keys(result.proposed) as (keyof Lead)[])Object.assign(result.base,{[key]:base[key]??null});
      await withLeasedTransaction(lease,c=>recordModuleResult(c,lease,leadId,result));
      return;
    }
    await withLeasedTransaction(lease,async c=>{
      const rows=(await c.query('SELECT payload FROM app.prospecting_item WHERE job_id=$1',[lease.jobId])).rows;
      const failed=rows.some(r=>r.payload.results.some((m:ModuleResult)=>m.status==='failed'));
      if(job.checkpoint.purpose==='ai-connection-test'&&!failed&&rows.some(r=>r.payload.results.some((m:ModuleResult)=>m.module==='summary'&&m.status==='pending_review'&&m.proposed.summary))){
        await assertAiRouteCurrent(c,job);
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
    if(siteBrowserUnavailable(error))throw error;
    if(current&&!(error instanceof AppError)&&!(error instanceof Error&&error.constructor.name==='UncertainStep')){
      await withLeasedTransaction(lease,c=>recordModuleResult(c,lease,current!.leadId,{module:current!.module,status:'failed',proposed:{},base:{},reasons:[error instanceof ProviderError?error.code:'MODULE_FAILED'],evidenceIds:[],usage:null,contextVersion:job.checkpoint.context?.version??0}));return;
    }
    await handleStepFailure(lease,error);
  }
}
export async function preflight(lease:JobLease,job:any,deps:QualificationAdapters,jev=false,freshOperationId?:string){
 await withLeasedTransaction(lease,c=>assertAiRouteCurrent(c,job,freshOperationId));
 const route=job.checkpoint.execution.aiRoute as AiRoute;
 if(jev&&route.conventional.provider==='chatgpt-oauth'){
  await ensureOAuthCompanion(lease.workspaceId,route.conventional,deps.signal);
  await withLeasedTransaction(lease,c=>assertAiRouteCurrent(c,job));
 }
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
  try{return await(deps.conventional??runConventional)({operationId,workspaceId:lease.workspaceId,signal:deps.signal??new AbortController().signal,route,acquireSlot:()=>slot(false),releaseSlot:async()=>{await slot(true);}},{task,criteria,evidence,facts:{name:job.checkpoint.bases[leadId].name},company:job.checkpoint.context,product:job.checkpoint.product,request:{criteria:job.checkpoint.automation?.qualificationCriteria,modules:job.input.modules},language:job.input.options?.language});}
  catch(error){await withLeasedTransaction(lease,c=>recordConnectionCheck(c,lease,{operationId,route,outcome:error instanceof ProviderError&&error.uncertain?'uncertain':'failed',code:error instanceof ProviderError?error.code:'CONVENTIONAL_FAILED'}));throw error;}
 },r=>r.task==='qualify'?r.decision.usage:r.generation.usage);
}
async function generateStep(lease:JobLease,job:any,leadId:string,task:'summary'|'second_opinion',criteria:string,evidence:Evidence[],deps:QualificationAdapters):Promise<Generation>{
 const result=await conventionalStep(lease,job,leadId,task,criteria,evidence,deps);if(result.task==='qualify')throw Error('INVALID_TASK');return result.generation;
}
