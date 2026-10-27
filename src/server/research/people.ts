import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import type {Lead} from '../../domain/model.ts';
import type {JobLease,Evidence,Candidate} from '../../domain/prospecting.ts';
import type {EvidenceRef,Reviewed} from '../../domain/reviewed-operation.ts';
import type {CompanyIdentity,CompanyPerson,PeopleAdapters,PeopleApplication,PeopleCaseView,IdentityCandidate} from '../../domain/company-people.ts';
import {peopleContractVersion,reviewCompanyPeople,resolveIdentityCandidates,sanitizePeopleSource} from '../../domain/company-people.ts';
import {researchUrl,matchCompanySource} from '../../domain/company-research.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {withLeasedTransaction} from '../prospecting/worker-db.ts';
import {readLeasedJob,performStep,finishJob,handleStepFailure,UncertainStep} from '../prospecting/journal.ts';
import {sourceResults,preflight} from '../prospecting/qualification.ts';
import {decide} from '../prospecting/ai/jev.ts';
import {cancelRemoteRuns} from '../prospecting/enrichment.ts';
import {fetchPublicPage} from '../prospecting/extraction/fetch-page.ts';
import {extractCnpjs} from '../prospecting/extraction/contacts.ts';
import {normalizeCnpj} from '../prospecting/normalize.ts';
import {hashValue,createReviewToken,verifyReviewToken} from '../prospecting/review.ts';
import {assertAiRouteCurrent} from '../prospecting/ai/route-guard.ts';
import {conventionalUnit} from '../prospecting/ai/conventional.ts';
import {generateCompanyPeople} from '../prospecting/ai/decisors.ts';
import {prospectingConfig} from '../prospecting/config.ts';
import {assertExecution} from '../billing/entitlements.ts';
import {readApprovedContext} from '../context/repository.ts';
import {requirePermission} from '../auth/permissions.ts';
import {AppError} from '../errors.ts';
import {ProviderError} from '../prospecting/providers/transport.ts';
import {reusablePeople} from './identity.ts';
const ids=z.array(z.string().min(1).max(120)).min(1).max(100).refine(v=>new Set(v).size===v.length);
const application=z.strictObject({caseId:z.string().min(1).max(120),personIds:ids,expectedRevision:z.number().int().nonnegative()});
const confirmation=z.strictObject({input:application,token:z.string().min(1).max(8192),requestId:z.uuid()});
function parse<T>(schema:z.ZodType<T>,value:unknown){const r=schema.safeParse(value);if(!r.success)throw new AppError(422,'Revise as pessoas selecionadas.');return r.data;}
const secret=()=>{if(!process.env.BETTER_AUTH_SECRET)throw Error('Review signing unavailable');return process.env.BETTER_AUTH_SECRET;};
async function authorize(c:PoolClient,p:Principal){requirePermission({...p,role:(await c.query('SELECT app.current_role() role')).rows[0].role},'data.write');}
async function evidenceValid(c:PoolClient,job:string,lead:string,evidence:EvidenceRef[]){return !!(await c.query('SELECT app.people_evidence_valid(current_setting(\'app.workspace_id\'),$1,$2,$3) ok',[job,lead,JSON.stringify(evidence)])).rows[0].ok;}
async function readPeople(c:PoolClient,id:string,leadId?:string):Promise<PeopleCaseView>{
 const job=(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[id])).rows[0];if(!job?.input?.companyPeople)throw new AppError(404,'Investigação de pessoas não encontrada.');
 const rows=(await c.query('SELECT * FROM app.research_case WHERE job_id=$1 ORDER BY lead_id',[id])).rows,selected=rows.find(r=>r.lead_id===(leadId??rows[0]?.lead_id));if(!selected)throw new AppError(404,'Empresa não encontrada nesta investigação.');
 const raw=(await c.query('SELECT * FROM app.research_company_identity WHERE case_id=$1',[selected.id])).rows[0];
 const valid=raw&&await evidenceValid(c,id,selected.lead_id,raw.evidence);
 const identity:CompanyIdentity={caseId:selected.id,state:raw&&valid?raw.state:'missing',cnpj:valid?raw.cnpj:null,legalName:valid?raw.legal_name:null,evidence:valid?raw.evidence:[]};
 const people:CompanyPerson[]=[];
 for(const r of(await c.query('SELECT p.*,pc.relationship,pc.current_state,pc.applied_lead_id FROM app.research_person p JOIN app.research_person_company pc ON pc.workspace_id=p.workspace_id AND pc.case_id=p.case_id AND pc.person_id=p.id WHERE p.case_id=$1 ORDER BY p.name,p.id',[selected.id])).rows){
  const supported=identity.state==='resolved'&&await evidenceValid(c,id,selected.lead_id,r.evidence),contacts=[];
  for(const contact of(await c.query('SELECT * FROM app.research_person_contact WHERE case_id=$1 AND person_id=$2 ORDER BY kind,value',[selected.id,r.id])).rows){if(await evidenceValid(c,id,selected.lead_id,contact.evidence))contacts.push({kind:contact.kind,value:contact.value,attribution:supported?contact.attribution:'unresolved',evidence:contact.evidence});}
  people.push({id:r.id,name:r.name,role:r.role,relationship:r.relationship,current:supported?r.current_state:'uncertain',contacts,evidence:supported?r.evidence:[],applied:!!r.applied_lead_id});
 }
 const active=['queued','running','waiting_provider','cancelling','needs_reconciliation'].includes(job.state),companies=rows.map(r=>({leadId:r.lead_id,name:r.name,state:r.state==='pending'&&!active?'unavailable':r.state,missing:r.missing as string[]}));
 return{id,revision:Number(job.revision),state:job.state,selectedLeadId:selected.lead_id,companies,identity,people,missing:selected.missing};
}
export function readCompanyPeople(p:Principal,id:string,leadId?:string){return withWorkspaceTransaction(p,c=>readPeople(c,id,leadId));}
export function latestCompanyPeople(p:Principal,leadId:string){return withWorkspaceTransaction(p,async c=>{if(!(await c.query('SELECT 1 FROM app.lead WHERE id=$1',[leadId])).rowCount)throw new AppError(404,'Contato não encontrado.');const r=(await c.query("SELECT r.job_id FROM app.research_case r JOIN app.prospecting_job j ON j.workspace_id=r.workspace_id AND j.id=r.job_id WHERE r.lead_id=$1 AND j.input->>'companyPeople'='true' ORDER BY r.created_at DESC LIMIT 1",[leadId])).rows[0];return r?readPeople(c,r.job_id,leadId):null;});}
async function applicationState(c:PoolClient,p:Principal,input:PeopleApplication){
 await authorize(c,p);const first=await readPeople(c,input.caseId);if(!['completed','partial'].includes(first.state)||first.revision!==input.expectedRevision)throw new AppError(409,'A investigação mudou. Revise novamente.');
 const job=(await c.query('SELECT checkpoint FROM app.prospecting_job WHERE id=$1',[input.caseId])).rows[0],context=await readApprovedContext(c);if((context?.version??0)!==(job.checkpoint.context?.version??0))throw new AppError(409,'O contexto da empresa mudou. Prepare uma nova investigação.');
 const selected:CompanyPerson[]=[];
 for(const company of first.companies){const view=await readPeople(c,input.caseId,company.leadId),people=view.people.filter(p=>input.personIds.includes(p.id));if(!people.length)continue;
  const source=(await c.query('SELECT payload FROM app.lead WHERE id=$1',[company.leadId])).rows[0]?.payload;if(!source||hashValue(source)!==hashValue(job.checkpoint.bases[company.leadId]))throw new AppError(409,'Os dados do contato mudaram. Prepare uma nova investigação.');
  if(view.identity.state!=='resolved'||people.some(p=>p.applied||p.current!=='supported'||!p.contacts.some(c=>c.attribution==='personal'&&['email','phone'].includes(c.kind))))throw new AppError(409,'Selecione pessoas com vínculo e contato pessoal comprovados.');selected.push(...people);
 }
 if(selected.length!==input.personIds.length)throw new AppError(409,'A seleção ou suas fontes mudaram. Revise novamente.');
 return{action:'people.apply',workspaceId:p.workspaceId,userId:p.userId,input,selected,contextVersion:context?.version??0};
}
export async function preparePeopleApplication(p:Principal,value:unknown):Promise<Reviewed<PeopleApplication>>{const input=parse(application,value);return withWorkspaceTransaction(p,async c=>{const proof=await applicationState(c,p,input);return{input,token:createReviewToken(proof,secret()),expiresAt:new Date(Date.now()+600000).toISOString(),blockers:[],warnings:['Somente contatos pessoais publicados serão criados. Isso não comprova consentimento nem atividade de WhatsApp.'],basisHash:hashValue(proof)};});}
export async function confirmPeopleApplication(p:Principal,value:unknown):Promise<{applied:number}>{const body=parse(confirmation,value);return withWorkspaceTransaction(p,async c=>{
 await authorize(c,p);await c.query('SELECT revision FROM app.workspace_meta WHERE workspace_id=$1 FOR UPDATE',[p.workspaceId]);const digest=hashValue({action:'people.apply',input:body.input}),old=(await c.query('SELECT * FROM app.command_result WHERE request_id=$1',[body.requestId])).rows[0];if(old){if(old.user_id!==p.userId||old.body_hash!==digest)throw new AppError(409,'Este identificador já foi utilizado.');return old.result;}
 const proof=await applicationState(c,p,body.input);verifyReviewToken(body.token,proof,secret());let result:{applied:number};try{result=(await c.query('SELECT app.apply_company_people($1,$2,$3) result',[body.input.caseId,body.input.personIds,body.input.expectedRevision])).rows[0].result;}catch(e){if(e instanceof Error&&/^(RESEARCH_|PEOPLE_)/.test(e.message))throw new AppError(409,'A seleção ou suas fontes mudaram. Revise novamente.');throw e;}
 await c.query("INSERT INTO app.command_result VALUES(current_setting('app.workspace_id'),$1,$2,$3,$4)",[body.requestId,p.userId,digest,result]);await c.query("INSERT INTO app.audit(workspace_id,user_id,action) VALUES($1,$2,'research.people.apply')",[p.workspaceId,p.userId]);return result;
});}
async function publication<T>(lease:JobLease,job:any,fn:(c:PoolClient)=>Promise<T>,freshOperationId?:string){return withLeasedTransaction(lease,async c=>{
 if(!['owner','admin','operator'].includes((await c.query('SELECT app.current_role() role')).rows[0].role))throw new AppError(403,'A permissão para investigar mudou.');await assertExecution(c);if(!job.input.companyPeople||job.checkpoint.execution.version!==prospectingConfig().version)throw new AppError(409,'A configuração mudou.','PROFILE_CHANGED');await assertAiRouteCurrent(c,job,freshOperationId);const ctx=await readApprovedContext(c);if((ctx?.version??0)!==(job.checkpoint.context?.version??0))throw new AppError(409,'O contexto da empresa mudou.','RESEARCH_CONTEXT_CHANGED');
 await c.query("SELECT set_config('app.research_token',$1,true),set_config('app.research_fence',$2,true)",[lease.token,String(lease.fence)]);return fn(c);
});}
function safeEvidence(lease:JobLease,lead:Lead,e:Evidence):Evidence{const text=sanitizePeopleSource(e.text);return{...e,text,hash:hashValue(text),id:hashValue({job:lease.jobId,lead:lead.id,url:e.url,text})};}
const ref=(e:Evidence):EvidenceRef=>({id:e.id,url:e.url,quote:e.text,fetchedAt:e.fetchedAt,hash:e.hash,sourceVersion:peopleContractVersion});
const fold=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export async function resolveCompanyPeople(lease:JobLease,deps:PeopleAdapters={}):Promise<void>{
 const job=await readLeasedJob(lease);if(!job.input.companyPeople)throw new AppError(409,'Investigação de pessoas indisponível.');const signal=deps.signal??new AbortController().signal;
 try{
  if(job.state==='cancelling'){const unknown=await withLeasedTransaction(lease,async c=>!!(await c.query("SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND (state IN('prepared','uncertain') OR payload->'result'->>'kind'='uncertain') LIMIT 1",[lease.jobId])).rowCount);if(unknown){await finishJob(lease,'needs_reconciliation','CANCEL_UNCERTAIN');return;}if(await cancelRemoteRuns(lease,job,{apify:deps.apify,signal}))await finishJob(lease,'cancelled');return;}
  const row=await publication(lease,job,async c=>(await c.query("SELECT * FROM app.research_case WHERE job_id=$1 AND state='pending' ORDER BY lead_id LIMIT 1",[lease.jobId])).rows[0]);
  if(!row){await finishJob(lease,'completed');return;}
  const lead=row.basis as Lead,checkpoint=job.checkpoint.enrichment,group=checkpoint.groups.find((g:any)=>g.leadId===lead.id),missing:string[]=[];
  const cache=await publication(lease,job,c=>reusablePeople(c,group.identityKey,checkpoint.contract));
  let identity:CompanyIdentity,people:CompanyPerson[],pages:Evidence[]=[],cacheFrom:string|null=null,assessment:unknown=null,expiry=new Date(Date.now()+7*86400000).toISOString();
  if(cache){
   const old=await withLeasedTransaction(lease,async c=>({view:await readPeople(c,cache.job_id,cache.lead_id),pages:(await c.query('SELECT * FROM app.research_source WHERE job_id=$1 AND lead_id=$2 ORDER BY id',[cache.job_id,cache.lead_id])).rows}));
   const map=new Map<string,EvidenceRef>();pages=old.pages.map(r=>{const e=safeEvidence(lease,lead,{id:r.id,url:r.url,text:r.text,hash:r.hash,fetchedAt:new Date(r.fetched_at).toISOString(),truncated:false});map.set(r.id,ref(e));return e;});const remap=(refs:EvidenceRef[])=>refs.map(e=>({...map.get(e.id)!,quote:e.quote}));
   identity={...old.view.identity,caseId:row.id,evidence:remap(old.view.identity.evidence)};people=old.view.people.map(p=>({...p,id:hashValue({case:row.id,name:fold(p.name)}),applied:false,evidence:remap(p.evidence),contacts:p.contacts.map(c=>({...c,evidence:remap(c.evidence)}))}));missing.push(...old.view.missing);cacheFrom=cache.case_id;assessment=cache.assessment;expiry=new Date(cache.expires_at).toISOString();
  }else if(group.cacheId||!checkpoint.groups.filter((g:any)=>!g.cacheId).slice(0,checkpoint.reserveCredits).some((g:any)=>g.leadId===lead.id)){
   identity={caseId:row.id,cnpj:null,legalName:null,state:'missing',evidence:[]};people=[];missing.push(group.cacheId?'CACHE_EXPIRADO':'LIMITE_DO_LOTE');
  }else{
   const failed=async(step:string)=>withLeasedTransaction(lease,async c=>!!(await c.query("SELECT 1 FROM app.prospecting_attempt WHERE job_id=$1 AND step=$2 AND state='failed'",[lease.jobId,step])).rowCount);
   const collect=async(url:string)=>{const parsed=researchUrl(url);if(!parsed){missing.push('FONTE_INVALIDA');return;}const step='people-page:'+lead.id+':'+hashValue(parsed.toString());if(await failed(step)){missing.push('PAGINA_INDISPONIVEL');return;}try{const e=await performStep(lease,step,'public-web',{},async()=>{const page=await(deps.collect??((url,signal)=>fetchPublicPage(url,{signal})))(parsed.toString(),signal);return page?safeEvidence(lease,lead,page):null;});if(e&&researchUrl(e.url))pages.push(e);}catch(e){if(e instanceof AppError||e instanceof UncertainStep||signal.aborted)throw e;missing.push('PAGINA_INDISPONIVEL');}};
   const lookup=async(module:'website'|'registry',candidate:Lead,suffix:string,partners=false)=>{const step=module+':'+lead.id+':'+suffix;if(await failed(step)){missing.push('FONTE_INDISPONIVEL');return[];}try{const result=await sourceResults(lease,job,candidate,module,{apify:deps.apify,signal},{suffix,partners,limit:5});if(result===null)return null;for(const r of result)pages.push(...(r.evidence??[]).filter(e=>researchUrl(e.url)).slice(0,1).map(e=>safeEvidence(lease,lead,e)));return result;}catch(e){if(e instanceof AppError||e instanceof UncertainStep||e instanceof ProviderError&&e.uncertain||signal.aborted)throw e;missing.push('FONTE_INDISPONIVEL');return[];}};
   if(lead.site)await collect(lead.site);
   const candidates:IdentityCandidate[]=[],known=normalizeCnpj(lead.cnpj),companyPages=()=>pages.filter(p=>matchCompanySource({companyDomain:lead.site??'',candidateDomain:p.url,corroborated:false})==='matched'&&[lead.name,lead.companyName].some(n=>n&&fold(p.text).includes(fold(n))));
   const addSiteCnpjs=()=>{for(const p of companyPages())for(const cnpj of extractCnpjs([p]))candidates.push({cnpj,legalName:lead.companyName??lead.name,corroborated:true,evidence:[ref(p)]});};addSiteCnpjs();
   if(!known&&!candidates.length&&prospectingConfig().ready.WEB){const found=await lookup('website',{...lead,name:[lead.companyName??lead.name,'CNPJ'].join(' ')},'identity');if(found===null)return;for(const r of found){const corroborated=!!(r.site&&lead.site&&matchCompanySource({companyDomain:lead.site,candidateDomain:r.site,corroborated:false})==='matched')||!!(lead.city&&r.city&&fold(lead.city)===fold(r.city)&&fold(r.name)===fold(lead.companyName??lead.name));if(r.cnpj&&corroborated)candidates.push({cnpj:r.cnpj,legalName:r.companyName??r.name,corroborated,evidence:(r.evidence??[]).map(e=>ref(safeEvidence(lease,lead,e)))});}}
   const cnpjs=[...new Set(candidates.map(c=>c.cnpj))],cnpj=known??(cnpjs.length===1?cnpjs[0]:null);let registries:Candidate[]=[];
   if(cnpj&&prospectingConfig().ready.CNPJ){const r=await lookup('registry',{...lead,cnpj},'people',true);if(r===null)return;registries=r;for(const r of registries){const corroborated=!!r.cnpj&&(fold(r.name)===fold(lead.name)||fold(r.companyName??'')===fold(lead.companyName??lead.name)||!!(r.site&&lead.site&&matchCompanySource({companyDomain:lead.site,candidateDomain:r.site,corroborated:false})==='matched'));if(r.cnpj)candidates.push({cnpj:r.cnpj,legalName:r.companyName??r.name,corroborated,evidence:(r.evidence??[]).map(e=>ref(safeEvidence(lease,lead,e)))});}}
   identity=resolveIdentityCandidates(row.id,lead,candidates);if(identity.state!=='resolved')missing.push(identity.state==='conflict'?'IDENTIDADE_EM_CONFLITO':'CNPJ_NAO_CONFIRMADO');
   const partners=registries.filter(r=>r.cnpj===identity.cnpj).flatMap(r=>(Array.isArray(r.facts?.decisionMakers)?r.facts!.decisionMakers:[]).slice(0,50).flatMap((p:any)=>{const e=pages.find(e=>e.text.includes(p.name)&&e.text.includes(p.role));return e&&typeof p.name==='string'&&typeof p.role==='string'?[{name:p.name,role:p.role,evidence:ref(e)}]:[];}));
   if(prospectingConfig().ready.WEB){const r=await lookup('website',{...lead,name:[lead.companyName??lead.name,...partners.slice(0,2).map(p=>p.name),'diretor gestor contato site:linkedin.com/in/'].join(' ')},'people');if(r===null)return;for(const url of [...new Set(r.flatMap(r=>[r.site,...(r.evidence??[]).map(e=>e.url)]).filter((u):u is string=>!!u&&!!researchUrl(u)))].slice(0,2))if(!pages.some(p=>p.url===url))await collect(url);}
   pages=[...new Map(pages.slice(0,10).map(e=>[e.id,e])).values()];let proposed:unknown={people:[]};
   if(pages.length){const route=job.checkpoint.execution.aiRoute.conventional,step='people-model:'+lead.id,operationId=hashValue({job:lease.jobId,step}),slot=(release:boolean)=>withLeasedTransaction(lease,async c=>!!(await c.query('SELECT app.codex_prospecting_slot($1,$2,$3,$4) ok',[lease.jobId,lease.token,lease.fence,release])).rows[0].ok);
    const generated=await performStep(lease,step,route.provider==='codex-local'?'codex':route.provider,{[conventionalUnit(route.provider)]:1},async()=>{await publication(lease,job,async()=>{},operationId);const result=await(deps.generate??generateCompanyPeople)({workspaceId:lease.workspaceId,operationId,signal,route,acquireSlot:()=>slot(false),releaseSlot:async()=>{await slot(true);}},{company:lead,knownNames:partners.map(p=>p.name),evidence:pages,context:job.checkpoint.context,request:{targetCompany:lead.name,identity:identity.state}});return{people:reviewCompanyPeople({company:lead,identity,sources:pages.map(ref),partners,proposed:result.value}),usage:result.usage};},r=>r.usage);proposed=generated.people;}
   people=(Array.isArray(proposed)?proposed as CompanyPerson[]:reviewCompanyPeople({company:lead,identity,sources:pages.map(ref),partners,proposed})).map(p=>({...p,id:hashValue({case:row.id,name:fold(p.name)})}));if(!people.length)missing.push('PESSOAS_NAO_CONFIRMADAS');if(!people.some(p=>p.contacts.some(c=>c.attribution==='personal'&&['email','phone'].includes(c.kind))))missing.push('SEM_CONTATO_PESSOAL_PUBLICADO');
   if(pages.length&&job.checkpoint.execution.aiRoute.decisionProvider==='jev')assessment=await performStep(lease,'people-assessment:'+lead.id,'openrouter',{jevCalls:1},async()=>{await preflight(lease,job,{signal,apify:deps.apify},true);return(deps.decide??decide)({operationId:hashValue({job:lease.jobId,step:'people-assessment:'+lead.id}),signal,credential:process.env.OPENROUTER_API_KEY??''},{company:job.checkpoint.context,request:{targetCompany:lead.name},intent:'contact-evidence',criteria:'Assess company identity, current decision-making role and explicit personal-contact attribution. Registry names are not personal contacts. Preserve absence and conflicts; never infer contact or WhatsApp activity.',facts:{company:lead.name,identity:identity.state,people},evidence:pages});},r=>r.usage);
  }
  await publication(lease,job,async c=>{
   const current=(await c.query('SELECT payload FROM app.lead WHERE id=$1 FOR UPDATE',[lead.id])).rows[0]?.payload;if(!current||hashValue(current)!==hashValue(lead))throw new AppError(409,'Os dados do contato mudaram.','RESEARCH_SOURCE_CHANGED');
   for(const e of pages)await c.query("INSERT INTO app.research_source(workspace_id,job_id,id,lead_id,url,text,hash,fetched_at,source_kind,attribution) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'website','company') ON CONFLICT DO NOTHING",[lease.workspaceId,lease.jobId,e.id,lead.id,e.url,e.text,e.hash,e.fetchedAt]);
   await c.query('INSERT INTO app.research_company_identity(workspace_id,case_id,job_id,lead_id,identity_key,contract,cnpj,legal_name,state,evidence,expires_at,cache_from,assessment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[lease.workspaceId,row.id,lease.jobId,lead.id,group.identityKey,checkpoint.contract,identity.cnpj,identity.legalName,identity.state,JSON.stringify(identity.evidence),expiry,cacheFrom,assessment]);
   for(const p of people){await c.query('INSERT INTO app.research_person(workspace_id,case_id,id,name,role,evidence) VALUES($1,$2,$3,$4,$5,$6)',[lease.workspaceId,row.id,p.id,p.name,p.role,JSON.stringify(p.evidence)]);await c.query('INSERT INTO app.research_person_company(workspace_id,case_id,person_id,relationship,current_state) VALUES($1,$2,$3,$4,$5)',[lease.workspaceId,row.id,p.id,p.relationship,p.current]);for(const contact of p.contacts)await c.query('INSERT INTO app.research_person_contact(workspace_id,case_id,person_id,kind,value,attribution,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)',[lease.workspaceId,row.id,p.id,contact.kind,contact.value,contact.attribution,JSON.stringify(contact.evidence)]);}
   await c.query('SELECT app.finish_company_people($1,$2,$3)',[lease.jobId,lead.id,JSON.stringify([...new Set(missing)])]);await c.query("UPDATE app.prospecting_job SET revision=revision+1,updated_at=clock_timestamp(),counts=counts||jsonb_build_object('found',(SELECT count(*) FROM app.research_case WHERE job_id=$1 AND state<>'pending'),'pending',(SELECT count(*) FROM app.research_person p JOIN app.research_company_identity i USING(workspace_id,case_id) WHERE i.job_id=$1)) WHERE id=$1",[lease.jobId]);
  });
  const pending=await withLeasedTransaction(lease,async c=>!!(await c.query("SELECT 1 FROM app.research_case WHERE job_id=$1 AND state='pending'",[lease.jobId])).rowCount);if(!pending){const partial=await withLeasedTransaction(lease,async c=>!!(await c.query("SELECT 1 FROM app.research_case WHERE job_id=$1 AND state='partial'",[lease.jobId])).rowCount);await finishJob(lease,partial?'partial':'completed');}
 }catch(e){if(e instanceof UncertainStep)return;if(e instanceof AppError&&e.status===403)throw e;const current=await readLeasedJob(lease);if(current.state==='cancelling'){if(await cancelRemoteRuns(lease,current,{apify:deps.apify,signal}))await finishJob(lease,'cancelled');return;}await handleStepFailure(lease,e);}
}
