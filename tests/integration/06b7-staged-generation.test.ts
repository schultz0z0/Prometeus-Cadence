import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareJob,confirmJob,getJob} from '../../src/server/prospecting/service.ts';
import {runGeneration} from '../../src/server/prospecting/steps.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {normalizeCandidate} from '../../src/server/prospecting/normalize.ts';
import {readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {configureProspectingTest,prospectingUser,generationInput,grantTestLease,closeProspectingPools} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import type {CandidatePage,GenerationSource} from '../../src/domain/prospecting.ts';
configureProspectingTest();Object.assign(process.env,{APIFY_CNPJ_ACTOR:'bigdavidson/brazil-cnpj-companies',APIFY_CNPJ_BUILD:'fixture-build',APIFY_WEB_ACTOR:'apify/google-search-scraper',APIFY_WEB_BUILD:'fixture-build'});
beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});
const cases:{source:GenerationSource;filters:Record<string,string>;raw:Record<string,unknown>;has:string[];lacks:string[]}[]=[
 {source:'MAPS',filters:{term:'dentistas',location:'Curitiba, PR'},raw:{placeId:'maps-1',name:'[RE] Clínica Exemplo',phone:'+5541999990001',address:'Rua Exemplo, 10'},has:['phone'],lacks:['cnpj','site']},
 {source:'CNPJ',filters:{term:'esquadrias',includeCnae:'2512800',states:'PR'},raw:{cnpj:'37297479000180',razao_social:'[RE] Esquadrias Exemplo Ltda',municipio:'Curitiba',uf:'PR'},has:['cnpj'],lacks:['site']},
 {source:'WEB',filters:{term:'contabilidade',location:'Curitiba, PR'},raw:{id:'web-1',name:'[RE] Contábil Exemplo',site:'https://contabil.example.com'},has:['site'],lacks:['cnpj','phone']}
];
async function generate(source:GenerationSource,filters:Record<string,string>,rows:Record<string,unknown>[]){
 const {p}=await prospectingUser(),input={...generationInput(),source,filters,limit:1,destination:{mode:'new' as const,name:'[RE] '+source}},review=await prepareJob(p,input as any);
 assert.deepEqual(review.blockers,[]);
 const job=await confirmJob(p,{requestId:randomUUID(),input:input as any,reviewToken:review.token}),lease=await grantTestLease(p,job.id);
 const page:CandidatePage={receiptId:'page',candidates:rows.map(row=>normalizeCandidate(row,source)),nextCursor:null,exhausted:true,rawCount:rows.length,rejected:[],usage:{provider:'apify',operationId:'page',units:{candidates:rows.length},costUsd:null,costKind:'unknown'}};
 const run={provider:'apify' as const,runId:'run',datasetId:'ds',profileId:'fixture',build:'fixture-build',operationId:'start'};
 await runGeneration(lease,{apify:{start:async()=>({kind:'remote' as const,run}),poll:async()=>({run,status:'succeeded' as const}),readPage:async()=>page,abort:async()=>({run,status:'cancelled' as const})}});
 return{p,job:await getJob(p,job.id)};
}
for(const c of cases)test(`06B.7 ${c.source} saves a valid lead with only the data that source delivered`,async()=>{
 const {p,job}=await generate(c.source,c.filters,[c.raw]);
 assert.equal(job.state,'completed');assert.equal(job.counts.inserted,1);
 const lead=(await readWorkspaceSnapshot(p)).data.leads[0] as unknown as Record<string,unknown>;
 for(const key of c.has)assert.ok(lead[key],c.source+' keeps '+key);
 for(const key of c.lacks)assert.ok(!lead[key],c.source+' does not invent '+key);
});
test('06B.7 an empty source result completes with zero inserted while an unavailable source blocks the review',async()=>{
 const {job}=await generate('MAPS',cases[0].filters,[]);
 assert.equal(job.state,'completed');assert.equal(job.counts.inserted,0);
 const {p}=await prospectingUser(),review=await prepareJob(p,{...generationInput(),source:'APOLLO'} as any);
 assert.ok(review.blockers.length,'Apollo without the workspace connection is reported as unavailable');
});
