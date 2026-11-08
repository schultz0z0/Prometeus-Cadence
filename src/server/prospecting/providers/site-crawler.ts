import {ApifyAdapter} from './apify.ts';
import type {ProviderContext,GenerationInput,StartResult} from './types.ts';
import type {RemoteRun,CandidatePage} from '../../../domain/prospecting.ts';
import {ProviderError} from './transport.ts';
import {hashValue} from '../review.ts';

export class ApifySiteCrawler extends ApifyAdapter{
 async start(ctx:ProviderContext,input:GenerationInput):Promise<StartResult>{
  const site=new URL(input.filters.term);
  if(!['http:','https:'].includes(site.protocol)||site.username||site.password)throw new ProviderError('INVALID_CRAWL_URL');
  const maxPages=Math.max(1,Math.min(20,ctx.maxPages));
  const host=site.hostname.replace(/^www\./,'');
  const query=new URLSearchParams({build:ctx.profile.build,timeout:'120',memory:'256',maxItems:String(maxPages)});
  try{
   const response=await this.request(ctx,'/acts/apify~website-content-crawler/runs?'+query,'POST',{
    startUrls:[{url:site.toString()}],crawlerType:'cheerio',maxCrawlPages:maxPages,maxCrawlDepth:3,
    maxConcurrency:1,initialConcurrency:1,maxRequestRetries:0,requestTimeoutSecs:20,
    useSitemaps:true,respectRobotsTxtFile:true,proxyConfiguration:{useApifyProxy:true},
    includeUrlGlobs:[`http://${host}/**`,`https://${host}/**`,`http://www.${host}/**`,`https://www.${host}/**`],
    removeElementsCssSelector:'script,style,noscript',htmlTransformer:'none',
    saveHtml:false,saveMarkdown:false,saveFiles:false,saveContentTypes:'',summarize:false,
   });
   const run=response.data;
   if(!/^[-\w]{1,100}$/.test(run?.id??'')||!/^[-\w]{1,100}$/.test(run?.defaultDatasetId??''))throw new ProviderError('INVALID_REMOTE_ID',0,true);
   return {kind:'remote',run:{provider:'apify',runId:run.id,datasetId:run.defaultDatasetId,profileId:ctx.profile.actor,build:ctx.profile.build,operationId:ctx.operationId}};
  }catch(error){if(error instanceof ProviderError&&error.uncertain)return{kind:'uncertain',operationId:ctx.operationId};throw error;}
 }
 async readPage(ctx:ProviderContext,run:RemoteRun,cursor:string|null,limit=10):Promise<CandidatePage>{
  const offset=Number(cursor??0),target=new URL(ctx.targetUrl!);
  if(!run.datasetId||!/^[-\w]{1,100}$/.test(run.datasetId)||!Number.isSafeInteger(offset)||offset<0||offset>20)throw new ProviderError('INVALID_PAGE');
  const maxPages=Math.max(1,Math.min(20,ctx.maxPages,limit));
  const rows=await this.request(ctx,`/datasets/${run.datasetId}/items?clean=true&format=json&offset=${offset}&limit=${maxPages}`);
  if(!Array.isArray(rows)||rows.length>maxPages)throw new ProviderError('INVALID_DATASET');
  const candidates:CandidatePage['candidates']=[];
  for(const row of rows){
   let url:URL;try{url=new URL(row.url);}catch{continue;}
   if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.hostname.replace(/^www\./,'')!==target.hostname.replace(/^www\./,''))continue;
   if(typeof row.text!=='string'||!row.text.trim())continue;
   const text=row.text.slice(0,12000),hash=hashValue(text);
   candidates.push({name:typeof row.metadata?.title==='string'?row.metadata.title.slice(0,300):target.hostname,source:'WEB',sourceRef:url.toString(),
    evidence:[{id:hashValue({run:run.runId,url:url.toString()}),url:url.toString(),text,hash,fetchedAt:new Date().toISOString(),truncated:row.text.length>text.length}]});
  }
  return {receiptId:hashValue({run:run.runId,offset}),candidates,rejected:[],rawCount:rows.length,
   nextCursor:rows.length===maxPages?String(offset+rows.length):null,exhausted:rows.length<maxPages,
   usage:{provider:'apify',operationId:ctx.operationId,units:{},costUsd:null,costKind:'unknown'}};
 }
}
