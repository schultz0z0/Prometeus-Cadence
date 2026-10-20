import type {CandidatePage} from '../../../domain/prospecting.ts';
import type {Fetch,ProviderContext,GenerationInput} from './types.ts';
import {providerJson,ProviderError} from './transport.ts';
import {normalizeCandidate} from '../normalize.ts';
import {hashValue} from '../review.ts';
export class ApolloAdapter{
  fetcher:Fetch;constructor(fetcher:Fetch=fetch){this.fetcher=fetcher;}
  async search(ctx:ProviderContext,input:GenerationInput,page:number):Promise<CandidatePage>{
    if(!Number.isInteger(page)||page<1||page>ctx.maxPages||page>Math.ceil(input.limit/100))throw new ProviderError('PAGE_LIMIT');
    const perPage=Math.min(100,input.limit),limit=Math.min(perPage,input.limit-(page-1)*perPage),f=input.filters;
    const raw=await providerJson(this.fetcher,'https://api.apollo.io/api/v1/mixed_companies/search',{method:'POST',headers:{'x-api-key':ctx.credential,'content-type':'application/json'},body:JSON.stringify({q_organization_keyword_tags:[f.term],...(f.location?{organization_locations:[f.location]}:{}),page,per_page:perPage})},ctx.signal) as any;
    if(!Array.isArray(raw?.organizations)||raw.organizations.length>perPage)throw new ProviderError('INVALID_ORGANIZATIONS',0,true);
    const accepted=raw.organizations.slice(0,limit);
    const candidates=[],rejected=[];
    for(const row of accepted)try{candidates.push(normalizeCandidate({...row,phone:row.primary_phone?.number},'APOLLO'));}catch{rejected.push({reason:'MISSING_IDENTITY'});}
    const exhausted=raw.organizations.length<perPage||page>=Number(raw.pagination?.total_pages??page)||(page-1)*perPage+accepted.length>=input.limit,receiptId=hashValue({operation:ctx.operationId,page});
    return{receiptId,candidates,rejected,nextCursor:exhausted?null:String(page+1),exhausted,rawCount:accepted.length,usage:{provider:'apollo',operationId:receiptId,units:{apolloPages:1,candidates:accepted.length},fetchedCount:raw.organizations.length,acceptedCount:accepted.length,costUsd:null,costKind:'unknown'}};
  }
}
