import type {GenerationSource} from '../../../domain/prospecting.ts';
import type {ProviderProfile,GenerationInput} from './types.ts';
import {ProviderError} from './transport.ts';
const actors={MAPS:'compass/crawler-google-places',WEB:'apify/google-search-scraper',CNPJ:'bigdavidson/brazil-cnpj-companies'};
export function providerProfile(source:GenerationSource,config?:{actor:string;build:string}):ProviderProfile{
  if(source==='APOLLO')return{source,actor:'',build:'organizations-search-v1',ppe:false};
  const actor=config?.actor??process.env[`APIFY_${source}_ACTOR`]??'',build=config?.build??process.env[`APIFY_${source}_BUILD`]??'';
  if(actor!==actors[source]||!build||!/^[-\w.]{1,100}$/.test(build))throw new ProviderError('PROFILE_UNAVAILABLE');
  // This explicit server flag is set only after checking this actor/build's PPE contract.
  return{source,actor,build,ppe:process.env[`APIFY_${source}_PPE`]==='true'};
}
export function actorInput(profile:ProviderProfile,input:GenerationInput){
  const f={...input.filters};
  if(profile.source==='MAPS')return{searchStringsArray:[f.term],locationQuery:f.location,maxCrawledPlacesPerSearch:input.limit,language:'pt-BR'};
  if(profile.source==='WEB')return{queries:[f.term,f.location].filter(Boolean).join(' '),maxPagesPerQuery:Math.ceil(input.limit/100),resultsPerPage:Math.min(input.limit,100),languageCode:'pt'};
  if(profile.source==='CNPJ'){
    if(f.includeCnae){f.cnae=f.includeCnae;delete f.includeCnae;}
    if(f.states){f.state=f.states;delete f.states;}
    if(f.location){f.city=f.location;delete f.location;}
    const unsupported=Object.keys(f).filter(k=>f[k]&&!['term','cnae','state','city','cnpj'].includes(k));
    if(unsupported.length)throw new ProviderError('UNSUPPORTED_FILTER');
    if(!f.cnpj&&!f.cnae)throw new ProviderError('CNPJ_REQUIRES_CNAE');
    return f.cnpj?{mode:'lookup',cnpjs:[f.cnpj],limit:input.limit}:{mode:'search',...(f.cnae?{cnae:f.cnae.split(',').map(x=>x.trim())}:{}),...(f.state?{uf:f.state}:{}),...(f.city?{city:f.city}:{}),limit:input.limit};
  }throw new ProviderError('PROFILE_UNAVAILABLE');
}
