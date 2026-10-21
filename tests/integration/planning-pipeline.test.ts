import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createPlanningFixture,planningStorageJob} from './planning-helpers.ts';
import {grantTestLease,closeProspectingPools,testAdmin,countRows} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {preparePlanning,confirmPlanning,getPlanning} from '../../src/server/planning/service.ts';
import {runPlanning} from '../../src/server/planning/execution.ts';
import {planningRequest} from '../../src/server/planning/http.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {conventionalConfig} from '../../src/server/prospecting/ai/config.ts';
import {getJob} from '../../src/server/prospecting/service.ts';
import {reconcileJob} from '../../src/server/prospecting/reconciliation.ts';
import {withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {ProviderError} from '../../src/server/prospecting/providers/transport.ts';
import {audienceResult,planningSources} from '../planning-fixtures.ts';
import type {PlanningInput,PlanningProposal} from '../../src/domain/planning.ts';
beforeEach(resetRateLimits);after(closeProspectingPools);
const audience:PlanningInput={kind:'planning',task:'audience_plan',description:'Clínicas',channel:'whatsapp',timezone:'America/Sao_Paulo'};
const context:PlanningInput={kind:'planning',task:'context_read',domain:'example.com',target:{kind:'company'}};
async function setup(provider:'codex-local'|'openai'|'gemini'='openai'){
 const fixture=await createPlanningFixture();Object.assign(process.env,{CODEX_LOCAL_ENABLED:'true',CODEX_BINARY:process.execPath,CODEX_MODEL:'fixture',CODEX_TEST_WORKSPACE_IDS:fixture.p.workspaceId,OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',GEMINI_API_KEY:'fixture',GEMINI_MODEL:'fixture',OPENROUTER_API_KEY:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({codexCalls:10,openaiCalls:10,geminiCalls:10,jevCalls:10}),PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({codexCalls:100000,openaiCalls:100000,geminiCalls:100000,jevCalls:100000})});
 await saveAiPolicy(fixture.p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:provider,jevEnabled:false}});return fixture;
}
function fakeGenerate(counter:{calls:number}){return async(ctx:any,input:any)=>{counter.calls++;const payload=input.request.task==='context_read'?{task:'context_read' as const,fields:{offer:{value:'Clínicas',quote:'Atendemos clínicas.',evidenceIds:['page_1']}}}:{task:'audience_plan' as const,...audienceResult()};return {proposal:{...payload,contractVersion:'planning-v1' as const,jobId:ctx.jobId,base:input.base,evidenceIds:input.sources.map((s:any)=>s.id),recommendedOptionId:null} as PlanningProposal,usage:{provider:ctx.route.provider==='codex-local'?'codex':ctx.route.provider,operationId:ctx.operationId,units:{[ctx.route.provider==='codex-local'?'codexCalls':ctx.route.provider+'Calls']:1},costUsd:null,costKind:'unknown' as const}};};}
const diagnose=async()=>({available:true,authenticated:true,authMode:'chatgpt' as const,version:'fixture',code:null});
test('planning review is pure and confirmation reserves once without creating any domain object',async()=>{
 const {p,headers}=await setup(),review=await preparePlanning(p,audience);assert.deepEqual(review.blockers,[]);assert.equal(await countRows('prospecting_job',p.workspaceId),0);
 const body={requestId:randomUUID(),input:audience,reviewToken:review.token};const [a,b]=await Promise.all([confirmPlanning(p,body),confirmPlanning(p,body)]);assert.equal(a.id,b.id);assert.equal(a.listId,null);assert.equal(await countRows('list',p.workspaceId),0);assert.equal(await countRows('usage_ledger',p.workspaceId),1);
 assert.deepEqual(await testAdmin(async c=>(await c.query('SELECT (SELECT count(*) FROM app.lead WHERE workspace_id=$1)::int AS leads,(SELECT count(*) FROM app.cadence WHERE workspace_id=$1)::int AS cadences,(SELECT count(*) FROM app.automation WHERE workspace_id=$1)::int AS automations',[p.workspaceId])).rows[0]),{leads:0,cadences:0,automations:0});
 await assert.rejects(()=>confirmPlanning(p,{...body,input:{...audience,description:'Outro público'}}),{status:409});
 for(const changes of [{origin:'https://foreign.example'},{'x-cadence-workspace':'foreign'}]){
  const h=new Headers(headers);for(const [k,v] of Object.entries(changes))h.set(k,v);
  const response=await planningRequest(new Request('http://127.0.0.1:3210/api/planning/prepare',{method:'POST',headers:h,body:JSON.stringify(audience)}),'prepare');assert.ok([403,409].includes(response.status));
 }
});
for(const provider of ['codex-local','openai','gemini'] as const)test(`${provider} planning runs solo and stores proposals without changing leads`,async()=>{
 const {p}=await setup(provider),review=await preparePlanning(p,audience),job=await confirmPlanning(p,{requestId:randomUUID(),input:audience,reviewToken:review.token}),counter={calls:0};
 await runPlanning(await grantTestLease(p,job.id),{generate:fakeGenerate(counter),diagnose});
 const result=await getPlanning(p,job.id);assert.equal(result.job.state,'completed');assert.equal(counter.calls,1);assert.equal(result.proposal?.task,'audience_plan');assert.equal(result.job.usage?.length,1);assert.equal(await countRows('list',p.workspaceId),0);
});
test('auto context reading does not require or call JEV and keeps literal public provenance',async()=>{
 const {p}=await setup();await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'openai',jevEnabled:true}});
 const review=await preparePlanning(p,context);assert.deepEqual(review.blockers,[]);assert.equal(review.usage.length,1);
 const job=await confirmPlanning(p,{requestId:randomUUID(),input:context,reviewToken:review.token}),counter={calls:0};
 await runPlanning(await grantTestLease(p,job.id),{generate:fakeGenerate(counter),collect:async()=>planningSources().map(s=>({id:s.id,url:s.url!,text:s.text,hash:s.hash,fetchedAt:s.obtainedAt,truncated:false})),rank:async()=>{throw Error('JEV must not run');}});
 assert.equal((await getPlanning(p,job.id)).proposal?.task,'context_read');assert.equal(counter.calls,1);
});
test('hybrid recovers generation journal before ranking without repeating the content call',async()=>{
 const {p}=await setup(),seed=await planningStorageJob(p),route=conventionalConfig(p.workspaceId).conventional.openai.route;
 await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,'success')",[p.workspaceId,seed.id,randomUUID(),route.provider,route.model,route.configFingerprint,route.contractVersion]));
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'openai',jevEnabled:true}});
 const review=await preparePlanning(p,audience);assert.deepEqual(review.blockers,[]);assert.equal(review.usage.length,2);
 const job=await confirmPlanning(p,{requestId:randomUUID(),input:audience,reviewToken:review.token}),lease=await grantTestLease(p,job.id),counter={calls:0};let ranks=0;
 const deps={generate:fakeGenerate(counter),rank:async()=>{ranks++;throw new ProviderError('LOST_RANK',0,true);}};
 await runPlanning(lease,deps);assert.equal((await getJob(p,job.id)).state,'needs_reconciliation');assert.equal(counter.calls,1);
 const waiting=await getJob(p,job.id);await reconcileJob(p,job.id,{operationId:waiting.unresolvedAttempts![0].id,confirmNotStarted:true});
 await runPlanning(await grantTestLease(p,job.id),{...deps,rank:async ctx=>({recommendedOptionId:'option_2',confidence:null,usage:{provider:'openrouter',operationId:ctx.operationId,units:{jevCalls:1},costUsd:null,costKind:'unknown'}})});
 const result=await getPlanning(p,job.id);assert.equal(result.job.state,'completed');assert.equal(result.proposal?.recommendedOptionId,'option_2');assert.equal(counter.calls,1);assert.equal(ranks,1);
});
test('lost conventional planning result retains reservation and can settle without a lead ID or replay',async()=>{
 const {p}=await setup(),review=await preparePlanning(p,audience),job=await confirmPlanning(p,{requestId:randomUUID(),input:audience,reviewToken:review.token});let calls=0;
 await runPlanning(await grantTestLease(p,job.id),{generate:async()=>{calls++;throw new ProviderError('LOST',0,true);}});
 const waiting=await getJob(p,job.id);assert.equal(waiting.state,'needs_reconciliation');
 const result=await reconcileJob(p,job.id,{operationId:waiting.unresolvedAttempts![0].id,resultUnavailable:true});assert.equal(result.state,'failed');assert.equal(calls,1);assert.equal((await getJob(p,job.id)).usage?.[0].units.openaiCalls,1);
});
test('configuration change invalidates analysis and a policy changed during inference preserves received usage',async()=>{
 const {p}=await setup(),r=await preparePlanning(p,audience);
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'conventional-only',conventionalProvider:'gemini',jevEnabled:false}});
 await assert.rejects(()=>confirmPlanning(p,{requestId:randomUUID(),input:audience,reviewToken:r.token}),{status:409});
 const r2=await preparePlanning(p,audience),job=await confirmPlanning(p,{requestId:randomUUID(),input:audience,reviewToken:r2.token}),counter={calls:0},generate=fakeGenerate(counter);
 await runPlanning(await grantTestLease(p,job.id),{generate:async(ctx,input)=>{await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:2,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});return generate(ctx,input);}});
 assert.equal((await getJob(p,job.id)).usage?.[0].units.geminiCalls,1);assert.equal(counter.calls,1);
});
for(const change of ['policy','revocation','expiry'] as const)test('planning revalidates after Codex diagnosis: '+change,async()=>{
 const {p}=await setup('codex-local'),seed=await planningStorageJob(p),route=conventionalConfig(p.workspaceId).conventional['codex-local'].route;
 await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,$3,$4,$5,$6,$7,'success')",[p.workspaceId,seed.id,randomUUID(),route.provider,route.model,route.configFingerprint,route.contractVersion]));
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'codex-local',jevEnabled:true}});
 const review=await preparePlanning(p,audience),job=await confirmPlanning(p,{requestId:randomUUID(),input:audience,reviewToken:review.token});let calls=0;
 await runPlanning(await grantTestLease(p,job.id),{generate:async()=>{calls++;throw Error('must not dispatch');},diagnose:async()=>{
  if(change==='policy')await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:2,policy:{mode:'conventional-only',conventionalProvider:'codex-local',jevEnabled:false}});
  if(change==='revocation')await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));
  if(change==='expiry')await testAdmin(c=>c.query("UPDATE app.ai_connection_check SET checked_at=now()-interval '25 hours' WHERE workspace_id=$1",[p.workspaceId]));
  return diagnose();
 }}).catch(()=>{});
 assert.equal(calls,0);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.planning_proposal WHERE workspace_id=$1 AND job_id=$2',[p.workspaceId,job.id])).rows[0].count),'0');
});
test('budget and server-only fields block confirmation without orphan jobs',async()=>{
 const {p}=await setup();
 await assert.rejects(()=>preparePlanning(p,{...audience,checkpoint:{}}),{status:422});
 process.env.PROSPECTING_WORKSPACE_DAILY_UNITS='{}';const review=await preparePlanning(p,audience);assert.ok(review.blockers.length);
 await assert.rejects(()=>confirmPlanning(p,{requestId:randomUUID(),input:audience,reviewToken:review.token}),{status:409});assert.equal(await countRows('prospecting_job',p.workspaceId),0);
});
