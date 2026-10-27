import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Lead} from '../../domain/model.ts';
import type {JobLease,ProspectingInput} from '../../domain/prospecting.ts';
import type {Reviewed,Confirm} from '../../domain/reviewed-operation.ts';
import {companyResearchInputSchema,extractCompanyFacts,matchCompanySource,researchContractVersion,researchLeadBasis,researchUrl,socialField} from '../../domain/company-research.ts';
import type {CompanyResearchInput,ResearchApplication,ResearchAdapters,ResearchCaseView,ResearchPage,ResearchKind} from '../../domain/company-research.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {withLeasedTransaction} from '../prospecting/worker-db.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {prepareJob,confirmJob} from '../prospecting/service.ts';
import {createReviewToken,verifyReviewToken,hashValue} from '../prospecting/review.ts';
import {readLeasedJob,performStep,finishJob,handleStepFailure,UncertainStep} from '../prospecting/journal.ts';
import {sourceResult} from '../prospecting/qualification.ts';
import {cancelRemoteRuns} from '../prospecting/enrichment.ts';
import {prospectingConfig} from '../prospecting/config.ts';
import {fetchPublicPage} from '../prospecting/extraction/fetch-page.ts';
import {extractCnpjs} from '../prospecting/extraction/contacts.ts';
import {normalizeCnpj} from '../prospecting/normalize.ts';
import {researchSourceRegistry,researchSourceWarnings} from './source-registry.ts';

const confirmation=z.strictObject({input:companyResearchInputSchema,token:z.string().min(1).max(8192),requestId:z.uuid()});
const application=z.strictObject({caseId:z.string().min(1).max(120),factIds:z.array(z.string().min(1).max(120)).min(1).max(100).refine(v=>new Set(v).size===v.length),expectedRevision:z.number().int().nonnegative()});
const applyConfirmation=z.strictObject({input:application,token:z.string().min(1).max(8192),requestId:z.uuid()});
function input<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);if(!result.success)throw new AppError(422,'Revise os contatos, fontes e limites da investigação.');return result.data;}
function secret(){if(!process.env.BETTER_AUTH_SECRET)throw Error('Research review signing unavailable');return process.env.BETTER_AUTH_SECRET;}
async function authorize(c:PoolClient,p:Principal){requirePermission({...p,role:(await c.query('SELECT app.current_role() AS role')).rows[0].role},'data.write');}
async function jobInput(p:Principal,raw:CompanyResearchInput):Promise<Extract<ProspectingInput,{kind:'qualification'}>>{
 return withWorkspaceTransaction(p,async c=>{
  await authorize(c,p);const rows=(await c.query('SELECT id,list_id FROM app.lead WHERE id=ANY($1::text[])',[raw.leadIds])).rows;
  if(rows.length!==raw.leadIds.length)throw new AppError(404,'Um contato não pertence a este workspace.');
  if(new Set(rows.map(r=>r.list_id)).size!==1)throw new AppError(422,'Investigue uma lista por vez.');
  return{kind:'qualification',listId:rows[0].list_id,leadIds:raw.leadIds,modules:['deep'],summaryPolicy:'all',escalation:'off',companyResearch:{sourceKinds:raw.sourceKinds,maxPagesPerCompany:raw.maxPagesPerCompany}};
 });
}
export async function prepareCompanyResearch(p:Principal,value:unknown):Promise<Reviewed<CompanyResearchInput>&{usage:import('../../domain/prospecting.ts').UsageEstimate[]}>{
 const parsed=input(companyResearchInputSchema,value),review=await prepareJob(p,await jobInput(p,parsed));
 return{input:parsed,token:review.token,expiresAt:review.expiresAt,blockers:review.blockers,warnings:[...review.warnings,...researchSourceWarnings(parsed.sourceKinds)],basisHash:review.profileVersion,usage:review.usage};
}
export async function confirmCompanyResearch(p:Principal,value:unknown):Promise<ResearchCaseView>{
 const body=input(confirmation,value),job=await confirmJob(p,{input:await jobInput(p,body.input),reviewToken:body.token,requestId:body.requestId});
 return readCompanyResearch(p,job.id);
}
async function readResearch(c:PoolClient,id:string,query:{leadId?:string;factIds?:string[]}={}):Promise<ResearchCaseView>{
 const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[id])).rows[0];
 if(!job?.input?.companyResearch)throw new AppError(404,'Investigação não encontrada.');
 const companies=(await c.query('SELECT lead_id,name,state,missing FROM app.research_case WHERE job_id=$1 ORDER BY lead_id',[id])).rows.map(r=>({leadId:r.lead_id,name:r.name,state:r.state,missing:r.missing as string[]}));
 const selectedLeadId=query.leadId??companies[0]?.leadId;if(query.leadId&&!companies.some(r=>r.leadId===query.leadId))throw new AppError(404,'Empresa não encontrada nesta investigação.');
 const facts=(await c.query('SELECT * FROM app.research_fact WHERE job_id=$1 AND (CASE WHEN $3::text[] IS NULL THEN lead_id=$2 ELSE id=ANY($3::text[]) END) ORDER BY lead_id,field,id LIMIT 100',[id,selectedLeadId??'',query.factIds??null])).rows.map(r=>({id:r.id,leadId:r.lead_id,field:r.field,value:r.value,evidence:r.evidence,attribution:r.attribution,applied:r.applied}));
 const sources=(await c.query('SELECT id,lead_id,url,fetched_at,hash,source_kind,attribution FROM app.research_source WHERE job_id=$1 AND lead_id=$2 ORDER BY id LIMIT 10',[id,selectedLeadId??''])).rows.map(r=>({id:r.id,leadId:r.lead_id,url:r.url,fetchedAt:new Date(r.fetched_at).toISOString(),hash:r.hash,sourceKind:r.source_kind,attribution:r.attribution}));
 return{id,revision:Number(job.revision),state:job.state,facts,sources,companies,selectedLeadId,totalCompanies:companies.length,missing:[...new Set(companies.flatMap(r=>r.missing))]};
}
export function readCompanyResearch(p:Principal,id:string,query:{leadId?:string}={}):Promise<ResearchCaseView>{return withWorkspaceTransaction(p,c=>readResearch(c,id,query));}
export async function latestCompanyResearch(p:Principal,leadId:string):Promise<ResearchCaseView|null>{return withWorkspaceTransaction(p,async c=>{
 if(!(await c.query('SELECT 1 FROM app.lead WHERE id=$1',[leadId])).rowCount)throw new AppError(404,'Contato não encontrado.');
 const row=(await c.query('SELECT job_id FROM app.research_case WHERE lead_id=$1 ORDER BY created_at DESC,job_id DESC LIMIT 1',[leadId])).rows[0];return row?readResearch(c,row.job_id,{leadId}):null;
});}
async function applicationState(c:PoolClient,p:Principal,raw:ResearchApplication){
 await authorize(c,p);const result=await readResearch(c,raw.caseId,{factIds:raw.factIds});
 if(!['completed','partial'].includes(result.state)||result.revision!==raw.expectedRevision)throw new AppError(409,'A investigação mudou. Revise os resultados novamente.');
 const selected=result.facts.filter(f=>raw.factIds.includes(f.id));
 if(selected.length!==raw.factIds.length||selected.some(f=>f.applied||f.attribution!=='company'))throw new AppError(409,'Selecione fatos disponíveis com vínculo comprovado à empresa.');
 const fields=new Set<string>();for(const f of selected){const key=f.leadId+':'+f.field;if(fields.has(key))throw new AppError(409,'Escolha apenas um valor por campo e contato.');fields.add(key);}
 const companies=(await c.query('SELECT r.lead_id,r.basis,l.payload FROM app.research_case r JOIN app.lead l ON l.workspace_id=r.workspace_id AND l.id=r.lead_id WHERE r.job_id=$1 AND r.lead_id=ANY($2::text[])',[raw.caseId,[...new Set(selected.map(f=>f.leadId))]])).rows;
 if(companies.length!==new Set(selected.map(f=>f.leadId)).size)throw new AppError(409,'Um contato foi removido. Revise novamente.');
 for(const company of companies){const keys=['name','companyName','site','cnpj','address','city','state',...selected.filter(f=>f.leadId===company.lead_id).map(f=>f.field)];if(keys.some(k=>hashValue(company.basis[k]??null)!==hashValue(company.payload[k]??null)))throw new AppError(409,'Os dados do contato mudaram. Prepare uma nova investigação.','RESEARCH_SOURCE_CHANGED');}
 return{proof:{action:'research.apply',workspaceId:p.workspaceId,userId:p.userId,input:raw,facts:selected},selected};
}
export async function prepareResearchApplication(p:Principal,value:unknown):Promise<Reviewed<ResearchApplication>>{
 const parsed=input(application,value);return withWorkspaceTransaction(p,async c=>{const state=await applicationState(c,p,parsed);return{input:parsed,token:createReviewToken(state.proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),blockers:[],warnings:['Apenas os fatos selecionados serão aplicados. Contato publicado não comprova consentimento nem atividade de WhatsApp.'],basisHash:hashValue(state.proof)};});
}
export async function confirmResearchApplication(p:Principal,value:unknown):Promise<{applied:number}>{
 const body=input(applyConfirmation,value);return withWorkspaceTransaction(p,async c=>{
  await authorize(c,p);await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1 FOR UPDATE',[p.workspaceId]);
  const digest=hashValue({action:'research.apply',input:body.input}),old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[body.requestId])).rows[0];
  if(old){if(old.user_id!==p.userId||old.body_hash!==digest)throw new AppError(409,'Este identificador já foi utilizado.');return old.result;}
  const state=await applicationState(c,p,body.input);verifyReviewToken(body.token,state.proof,secret());
  let result:{applied:number};try{result=(await c.query('SELECT app.apply_company_research($1,$2::text[],$3) AS result',[body.input.caseId,body.input.factIds,body.input.expectedRevision])).rows[0].result;}catch(e){if(e instanceof Error&&e.message.startsWith('RESEARCH_'))throw new AppError(409,'A seleção ou suas fontes mudaram. Revise novamente.');throw e;}
  await c.query("INSERT INTO app.command_result VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[body.requestId,p.userId,digest,result]);
  await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,'research.apply')",[p.workspaceId,p.userId]);return result;
 });
}
async function researchTransaction<T>(lease:JobLease,fn:(c:PoolClient)=>Promise<T>){return withLeasedTransaction(lease,async c=>{
 const job=(await c.query('SELECT checkpoint,input,state FROM app.prospecting_job WHERE id=$1',[lease.jobId])).rows[0];
 if(!job.input.companyResearch||job.checkpoint.execution?.version!==prospectingConfig().version)throw new AppError(409,'A configuração da investigação mudou.','PROFILE_CHANGED');
 await c.query("SELECT set_config('app.research_token',$1,true),set_config('app.research_fence',$2,true)",[lease.token,String(lease.fence)]);return fn(c);
});}
function pageQuote(page:ResearchPage){return page.text.slice(0,12000);}
function supportsCompany(lead:Lead,page:ResearchPage,kind:ResearchKind){
 if(kind==='registry')return !!lead.cnpj&&extractCnpjs([page]).includes(normalizeCnpj(lead.cnpj)??'');
 if(matchCompanySource({companyDomain:lead.site??'',candidateDomain:page.url,corroborated:false})==='matched')return true;
 if(kind==='social'&&lead.site){const domain=researchUrl(lead.site)?.hostname.replace(/^www\./,'');return !!domain&&(page.externalLinks??page.links??[]).some(link=>researchUrl(link)?.hostname.replace(/^www\./,'')===domain);}
 return false;
}
const defaultCollect=async(_kind:ResearchKind,urls:string[],signal:AbortSignal):Promise<ResearchPage[]>=>[await fetchPublicPage(urls[0],{signal})];

export async function runCompanyResearch(lease:JobLease,deps:ResearchAdapters={}):Promise<void>{
 const job=await readLeasedJob(lease),request=job.input as Extract<ProspectingInput,{kind:'qualification'}>;
 if(!request.companyResearch)throw new AppError(409,'Modo de investigação indisponível.');
 const signal=deps.signal??new AbortController().signal;
 try{
  if(job.state==='cancelling'){if(await cancelRemoteRuns(lease,job,{apify:deps.apify,signal}))await finishJob(lease,'cancelled');return;}
  const cases=await researchTransaction(lease,async c=>(await c.query("SELECT * FROM app.research_case WHERE job_id=$1 AND state='pending' ORDER BY lead_id LIMIT 1",[lease.jobId])).rows);
  for(const companyCase of cases){
   signal.throwIfAborted();const lead=companyCase.basis as Lead,options=request.companyResearch,registry=researchSourceRegistry(),missing:string[]=[],pages:ResearchPage[]=[];
   let site=lead.site;
   if(!site&&options.sourceKinds.some(k=>k==='website'||k==='social')){
    if(registry.webSearch.available){const candidate=await sourceResult(lease,job,lead,'website',{apify:deps.apify,signal});if(candidate===null)return;site=candidate.site;pages.push(...(candidate.evidence??[]).slice(0,1).map(e=>({...e,sourceKind:'website' as const})));if(!site)missing.push('SITE_NAO_ENCONTRADO');}
    else missing.push('BUSCA_SITE_INDISPONIVEL');
   }
   if(options.sourceKinds.includes('registry')){
    if(registry.registry.available&&lead.cnpj){const candidate=await sourceResult(lease,job,lead,'registry',{apify:deps.apify,signal});if(candidate===null)return;if(candidate.cnpj&&normalizeCnpj(candidate.cnpj)!==normalizeCnpj(lead.cnpj))missing.push('CADASTRO_DIVERGENTE');else pages.push(...(candidate.evidence??[]).slice(0,1).map(e=>({...e,sourceKind:'registry' as const})));}
    else missing.push(lead.cnpj?'CONSULTA_CADASTRAL_INDISPONIVEL':'CNPJ_NAO_INFORMADO');
   }
   const queue:{url:string;kind:ResearchKind}[]=site&&options.sourceKinds.some(k=>k==='website'||k==='social')?[{url:site,kind:'website'}]:[],seen=new Set<string>();
   let fetched=pages.length;
   while(queue.length&&fetched<options.maxPagesPerCompany){
    const entry=queue.shift()!,url=researchUrl(entry.url);if(!url||seen.has(url.toString())){if(!url)missing.push('FONTE_PUBLICA_INVALIDA');continue;}seen.add(url.toString());fetched++;
    let collected:ResearchPage[];
    try{collected=await performStep(lease,'research-page:'+lead.id+':'+hashValue(url.toString()),'public-web',{},async()=>{
      const result=await(deps.collect??defaultCollect)(entry.kind,[url.toString()],signal);
      return result.slice(0,1).map(p=>({...p,text:pageQuote(p),hash:hashValue(pageQuote(p)),sourceKind:entry.kind}));
    });}catch(e){if(e instanceof UncertainStep||e instanceof AppError||signal.aborted)throw e;missing.push(entry.kind==='social'?'REDE_SOCIAL_INDISPONIVEL':'PAGINA_INDISPONIVEL');continue;}
    for(const page of collected){
     if(!researchUrl(page.url)){missing.push('FONTE_PUBLICA_INVALIDA');continue;}
     page.corroborated=supportsCompany(lead,page,entry.kind);pages.push(page);
     const matched=matchCompanySource({companyDomain:lead.site??'',candidateDomain:page.url,corroborated:page.corroborated})==='matched';
     if(entry.kind==='website'&&matched){
      for(const link of page.links??[])if(researchUrl(link)&&matchCompanySource({companyDomain:site??'',candidateDomain:link,corroborated:false})==='matched'&&/contato|contact|sobre|about|equipe/i.test(new URL(link).pathname))queue.push({url:link,kind:'website'});
      if(options.sourceKinds.includes('social'))for(const link of page.socialLinks??[])if(socialField(link))queue.push({url:link,kind:'social'});
     }
    }
   }
   if(queue.length)missing.push('LIMITE_DE_PAGINAS');if(!pages.length)missing.push('SEM_FONTE_PUBLICA');
   const bounded=pages.slice(0,options.maxPagesPerCompany).map(p=>({...p,id:hashValue({job:lease.jobId,lead:lead.id,url:p.url,text:p.text}),hash:hashValue(p.text),corroborated:supportsCompany(lead,p,p.sourceKind??'website')}));
   const facts=extractCompanyFacts(lead,bounded).map(f=>({...f,id:hashValue({job:lease.jobId,lead:lead.id,field:f.field,value:f.value,attribution:f.attribution})}));
   if(facts.some(f=>f.attribution==='uncertain'))missing.push('VINCULO_A_CONFIRMAR');
   await researchTransaction(lease,async c=>{
    const current=(await c.query('SELECT payload FROM app.lead WHERE id=$1',[lead.id])).rows[0]?.payload;
    if(!current||hashValue(researchLeadBasis(current))!==hashValue(researchLeadBasis(lead)))throw new AppError(409,'Os dados do contato mudaram durante a investigação.','RESEARCH_SOURCE_CHANGED');
    for(const page of bounded){const attribution=matchCompanySource({companyDomain:lead.site??'',candidateDomain:page.url,corroborated:page.corroborated===true})==='matched'?'company':'uncertain';await c.query('INSERT INTO app.research_source(workspace_id,job_id,id,lead_id,url,text,hash,fetched_at,source_kind,attribution,links) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING',[lease.workspaceId,lease.jobId,page.id,lead.id,page.url,page.text,page.hash,page.fetchedAt,page.sourceKind??'website',attribution,JSON.stringify(page.links??[])]);}
    for(const fact of facts)await c.query('INSERT INTO app.research_fact(workspace_id,job_id,id,lead_id,field,value,evidence,attribution) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',[lease.workspaceId,lease.jobId,fact.id,lead.id,fact.field,fact.value,JSON.stringify(fact.evidence),fact.attribution]);
    await c.query('UPDATE app.research_case SET state=$3,missing=$4 WHERE job_id=$1 AND lead_id=$2',[lease.jobId,lead.id,missing.length?'partial':'completed',JSON.stringify([...new Set(missing)])]);
    await c.query("UPDATE app.prospecting_job SET revision=revision+1,updated_at=clock_timestamp(),counts=jsonb_build_object('found',(SELECT count(*) FROM app.research_case WHERE job_id=$1 AND state<>'pending'),'pending',(SELECT count(*) FROM app.research_fact WHERE job_id=$1 AND attribution='company' AND NOT applied),'inserted',0,'duplicates',0,'rejected',(SELECT count(*) FROM app.research_case WHERE job_id=$1 AND state='partial')) WHERE id=$1",[lease.jobId]);
   });
  }
  if(await researchTransaction(lease,async c=>!!(await c.query("SELECT 1 FROM app.research_case WHERE job_id=$1 AND state='pending' LIMIT 1",[lease.jobId])).rowCount))return;
  const partial=await researchTransaction(lease,async c=>!!(await c.query("SELECT 1 FROM app.research_case WHERE job_id=$1 AND state='partial' LIMIT 1",[lease.jobId])).rowCount);
  await finishJob(lease,partial?'partial':'completed');
 }catch(e){
  if(e instanceof AppError&&e.status===403)throw e;
  const current=await readLeasedJob(lease);
  if(current.state==='cancelling'){if(await cancelRemoteRuns(lease,current,{apify:deps.apify,signal}))await finishJob(lease,'cancelled');return;}
  await handleStepFailure(lease,e);
 }
}
