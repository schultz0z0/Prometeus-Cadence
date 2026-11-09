import type {CandidatePage,Evidence,JobLease,UsageEstimate} from '../../domain/prospecting.ts';
import type {Lead} from '../../domain/model.ts';
import {fetchEvidencePack} from './extraction/fetch-page.ts';
import {extractCnpjs} from './extraction/contacts.ts';
import {companySiteCandidates,institutionalSite,phoneIdentity,sourceResults,verifySiteContent,type QualificationAdapters} from './qualification.ts';
import {strongIdentities} from './normalize.ts';
import {performSiteRead} from './journal.ts';
import {hashValue} from './review.ts';
import {withLeasedTransaction} from './worker-db.ts';
import {ProviderError} from './providers/transport.ts';
import {collectSiteTick} from './site-collection.ts';
import {inRegistryWindow,isRegistryCandidate,registryMapsMatch,registrySiteMatches,registryWindow} from './registry-first.ts';

// Keep eight candidate slots for replacements after the initial Maps batch.
export const discoveryScanLimit=(requested:number)=>Math.min(500,requested*2+8);
export function discoveryUsage(scanLimit:number,registryFirst=false,registryDateSlices=false):UsageEstimate[]{
  return [
    {provider:'apify',unit:'candidates',maxUnits:scanLimit,estimatedUsd:null,pricingSource:null},
    {provider:'apify',unit:'apifyRuns',maxUnits:(registryFirst&&!registryDateSlices?1:2)+2*scanLimit,estimatedUsd:null,pricingSource:null},
  ];
}

export async function markDiscoveryRunDone(lease:JobLease,runId:string){
  await withLeasedTransaction(lease,c=>c.query(
    "UPDATE app.prospecting_job SET checkpoint=jsonb_set(checkpoint,'{cleanupDone}',COALESCE(checkpoint->'cleanupDone','[]'::jsonb)||to_jsonb($2::text),true) WHERE id=$1 AND NOT COALESCE(checkpoint->'cleanupDone','[]'::jsonb) ? $2",
    [lease.jobId,runId]));
}

export async function admitRegistryPage(lease:JobLease,job:any,page:CandidatePage,deps:QualificationAdapters):Promise<CandidatePage|null>{
 const candidates:CandidatePage['candidates']=[],rejected=[...page.rejected];
 const window=job.checkpoint.registryDateSlices?registryWindow(job.checkpoint.registryBatch??0):undefined;
 const seen=new Set<string>(job.checkpoint.examinedCnpjs??[]),examinedCnpjs:string[]=[];
 const onTerminal=(runId:string)=>markDiscoveryRunDone(lease,runId);
 for(const registry of page.candidates){
  const reject=(reason:string)=>rejected.push({sourceRef:registry.sourceRef,reason});
  if(!isRegistryCandidate(registry,job.checkpoint.registryFirst)){reject('CNPJ_OUTSIDE_SCOPE');continue;}
  if(window){
   if(!inRegistryWindow(registry.openedAt,window)){reject('CNPJ_OUTSIDE_DATE_WINDOW');continue;}
   if(seen.has(registry.cnpj!)){reject('CNPJ_ALREADY_EXAMINED');continue;}
   seen.add(registry.cnpj!);
   examinedCnpjs.push(registry.cnpj!);
  }
  const duplicate=await withLeasedTransaction(lease,async c=>(await c.query('SELECT 1 FROM app.lead_identity WHERE identity=ANY($1::text[]) LIMIT 1',[strongIdentities(registry)])).rowCount);
  if(duplicate){candidates.push(registry);continue;}
  const key=hashValue(registry.cnpj);
  const lead:Lead={...registry,id:key,listId:job.list_id,qualification:'pending',createdAt:new Date().toISOString()};
  const maps=await sourceResults(lease,job,lead,'maps',deps,{limit:3,suffix:'registry-first',onTerminal});
  if(maps===null)return null;
  const matches=maps.filter(candidate=>registryMapsMatch(registry,candidate));
  if(matches.length!==1){reject('MAPS_IDENTITY_UNVERIFIED');continue;}
  const [match]=matches;
  const observedLead={...lead,...match,companyName:registry.companyName};
  const mapsSite=institutionalSite(match.site);
  let sites=mapsSite?[mapsSite]:[];
  let verified=false;
  let webSearched=false;
  while(!verified){
   if(!sites.length){
    if(webSearched)break;
    const web=await sourceResults(lease,job,observedLead,'website',deps,{limit:5,suffix:'registry-first',onTerminal});
    if(web===null)return null;
    webSearched=true;
    sites=[...new Set(companySiteCandidates(web,observedLead,{allowTitleMatch:true}).flatMap(candidate=>{
      const site=institutionalSite(candidate.site);
      return site&&site!==mapsSite?[site]:[];
    }))];
    if(!sites.length)break;
   }
   const site=sites.shift()!;
   const result=await collectSiteTick(lease,site,deps.siteBrowser,deps.signal);
   await withLeasedTransaction(lease,c=>c.query(
     "UPDATE app.prospecting_job SET checkpoint=checkpoint||jsonb_build_object('siteCollections',COALESCE(checkpoint->'siteCollections','{}'::jsonb)||jsonb_build_object($2::text,$3::jsonb)), capacity_retry_at=$4, updated_at=now() WHERE id=$1",
     [lease.jobId,hashValue(site),JSON.stringify(result.coverage),result.retryAt]));
   if(!result.done)return null;
   const pages:Evidence[]=result.pages.map(page=>({id:hashValue({url:page.url,hash:page.hash}),url:page.url,text:page.text,hash:page.hash,fetchedAt:page.fetchedAt,truncated:page.truncated??false}));
   if(!registrySiteMatches(registry,match,pages))continue;
   const cnpjPage=pages.find(evidence=>extractCnpjs([evidence]).includes(registry.cnpj!));
   const phonePage=pages.find(evidence=>verifySiteContent({...observedLead,cnpj:undefined},[evidence]));
   const siteEvidence=[cnpjPage,phonePage,...pages].filter((e):e is Evidence=>!!e);
   candidates.push({...registry,name:match.name,site,phone:match.phone,address:match.address??registry.address,rating:match.rating,reviewCount:match.reviewCount,
    facts:{...match.facts,...registry.facts,mapsSourceRef:match.sourceRef,admissionVerified:true},
    evidence:[...(registry.evidence??[]).slice(0,1),...(match.evidence??[]).slice(0,1),...new Map(siteEvidence.map(e=>[e.url,e])).values()].slice(0,4)});
   verified=true;break;
  }
  if(!verified)reject('SITE_IDENTITY_UNVERIFIED');
 }
 return {...page,candidates,rejected,...(window?{examinedCnpjs}:{})};
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
    const inspect=(url:string,step:string)=>performSiteRead(lease,step,async()=>{
      const found=await(deps.collect??fetchEvidencePack)(url,{signal,browser:deps.siteBrowser},true);
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
