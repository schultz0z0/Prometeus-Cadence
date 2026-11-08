import test from 'node:test';
import assert from 'node:assert/strict';
import {ApifySiteCrawler} from '../src/server/prospecting/providers/site-crawler.ts';
import type {ProviderContext} from '../src/server/prospecting/providers/types.ts';

const context:ProviderContext={operationId:'crawl',signal:new AbortController().signal,credential:'test-only',
 profile:{source:'WEB',actor:'apify/website-content-crawler',build:'pinned',ppe:false},maxChargeUsd:0.1,maxPages:10,targetUrl:'https://example.com/'};
test('site crawling bounds pages and preserves footer identity while rejecting foreign results',async()=>{
 let body:any;
 const crawler=new ApifySiteCrawler(async(url,init)=>{
  if(init?.method==='POST'){body=JSON.parse(String(init.body));return Response.json({data:{id:'run',defaultDatasetId:'dataset'}});}
  return Response.json([{url:'https://example.com/contato',text:'[RE] Empresa CNPJ 37.297.479/0001-80'},
   {url:'https://other.example.com/',text:'CNPJ de outra empresa'}]);
 });
 const started=await crawler.start(context,{kind:'generation',source:'WEB',destination:{mode:'existing',listId:'l'},filters:{term:'https://example.com/'},limit:10,dedupScope:'workspace'});
 assert.equal(started.kind,'remote');if(started.kind!=='remote')assert.fail('expected run');
 assert.equal(body.maxCrawlPages,10);assert.equal(body.maxConcurrency,1);assert.equal(body.respectRobotsTxtFile,true);
 assert.equal(body.summarize,false);assert.equal(body.saveFiles,false);assert.equal(body.htmlTransformer,'none');
 assert.equal(body.saveContentTypes,'');assert.deepEqual(body.proxyConfiguration,{useApifyProxy:true});
 assert.ok(!body.removeElementsCssSelector.includes('footer'));
 const page=await crawler.readPage(context,started.run,null,10);
 assert.equal(page.candidates.length,1);assert.match(page.candidates[0].evidence![0].text,/37.297.479/);
 assert.equal(page.candidates[0].evidence![0].url,'https://example.com/contato');
});
