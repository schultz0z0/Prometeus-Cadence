import test from 'node:test';
import assert from 'node:assert/strict';
import {ApifyAdapter} from '../src/server/prospecting/providers/apify.ts';
import type {ProviderContext} from '../src/server/prospecting/providers/types.ts';

const context:ProviderContext={operationId:'legacy-crawl',signal:AbortSignal.timeout(3000),credential:'fixture-only',
 profile:{source:'WEB',actor:'apify/website-content-crawler',build:'pinned',ppe:false},maxChargeUsd:0.1,maxPages:10};

test('the retired crawler cannot start but its known run can still be observed and stopped',async()=>{
 const calls:string[]=[];
 const apify=new ApifyAdapter(async(url,init)=>{
  const path=new URL(String(url)).pathname;
  calls.push(init?.method+' '+path);
  assert.ok(path.startsWith('/v2/actor-runs/'));
  return Response.json({data:{status:path.endsWith('/abort')?'ABORTING':'ABORTED',defaultDatasetId:'legacy-data'}});
 });
 const request={kind:'generation',source:'WEB',destination:{mode:'existing',listId:'list'},filters:{term:'[RE] Empresa'},limit:10,dedupScope:'workspace'} as const;
 await assert.rejects(apify.start(context,request),{code:'LEGACY_CRAWLER_RETIRED'});
 assert.deepEqual(calls,[]);
 const run={provider:'apify',runId:'legacy-run',datasetId:'legacy-data',profileId:context.profile.actor,build:context.profile.build,operationId:context.operationId} as const;
 assert.equal((await apify.abort(context,run)).status,'cancelled');
 assert.deepEqual(calls,['POST /v2/actor-runs/legacy-run/abort','GET /v2/actor-runs/legacy-run']);
});
