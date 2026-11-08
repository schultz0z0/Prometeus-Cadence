import type {CandidatePage,JobLease,UsageEstimate} from '../../domain/prospecting.ts';
import type {Lead} from '../../domain/model.ts';
import {fetchEvidencePack} from './extraction/fetch-page.ts';
import {extractCnpjs} from './extraction/contacts.ts';
import {companySiteCandidates,institutionalSite,phoneIdentity,sourceResults,verifySiteContent,type QualificationAdapters} from './qualification.ts';
import {strongIdentities} from './normalize.ts';
import {performStep} from './journal.ts';
import {hashValue} from './review.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {ProviderError} from './providers/transport.ts';
import {ApifySiteCrawler} from './providers/site-crawler.ts';
import type {ProviderContext} from './providers/types.ts';
import {finishJob} from './journal.ts';
import {approvePublicUrl} from './extraction/public-url.ts';

export const discoveryScanLimit=(requested:number)=>Math.min(500,requested*2);
export function discoveryUsage(scanLimit:number):UsageEstimate[]{
  return [
    {provider:'apify',unit:'candidates',maxUnits:scanLimit,estimatedUsd:null,pricingSource:null},
    {provider:'apify',unit:'apifyRuns',maxUnits:2+8*scanLimit,estimatedUsd:null,pricingSource:null},
  ];
}

export async function markDiscoveryRunDone(lease:JobLease,runId:string){
  await withLeasedTransaction(lease,c=>c.query(
    "UPDATE app.prospecting_job SET checkpoint=jsonb_set(checkpoint,'{cleanupDone}',COALESCE(checkpoint->'cleanupDone','[]'::jsonb)||to_jsonb($2::text),true) WHERE id=$1 AND NOT COALESCE(checkpoint->'cleanupDone','[]'::jsonb) ? $2",
    [lease.jobId,runId]));
}

async function crawlSite(lease:JobLease,job:any,url:string,step:string,deps:QualificationAdapters){
 const options=job.checkpoint.execution.siteCrawler,signal=deps.signal??new AbortController().signal;
 const adapter=deps.siteCrawler??new ApifySiteCrawler();
 const ctx:ProviderContext={operationId:hashValue({job:lease.jobId,step}),signal,profile:{source:'WEB',...options,ppe:false},
  credential:process.env.APIFY_TOKEN??'',maxChargeUsd:job.checkpoint.execution.maxChargeUsd??0,maxPages:options.maxPages,targetUrl:url};
 const started=await performStep(lease,'crawl:'+step,'apify',{apifyRuns:1},async()=>{
  if(!deps.siteCrawler)await approvePublicUrl(url);
  return adapter.start(ctx,{kind:'generation',source:'WEB',destination:{mode:'existing',listId:job.list_id},filters:{term:url},limit:options.maxPages,dedupScope:'workspace'});
 },result=>({provider:'apify',operationId:ctx.operationId,units:result.kind==='uncertain'?{}:{apifyRuns:1},costUsd:null,costKind:'unknown'}));
 if(started.kind==='uncertain'){await finishJob(lease,'needs_reconciliation','START_UNCERTAIN');return null;}
 if(started.kind==='inline')return started.page.candidates.flatMap(candidate=>candidate.evidence??[]);
 const state=await adapter.poll(ctx,started.run);
 if(['succeeded','failed','cancelled'].includes(state.status))await markDiscoveryRunDone(lease,started.run.runId);
 if(['failed','cancelled'].includes(state.status))return[];
 if(state.status!=='succeeded')return null;
 return performStep(lease,'crawl-pages:'+step,'public-web',{},async()=>{
  const page=await adapter.readPage(ctx,state.run,null,options.maxPages);
  return page.candidates.flatMap(candidate=>candidate.evidence??[]);
 });
}

export async function admitDiscoveryPage(lease:JobLease,job:any,page:CandidatePage,deps:QualificationAdapters):Promise<CandidatePage|null>{
  const candidates:CandidatePage['candidates']=[],rejected=[...page.rejected];
  const signal=deps.signal??new AbortController().signal;
  for(const candidate of page.candidates){
    if(candidate.facts?.permanentlyClosed===true){rejected.push({sourceRef:candidate.sourceRef,reason:'PERMANENTLY_CLOSED'});continue;}
    const duplicate=await withLeasedTransaction(lease,async c=>(await c.query(
      'SELECT 1 FROM app.lead_identity WHERE identity=ANY($1::text[]) LIMIT 1',[strongIdentities(candidate)])).rowCount);
    if(duplicate){candidates.push(candidate);continue;}
    const site=institutionalSite(candidate.site),phone=phoneIdentity(candidate.phone??'');
    const reject=(reason:string)=>rejected.push({sourceRef:candidate.sourceRef,reason});
    if(!/^\d{10,11}$/.test(phone)){reject('PHONE_REQUIRED');continue;}
    const key=hashValue(candidate.sourceRef);
    const lead:Lead={...candidate,id:key,listId:job.list_id,site,qualification:'pending',createdAt:new Date().toISOString()};
    const inspect=(url:string,step:string)=>job.checkpoint.execution?.siteCrawler&&!deps.collect?crawlSite(lease,job,url,step,deps):performStep(lease,step,'public-web',{},async()=>{
      const found=await(deps.collect??fetchEvidencePack)(url,{signal},true);
      const requested=new URL(url);
      return found.filter(item=>{
        const origin=institutionalSite(item.url);
        if(!origin)return false;
        const received=new URL(origin);
        return received.host===requested.host&&(requested.protocol==='http:'||received.protocol==='https:');
      });
    });
    let pages=site?await inspect(site,'admission-site:'+key):[];
    if(pages===null)return null;
    const onTerminal=(runId:string)=>markDiscoveryRunDone(lease,runId);
    if(!verifySiteContent({...lead,cnpj:undefined},pages)&&job.checkpoint.discoveryWebFallback){
      const results=await sourceResults(lease,job,lead.city?lead:{...lead,city:job.input.filters.location,state:undefined},'website',{...deps,signal},{limit:5,suffix:'admission',onTerminal});
      if(results===null)return null;
      pages=[];
      const tried=new Set(site?[site]:[]);
      for(const result of companySiteCandidates(results,lead,{allowTitleMatch:true})){
        const discovered=institutionalSite(result.site)!;
        if(tried.has(discovered))continue;
        tried.add(discovered);
        const evidence=await inspect(discovered,'admission-site:'+key+':'+hashValue(discovered));
        if(evidence===null)return null;
        if(!verifySiteContent({...lead,cnpj:undefined},evidence))continue;
        pages=evidence;
        if(extractCnpjs(pages).length===1)break;
      }
    }
    if(!verifySiteContent({...lead,cnpj:undefined},pages)){reject('SITE_IDENTITY_UNVERIFIED');continue;}
    const cnpjs=extractCnpjs(pages);
    if(cnpjs.length!==1){reject('CNPJ_UNVERIFIED');continue;}
    let companies;
    try{
      companies=await sourceResults(lease,job,{...lead,cnpj:cnpjs[0]},'registry',{...deps,signal},{partners:true,suffix:'admission',onTerminal});
    }catch(error){
      if(!(error instanceof ProviderError)||error.code!=='CNPJ_IDENTITY_MISMATCH')throw error;
      reject('CNPJ_IDENTITY_UNVERIFIED');continue;
    }
    if(companies===null)return null;
    const company=companies[0];
    if(company?.facts?.registrationStatus!=='ATIVA'){reject('CNPJ_NOT_CONFIRMED_ACTIVE');continue;}
    const keyName=(name:string)=>name.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const businessName=keyName(candidate.name);
    const registryName=[company.name,company.companyName].some(name=>name&&keyName(name)===businessName);
    if(!registryName&&phoneIdentity(company.phone??'')!==phone){reject('CNPJ_IDENTITY_UNVERIFIED');continue;}
    const cnpjPage=pages.find(item=>extractCnpjs([item]).includes(cnpjs[0]))!;
    candidates.push({...candidate,site:institutionalSite(pages[0].url),cnpj:cnpjs[0],companyName:company.companyName??company.name,cnae:company.cnae,size:company.size,
      facts:{...candidate.facts,...company.facts,admissionVerified:true},evidence:[...(candidate.evidence??[]).slice(0,1),...(company.evidence??[]).slice(0,1),pages[0],...(cnpjPage===pages[0]?[]:[cnpjPage])]});
  }
  return {...page,candidates,rejected};
}
