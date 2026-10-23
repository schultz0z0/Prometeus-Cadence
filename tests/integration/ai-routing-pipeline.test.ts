import {seedOAuthFixture} from './oauth-fixture.ts';
import {conventionalUnit} from '../../src/server/prospecting/ai/json.ts';
import test,{beforeEach,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';import {prepareJob,confirmJob,getJob,listJobItems} from '../../src/server/prospecting/service.ts';
import {runQualification} from '../../src/server/prospecting/qualification.ts';import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';import {reconcileJob} from '../../src/server/prospecting/reconciliation.ts';
import {configureProspectingTest,prospectingUser,grantTestLease,closeProspectingPools,testAdmin,seedHybridPolicy} from './prospecting-helpers.ts';import {resetRateLimits} from './helpers.ts';import {ProviderError} from '../../src/server/prospecting/providers/transport.ts';
import {conventionalConfig} from '../../src/server/prospecting/ai/config.ts';
import {getAiSettings} from '../../src/server/prospecting/ai/probe.ts';import {hashValue} from '../../src/server/prospecting/review.ts';
configureProspectingTest();beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});
async function setup(provider:'codex-local'|'chatgpt-oauth'|'openai'|'gemini',modules:('qualify'|'summary')[]=['qualify','summary']){
 const {p}=await prospectingUser();Object.assign(process.env,{CODEX_LOCAL_ENABLED:'true',CODEX_BINARY:process.execPath,CODEX_MODEL:'fixture',CODEX_TEST_WORKSPACE_IDS:p.workspaceId,OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',GEMINI_API_KEY:'fixture',GEMINI_MODEL:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({codexCalls:10,openaiCalls:10,geminiCalls:10,jevCalls:10}),PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({codexCalls:100000,openaiCalls:100000,geminiCalls:100000,jevCalls:100000})});
 if(provider==='chatgpt-oauth')seedOAuthFixture(p.workspaceId);
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:provider,jevEnabled:false}});
 let s=await readWorkspaceSnapshot(p);const listId=randomUUID(),id=randomUUID();await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.import',list:{id:listId,name:'AI QA'},leads:[{id,listId,name:'Synthetic Clinic',site:'https://example.com/',qualification:'pending',source:'MANUAL',createdAt:new Date().toISOString()}]}});
 s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'context.approve',profile:{...s.data.companyProfile,idealCustomer:'Dental clinics'}}});
 const input={kind:'qualification' as const,listId,leadIds:[id],modules,summaryPolicy:'all' as const,escalation:'ambiguous' as const};return{p,input};
}
const collect=async()=>[{id:'e',url:'https://example.com/',text:'Synthetic dental clinic with appointments.',hash:'synthetic',fetchedAt:new Date().toISOString(),truncated:false}];
for(const provider of ['codex-local','chatgpt-oauth','openai','gemini'] as const)test(provider+' alone qualifies and summarizes with no JEV or duplicate opinion call',async()=>{
 const{p,input}=await setup(provider);const review=await prepareJob(p,input);assert.deepEqual(review.blockers,[]);assert.equal(review.usage.some(u=>u.unit==='jevCalls'),false);assert.equal(review.usage.reduce((n,u)=>n+u.maxUnits,0),2);
 const job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token}),lease=await grantTestLease(p,job.id);let calls=0;
 const deps={collect,conventional:async(ctx:any,input:any)=>{calls++;const usage={provider,operationId:ctx.operationId,units:{[conventionalUnit(provider)]:1},costUsd:null,costKind:'unknown' as const};return input.task==='qualify'?{task:'qualify' as const,reason:'Dental clinic.',decision:{provider,model:'fixture',verdict:'fits' as const,confidence:null,probabilities:{},criteria:{},evidenceIds:input.evidence.map((e:any)=>e.id),usage}}:{task:'summary' as const,generation:{model:'fixture',summary:'Dental clinic.',evidenceIds:input.evidence.map((e:any)=>e.id),usage}};},decide:async()=>{throw Error('JEV must not run');}};
 for(let i=0;i<3;i++)await runQualification(lease,deps);
 await assert.rejects(()=>runQualification(lease,deps),{code:'STALE_JOB'});
 assert.equal(calls,2);assert.equal((await getJob(p,job.id)).state,'completed');assert.equal((await readWorkspaceSnapshot(p)).data.leads[0].qualification,'pending');
 const items=(await listJobItems(p,job.id)).items;assert.equal(items[0].results[0].proposed.qualification,'qualified');assert.equal(items[0].results[0].proposed.reason,'Dental clinic.');assert.equal((await getJob(p,job.id)).usage?.length,2);
});
test('policy changes invalidate a review and block new dispatch without changing the job provider',async()=>{
 const {p,input}=await setup('openai',['qualify']),review=await prepareJob(p,input);
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'openai',jevEnabled:false}});
 await assert.rejects(()=>confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token}),{status:409});
 const next=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:next.token});
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:2,policy:{mode:'conventional-only',conventionalProvider:'gemini',jevEnabled:false}});let calls=0;
 await runQualification(await grantTestLease(p,job.id),{collect,conventional:async()=>{calls++;throw Error();}});assert.equal(calls,0);assert.equal((await getJob(p,job.id)).state,'failed');
});
test('uncertain conventional response retains usage and can reconcile without inference replay',async()=>{
 const {p,input}=await setup('openai',['qualify']),r=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:r.token});let calls=0;
 const deps={collect,conventional:async()=>{calls++;throw new ProviderError('LOST',0,true);}};
 await runQualification(await grantTestLease(p,job.id),deps);const waiting=await getJob(p,job.id);assert.equal(waiting.state,'needs_reconciliation');
 await reconcileJob(p,job.id,{operationId:waiting.unresolvedAttempts![0].id,resultUnavailable:true});await runQualification(await grantTestLease(p,job.id),deps);
 const result=await getJob(p,job.id);assert.equal(result.state,'partial');assert.equal(calls,1);assert.equal(result.usage![0].units.openaiCalls,1);
});
for(const provider of ['openai','chatgpt-oauth'] as const)test(provider+' hybrid requires a fresh scoped companion check and rechecks it before every JEV dispatch',async()=>{
 const{p,input}=await setup(provider,['qualify']);process.env.OPENROUTER_API_KEY='fixture';
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:provider,jevEnabled:true}});
 assert.ok((await prepareJob(p,input)).blockers.length);
 const conventional=await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:2,policy:{mode:'conventional-only',conventionalProvider:provider,jevEnabled:true}});
 const r=await prepareJob(p,input),seed=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:r.token}),route=conventionalConfig(p.workspaceId).conventional[provider].route;
 await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,'hybrid-check',$3,$4,$5,$6,'success')",[p.workspaceId,seed.id,route.provider,route.model,route.configFingerprint,route.contractVersion]));
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:conventional.revision,policy:{mode:'auto',conventionalProvider:provider,jevEnabled:true}});
 const hybrid=await prepareJob(p,input);assert.deepEqual(hybrid.blockers,[]);assert.equal(hybrid.usage.filter(u=>u.unit==='jevCalls')[0].maxUnits,1);
 const q=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:hybrid.token});
 await testAdmin(c=>c.query("UPDATE app.ai_connection_check SET checked_at=now()-interval '24 hours' WHERE workspace_id=$1",[p.workspaceId]));let calls=0;
 await runQualification(await grantTestLease(p,q.id),{collect,decide:async()=>{calls++;throw Error();}});assert.equal(calls,0);assert.equal((await getJob(p,q.id)).error?.code,'AI_COMPANION_UNAVAILABLE');
});
test('policy changed during inference preserves the committed result and consumption but blocks later dispatch',async()=>{
 const{p,input}=await setup('openai'),r=await prepareJob(p,input),q=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:r.token}),lease=await grantTestLease(p,q.id);let calls=0;
 const deps={collect,conventional:async(ctx:any,input:any)=>{calls++;await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'conventional-only',conventionalProvider:'gemini',jevEnabled:false}});return{task:'qualify' as const,reason:'Clinic',decision:{provider:'openai' as const,model:'fixture',verdict:'fits' as const,confidence:null,criteria:{},probabilities:{},evidenceIds:input.evidence.map((e:any)=>e.id),usage:{provider:'openai',operationId:ctx.operationId,units:{openaiCalls:1},costUsd:null,costKind:'unknown' as const}}};}};
 await runQualification(lease,deps);assert.equal((await getJob(p,q.id)).usage?.[0].units.openaiCalls,1);await runQualification(lease,deps);assert.equal(calls,1);assert.equal((await getJob(p,q.id)).state,'partial');
});

for(const change of ['policy','revocation','expiry'] as const)test('hybrid revalidates authority after Codex diagnosis: '+change,async()=>{
 const{p,input}=await setup('codex-local',['qualify']),r=await prepareJob(p,input),seed=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:r.token}),route=conventionalConfig(p.workspaceId).conventional['codex-local'].route;
 await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,'before-diagnosis',$3,$4,$5,$6,'success')",[p.workspaceId,seed.id,route.provider,route.model,route.configFingerprint,route.contractVersion]));
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'codex-local',jevEnabled:true}});
 const review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});let calls=0;
 const diagnose=async()=>{
  if(change==='policy')await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:2,policy:{mode:'conventional-only',conventionalProvider:'codex-local',jevEnabled:false}});
  if(change==='revocation')await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));
  if(change==='expiry')await testAdmin(c=>c.query("UPDATE app.ai_connection_check SET checked_at=now()-interval '25 hours' WHERE workspace_id=$1",[p.workspaceId]));
  return{available:true,authenticated:true,authMode:'chatgpt' as const,version:'fixture',code:null};
 };
 await runQualification(await grantTestLease(p,job.id),{collect,diagnose,decide:async()=>{calls++;throw Error('JEV must not dispatch after authority changed');}}).catch(()=>{});
 assert.equal(calls,0);
});

test('a recovered prepared conventional attempt invalidates old success without a second inference',async()=>{
 const{p,input}=await setup('openai',['qualify']),r=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:r.token}),route=conventionalConfig(p.workspaceId).conventional.openai.route;
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome,checked_at) VALUES($1,$2,'old-success',$3,$4,$5,$6,'success',now()-interval '1 hour')",[p.workspaceId,job.id,route.provider,route.model,route.configFingerprint,route.contractVersion]);
  const step='qualify:'+input.leadIds[0];await c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,provider,step,state,payload) VALUES($1,$2,$3,'openai',$4,'prepared',$5)",[p.workspaceId,job.id,hashValue({job:job.id,step}),step,{reservedUnits:{openaiCalls:1}}]);
 });
 let calls=0;await runQualification(await grantTestLease(p,job.id),{collect,conventional:async()=>{calls++;throw Error('Do not repeat an uncertain inference');}});
 assert.equal(calls,0);assert.equal((await getJob(p,job.id)).state,'needs_reconciliation');assert.equal((await getAiSettings(p)).lastCheck?.outcome,'uncertain');
 const waiting=await getJob(p,job.id);await reconcileJob(p,job.id,{operationId:waiting.unresolvedAttempts![0].id,resultUnavailable:true});
 assert.equal((await getAiSettings(p)).lastCheck?.outcome,'uncertain');
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'openai',jevEnabled:true}});
 assert.ok((await prepareJob(p,input)).blockers.length);
});

test('hybrid allows its own freshly journaled summary while preserving companion validation',async()=>{
 const{p,input}=await setup('openai'),r=await prepareJob(p,input),seed=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:r.token}),route=conventionalConfig(p.workspaceId).conventional.openai.route;
 await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,'valid-hybrid-companion',$3,$4,$5,$6,'success')",[p.workspaceId,seed.id,route.provider,route.model,route.configFingerprint,route.contractVersion]));
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'openai',jevEnabled:true}});
 const review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token}),lease=await grantTestLease(p,job.id);let decisions=0,summaries=0;
 const deps={collect,decide:async(ctx:any,input:any)=>{decisions++;return{model:'typesafe/jev-1.13',verdict:'fits' as const,confidence:.9,probabilities:{},criteria:{quality:.9,coverage:1},evidenceIds:input.evidence.map((e:any)=>e.id),usage:{provider:'openrouter',operationId:ctx.operationId,units:{jevCalls:1},costUsd:null,costKind:'unknown' as const}};},conventional:async(ctx:any,input:any)=>{summaries++;return{task:'summary' as const,generation:{model:'fixture',summary:'Synthetic clinic.',evidenceIds:input.evidence.map((e:any)=>e.id),usage:{provider:'openai',operationId:ctx.operationId,units:{openaiCalls:1},costUsd:null,costKind:'unknown' as const}}};}};
 for(let i=0;i<3;i++){if(['completed','partial','failed','needs_reconciliation'].includes((await getJob(p,job.id)).state))break;await runQualification(lease,deps);}
 assert.equal(decisions,1);assert.equal(summaries,1);assert.equal((await getJob(p,job.id)).state,'completed');
});
