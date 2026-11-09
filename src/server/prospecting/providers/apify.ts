import type {RemoteRun,RemoteState,CandidatePage} from '../../../domain/prospecting.ts';
import type {Fetch,ProviderContext,GenerationInput,SourceAdapter,StartResult} from './types.ts';
import {ProviderError,providerJson} from './transport.ts';
import {actorInput} from './profiles.ts';
import {normalizeCandidate,normalizeDecisionMakers} from '../normalize.ts';
import {hashValue} from '../review.ts';
const api='https://api.apify.com/v2';
const id=(value:unknown)=>{if(typeof value!=='string'||!/^[-\w]{1,100}$/.test(value))throw new ProviderError('INVALID_REMOTE_ID');return value;};
export class ApifyAdapter implements SourceAdapter{
  fetcher:Fetch;constructor(fetcher:Fetch=fetch){this.fetcher=fetcher;}
  async request(ctx:ProviderContext,path:string,method='GET',body?:unknown){return providerJson(this.fetcher,api+path,{method,headers:{authorization:'Bearer '+ctx.credential,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},ctx.signal) as Promise<any>;}
  async start(ctx:ProviderContext,input:GenerationInput):Promise<StartResult>{
    const body=actorInput(ctx.profile,input),query=new URLSearchParams({build:ctx.profile.build,timeout:'300',maxItems:String(input.limit)});
    if(ctx.profile.ppe)query.set('maxTotalChargeUsd',String(ctx.maxChargeUsd));
    try{const response=await this.request(ctx,`/acts/${ctx.profile.actor.replace('/','~')}/runs?${query}`,'POST',body);return{kind:'remote',run:{provider:'apify',runId:id(response.data?.id),datasetId:response.data?.defaultDatasetId?id(response.data.defaultDatasetId):null,profileId:ctx.profile.actor,build:ctx.profile.build,operationId:ctx.operationId}};}
    catch(error){if(error instanceof ProviderError&&(error.uncertain||error.code==='INVALID_REMOTE_ID'))return{kind:'uncertain',operationId:ctx.operationId};throw error;}
  }
  async poll(ctx:ProviderContext,run:RemoteRun):Promise<RemoteState>{
    const response=await this.request(ctx,`/actor-runs/${id(run.runId)}`),data=response.data;
    const remoteStatus=typeof data?.status==='string'?data.status.replaceAll('_','-'):'';
    const status:Record<string,RemoteState['status']>={READY:'ready',RUNNING:'running',SUCCEEDED:'succeeded',FAILED:'failed','TIMING-OUT':'running','TIMED-OUT':'failed',ABORTING:'cancelling',ABORTED:'cancelled'};
    if(!Object.hasOwn(status,remoteStatus))throw new ProviderError('INVALID_RUN_STATUS');
    const error=remoteStatus==='TIMED-OUT'?{code:'REMOTE_TIMED_OUT',message:'A execução na Apify atingiu o limite de tempo.'}:undefined;
    return{run:{...run,datasetId:data.defaultDatasetId?id(data.defaultDatasetId):run.datasetId},status:status[remoteStatus],...(error?{error}:{})};
  }
  async readPage(ctx:ProviderContext,run:RemoteRun,cursor:string|null,limit=100):Promise<CandidatePage>{
    const offset=Number(cursor??0);if(!Number.isSafeInteger(offset)||offset<0||offset>(ctx.profile.source==='CNPJ'?2000:500)||!Number.isInteger(limit)||limit<1||limit>100)throw new ProviderError('INVALID_PAGE');
    if(!run.datasetId)throw new ProviderError('MISSING_DATASET');
    const web=ctx.profile.source==='WEB';
    let rows:any[],nextOffset:number,exhausted:boolean;
    if(web){
      const all:any[]=[];let ended=false;
      // Numeric cursors remain candidate offsets. Read immutable SERP records in
      // bounded groups instead of assuming the first five contain the whole run.
      for(let serpOffset=0;serpOffset<50;serpOffset+=5){
        const raw=await this.request(ctx,`/datasets/${id(run.datasetId)}/items?clean=true&format=json&offset=${serpOffset}&limit=5`);
        if(!Array.isArray(raw)||raw.length>5||raw.some(r=>!Array.isArray(r?.organicResults)||r.organicResults.length>100))throw new ProviderError('INVALID_DATASET');
        all.push(...raw.flatMap(r=>r.organicResults));
        if(raw.length<5||serpOffset===45){ended=true;break;}
        if(all.length>=offset+limit)break;
      }
      rows=all.slice(offset,offset+limit);nextOffset=offset+rows.length;exhausted=ended&&nextOffset>=all.length;
    }else{
      const raw=await this.request(ctx,`/datasets/${id(run.datasetId)}/items?clean=true&format=json&offset=${offset}&limit=${limit}`);
      if(!Array.isArray(raw)||raw.length>limit)throw new ProviderError('INVALID_DATASET');
      if(ctx.profile.source==='CNPJ'&&raw.some(r=>r?.tipo_registro==='erro'))throw new ProviderError('CNPJ_SOURCE_ERROR');
      rows=ctx.profile.source==='CNPJ'?raw.filter(r=>r?.tipo_registro!=='aviso'):raw;
      nextOffset=offset+raw.length;exhausted=raw.length<limit;
    }
    const candidates=[],rejected=[];
    for(const r of rows.slice(0,limit))try{
      const candidate=normalizeCandidate(ctx.profile.source==='WEB'?{...r,id:r.url,site:r.url}:r,ctx.profile.source);
      if(ctx.profile.source==='CNPJ'){
        const status=typeof r.descricao_situacao_cadastral==='string'?r.descricao_situacao_cadastral.trim().toUpperCase():'';
        const registrationStatus=['ATIVA','BAIXADA','INAPTA','SUSPENSA','NULA'].includes(status)?status:undefined;
        const street=[r.descricao_tipo_de_logradouro,r.logradouro].filter(v=>typeof v==='string'&&v.trim()).join(' ');
        const number=typeof r.numero==='string'||typeof r.numero==='number'?String(r.numero).trim():'';
        candidate.facts={registrationStatus,...(street&&number?{street:`${street}, ${number}`.slice(0,500)}:{}),...(ctx.profile.partners?{decisionMakers:normalizeDecisionMakers(r.qsa)}:{})};
      }
      const mapsFacts=ctx.profile.source==='MAPS'?{
        category:typeof r.categoryName==='string'?r.categoryName.slice(0,200):undefined,
        address:candidate.address,
        street:typeof r.street==='string'?r.street.slice(0,500):undefined,
        rating:candidate.rating===undefined?undefined:Number(candidate.rating),
        reviewCount:candidate.reviewCount===undefined?undefined:Number(candidate.reviewCount),
        permanentlyClosed:typeof r.permanentlyClosed==='boolean'?r.permanentlyClosed:undefined,
        temporarilyClosed:typeof r.temporarilyClosed==='boolean'?r.temporarilyClosed:undefined,
      }:{};
      if(ctx.profile.source==='MAPS')candidate.facts=mapsFacts;
      const text=JSON.stringify({source:ctx.profile.source,sourceRef:candidate.sourceRef,name:candidate.name,cnpj:candidate.cnpj,city:candidate.city,state:candidate.state,site:candidate.site,phone:candidate.phone,email:candidate.email,...mapsFacts,...candidate.facts,description:typeof r.description==='string'?r.description.slice(0,4000):undefined}).slice(0,6000);
      let url=`https://api.apify.com/v2/datasets/${id(run.datasetId)}/items?offset=${offset}`;
      if(ctx.profile.source==='WEB')try{const pageUrl=new URL(r.url);if(['http:','https:'].includes(pageUrl.protocol)&&!pageUrl.username&&!pageUrl.password)url=pageUrl.toString();}catch{}
      candidate.evidence=[{id:hashValue({receipt:run.runId,ref:candidate.sourceRef}),url,text,hash:hashValue(text),fetchedAt:new Date().toISOString(),truncated:typeof r.description==='string'&&r.description.length>4000}];
      candidates.push(candidate);
    }catch{rejected.push({reason:'MISSING_IDENTITY'});}
    const rawCount=Math.min(rows.length,limit),receiptId=hashValue({run:run.runId,offset,limit});
    return{receiptId,candidates,rejected,nextCursor:exhausted?null:String(nextOffset),exhausted,rawCount,usage:{provider:'apify',operationId:receiptId,units:{candidates:rawCount},costUsd:null,costKind:'unknown'}};
  }
  async abort(ctx:ProviderContext,run:RemoteRun){await this.request(ctx,`/actor-runs/${id(run.runId)}/abort`,'POST',{});return this.poll(ctx,run);}
}
