import test from 'node:test';
import assert from 'node:assert/strict';
import {ApifyAdapter} from '../src/server/prospecting/providers/apify.ts';
import {ApolloAdapter} from '../src/server/prospecting/providers/apollo.ts';
import {providerProfile} from '../src/server/prospecting/providers/profiles.ts';
import {actorInput} from '../src/server/prospecting/providers/profiles.ts';
import {ProviderError} from '../src/server/prospecting/providers/transport.ts';
import {providerJson} from '../src/server/prospecting/providers/transport.ts';
const input={kind:'generation' as const,source:'MAPS' as const,destination:{mode:'new' as const,name:'QA'},filters:{term:'dentistas',location:'São Paulo'},limit:5,dedupScope:'workspace' as const};
const context=()=>({operationId:'operation',signal:new AbortController().signal,profile:providerProfile('MAPS',{actor:'compass/crawler-google-places',build:'pinned-build'}),credential:'secret-fixture',maxChargeUsd:0.1,maxPages:2});
test('Apify start is bounded and a lost POST response is uncertain without retry',async()=>{
  const calls:{url:string;init?:RequestInit}[]=[];
  const adapter=new ApifyAdapter(async(url,init)=>{calls.push({url:String(url),init});throw Error('lost');});
  assert.deepEqual(await adapter.start(context(),input),{kind:'uncertain',operationId:'operation'});
  assert.equal(calls.length,1);assert.equal(calls[0].url.includes('secret-fixture'),false);
  const body=JSON.parse(calls[0].init!.body as string);assert.deepEqual(body.searchStringsArray,['dentistas']);assert.equal(body.locationQuery,'São Paulo');assert.equal(body.maxCrawledPlacesPerSearch,5);
});
test('Apify normalizes dataset pages and rejects malformed and provider failures safely',async()=>{
  const adapter=new ApifyAdapter(async(url)=>String(url).includes('/datasets/')?Response.json([{placeId:'one',title:'A',website:'https://example.com'}]):Response.json({data:{id:'run1',defaultDatasetId:'ds1',status:'SUCCEEDED'}}));
  const started=await adapter.start(context(),input);assert.equal(started.kind,'remote');if(started.kind!=='remote')return;
  assert.equal((await adapter.poll(context(),started.run)).status,'succeeded');
  const page=await adapter.readPage(context(),started.run,null,5);assert.equal(page.candidates[0].name,'A');assert.equal(page.exhausted,true);
  for(const status of[401,402,403,429]){
    const bad=new ApifyAdapter(async()=>Response.json({secret:'secret-fixture'},{status}));
    await assert.rejects(()=>bad.start(context(),input),(error:unknown)=>error instanceof ProviderError&&!error.message.includes('secret-fixture'));
  }
});
test('Apollo uses company search with bounded paid pages and does not fabricate contacts',async()=>{
  let url='',body:any;
  const adapter=new ApolloAdapter(async(u,init)=>{url=String(u);body=JSON.parse(init!.body as string);return Response.json({organizations:[{id:'apollo1',name:'A',primary_domain:'example.com'}],pagination:{total_pages:2}});});
  const page=await adapter.search({...context(),profile:providerProfile('APOLLO')},{...input,source:'APOLLO',filters:{term:'software'}},1);
  assert.equal(url,'https://api.apollo.io/api/v1/mixed_companies/search');assert.equal(body.per_page,5);assert.equal(page.candidates[0].email,undefined);assert.equal(page.usage.units.apolloPages,1);
  await assert.rejects(()=>adapter.search({...context(),maxPages:1},{...input,source:'APOLLO'},2));
});

test('web pages flatten organic results with a stable candidate offset',async()=>{
  const ctx={...context(),profile:providerProfile('WEB',{actor:'apify/google-search-scraper',build:'pinned'})};
  const rows=[{organicResults:Array.from({length:5},(_,i)=>({url:'https://example.com/'+i,title:'Empresa '+i}))}];
  const adapter=new ApifyAdapter(async()=>Response.json(rows));
  const run={provider:'apify' as const,runId:'run1',datasetId:'ds1',profileId:ctx.profile.actor,build:'pinned',operationId:'op'};
  const a=await adapter.readPage(ctx,run,null,2),b=await adapter.readPage(ctx,run,a.nextCursor,2);
  assert.equal(a.exhausted,false);assert.equal(b.candidates[0].name,'Empresa 2');assert.equal(b.nextCursor,'4');
});
test('CNPJ only accepts supported filters and abort remains pending until confirmed',async()=>{
  const profile=providerProfile('CNPJ',{actor:'bigdavidson/brazil-cnpj-companies',build:'pinned'});
  assert.deepEqual(actorInput(profile,{...input,source:'CNPJ',filters:{term:'contabilidade',cnae:'6920601',state:'SP'}}),{mode:'search',cnae:['6920601'],uf:'SP',limit:5});
  assert.throws(()=>actorInput(profile,{...input,source:'CNPJ',filters:{term:'x',employees:'10'}}));
  const adapter=new ApifyAdapter(async()=>Response.json({data:{status:'ABORTING',id:'r'}}));
  assert.equal((await adapter.abort(context(),{provider:'apify',runId:'r',datasetId:null,profileId:'a',build:'b',operationId:'c'})).status,'cancelling');
  const bad=new ApifyAdapter(async()=>new Response('{bad'));
  assert.equal((await bad.start(context(),input)).kind,'uncertain');
});
test('Apollo keeps a stable page size for a non-multiple limit and slices only the final result',async()=>{
  const sizes:number[]=[],adapter=new ApolloAdapter(async(_url,init)=>{
    const body=JSON.parse(init!.body as string);sizes.push(body.per_page);
    return Response.json({organizations:Array.from({length:body.per_page},(_,i)=>({id:String((body.page-1)*body.per_page+i+1),name:'Empresa '+((body.page-1)*body.per_page+i+1)})),pagination:{total_pages:10}});
  });
  const query={...input,source:'APOLLO' as const,limit:150},ctx={...context(),profile:providerProfile('APOLLO')};
  const first=await adapter.search(ctx,query,1),second=await adapter.search(ctx,query,2);
  assert.deepEqual(sizes,[100,100]);assert.equal(second.usage.fetchedCount,100);assert.equal(second.usage.acceptedCount,50);assert.equal(second.candidates.length,50);assert.equal(second.candidates[0].sourceRef,'101');assert.equal(second.candidates.at(-1)?.sourceRef,'150');assert.equal(new Set([...first.candidates,...second.candidates].map(c=>c.sourceRef)).size,150);
});
test('a successful start with an incomplete run response remains uncertain',async()=>{
  const adapter=new ApifyAdapter(async()=>Response.json({data:{}}));
  assert.equal((await adapter.start(context(),input)).kind,'uncertain');
});
test('unusable successful POST bodies retain uncertainty including byte limits',async()=>{
  for(const response of[new Response(null),new Response('x'.repeat(2_000_001))]){
    await assert.rejects(()=>providerJson(async()=>response,'https://api.apify.com/v2/acts/a/runs',{method:'POST'},new AbortController().signal),(error:unknown)=>error instanceof ProviderError&&error.uncertain);
  }
});
test('actual source mapping retains bounded public provenance for web and registry rows',async()=>{
  const ctx={...context(),profile:providerProfile('WEB',{actor:'apify/google-search-scraper',build:'pinned'})};
  const adapter=new ApifyAdapter(async()=>Response.json([{organicResults:[{title:'Company A',url:'https://example.com/',description:'Dental company providing orthodontics.'}]}]));
  const page=await adapter.readPage(ctx,{provider:'apify',runId:'r',datasetId:'d',profileId:ctx.profile.actor,build:'pinned',operationId:'op'},null,1);
  assert.equal(page.candidates[0].evidence?.length,1);assert.ok(page.candidates[0].evidence?.[0].text.includes('orthodontics'));assert.equal(page.candidates[0].evidence?.[0].url,'https://example.com/');
});
