import test,{beforeEach,after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {prepareAiTest,confirmAiTest,getAiSettings} from '../../src/server/prospecting/ai/probe.ts';import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {configureProspectingTest,prospectingUser,countRows,testAdmin,grantTestLease,closeProspectingPools} from './prospecting-helpers.ts';import {resetRateLimits} from './helpers.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';import {runQualification} from '../../src/server/prospecting/qualification.ts';import {getJob,listJobItems} from '../../src/server/prospecting/service.ts';import {applyJobResults} from '../../src/server/prospecting/application.ts';
import {aiRequest} from '../../src/server/prospecting/ai/http.ts';import {base} from './helpers.ts';
configureProspectingTest();beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});
async function setup(){const a=await prospectingUser({platformAi:true});Object.assign(process.env,{OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({openaiCalls:2}),PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({openaiCalls:100000})});await saveAiPolicy(a.p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'hybrid-required',conventionalProvider:'openai',jevEnabled:true}});return a;}
test('prepare is pure and concurrent probe confirmations atomically create one synthetic job and reserve',async()=>{
 const{p}=await setup();assert.ok((await getAiSettings(p)).blockers.length);
 const r=await prepareAiTest(p);assert.deepEqual(r.blockers,[]);assert.equal(r.usage.length,1);assert.equal(r.usage[0].unit,'openaiCalls');
 assert.equal(await countRows('list',p.workspaceId),0);assert.equal(await countRows('prospecting_job',p.workspaceId),0);assert.equal(await countRows('usage_ledger',p.workspaceId),0);
 const body={requestId:randomUUID(),draft:r.draft,reviewToken:r.token},[a,b]=await Promise.all([confirmAiTest(p,body),confirmAiTest(p,body)]);assert.equal(a.id,b.id);assert.equal(await countRows('list',p.workspaceId),1);assert.equal(await countRows('usage_ledger',p.workspaceId),1);
 await assert.rejects(()=>confirmAiTest(p,{...body,draft:{sampleId:randomUUID()}}),{status:409});
 let calls=0;const lease=await grantTestLease(p,a.id);const deps={collect:async()=>{throw Error('No public network for synthetic probe');},conventional:async(ctx:any,input:any)=>{calls++;return{task:'summary' as const,generation:{model:'fixture',summary:'Synthetic clinic.',evidenceIds:input.evidence.map((e:any)=>e.id),usage:{provider:'openai',operationId:ctx.operationId,units:{openaiCalls:1},costUsd:null,costKind:'unknown' as const}}};}};
 await runQualification(lease,deps);await runQualification(lease,deps);assert.equal(calls,1);assert.equal((await getJob(p,a.id)).state,'completed');assert.equal((await getAiSettings(p)).lastCheck?.outcome,'success');
 const items=(await listJobItems(p,a.id)).items;await assert.rejects(()=>applyJobResults(p,a.id,{requestId:randomUUID(),itemIds:[items[0].id]}),{status:409});assert.equal((await confirmAiTest(p,body)).id,a.id);
});
test('changed policy, insufficient budget and downgraded operator reject without orphan data',async()=>{
 const{p}=await setup(),r=await prepareAiTest(p);
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});
 await assert.rejects(()=>confirmAiTest(p,{requestId:randomUUID(),draft:r.draft,reviewToken:r.token}),{status:409});
 const one=await prepareAiTest(p),job=await confirmAiTest(p,{requestId:randomUUID(),draft:one.draft,reviewToken:one.token});
 const two=await prepareAiTest(p);await confirmAiTest(p,{requestId:randomUUID(),draft:two.draft,reviewToken:two.token});
 const three=await prepareAiTest(p);await assert.rejects(()=>confirmAiTest(p,{requestId:randomUUID(),draft:three.draft,reviewToken:three.token}),{status:429});assert.equal(await countRows('list',p.workspaceId),2);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));await assert.rejects(()=>getAiSettings(p),{status:403});await assert.rejects(()=>prepareAiTest(p),{status:403});
});
test('AI HTTP gates origin, active workspace and operator diagnostics without spawning a process',async()=>{
 const a=await setup(),b=await prospectingUser();const headers=new Headers(a.headers);headers.set('x-cadence-workspace',b.p.workspaceId);
 assert.equal((await aiRequest(new Request(base+'/api/prospecting/ai/policy',{headers}),'policy')).status,409);
 headers.set('x-cadence-workspace',a.p.workspaceId);headers.set('origin','https://foreign.example');assert.equal((await aiRequest(new Request(base+'/api/prospecting/ai/diagnostics',{method:'POST',headers}),'diagnostics')).status,403);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[a.p.workspaceId,a.p.userId]));
 assert.equal((await aiRequest(new Request(base+'/api/prospecting/ai/diagnostics',{method:'POST',headers:a.headers}),'diagnostics')).status,403);
 const result=await aiRequest(new Request(base+'/api/prospecting/ai/policy',{headers:a.headers}),'policy');assert.equal(result.status,403);const text=await result.text();assert.ok(!text.includes('configFingerprint'));assert.ok(!text.includes('OPENAI_API_KEY'));
});

test('probe honors persisted workspace caps, consumed allowance and policy changes before confirmation',async()=>{
 const{p}=await setup();
 await testAdmin(c=>c.query('INSERT INTO app.prospecting_policy(workspace_id,limits) VALUES($1,$2)',[p.workspaceId,{openaiCalls:0}]));
 const denied=await prepareAiTest(p);assert.ok(denied.blockers.length);
 await assert.rejects(()=>confirmAiTest(p,{requestId:randomUUID(),draft:denied.draft,reviewToken:denied.token}),{status:409});
 assert.equal(await countRows('list',p.workspaceId),0);
 await testAdmin(c=>c.query('UPDATE app.prospecting_policy SET limits=$2,version=version+1 WHERE workspace_id=$1',[p.workspaceId,{openaiCalls:1}]));
 const stale=await prepareAiTest(p);assert.deepEqual(stale.blockers,[]);
 await testAdmin(c=>c.query('UPDATE app.prospecting_policy SET limits=$2,version=version+1 WHERE workspace_id=$1',[p.workspaceId,{openaiCalls:2}]));
 await assert.rejects(()=>confirmAiTest(p,{requestId:randomUUID(),draft:stale.draft,reviewToken:stale.token}),{status:409});
 await testAdmin(c=>c.query('UPDATE app.prospecting_policy SET limits=$2,version=version+1 WHERE workspace_id=$1',[p.workspaceId,{openaiCalls:1}]));
 const one=await prepareAiTest(p);await confirmAiTest(p,{requestId:randomUUID(),draft:one.draft,reviewToken:one.token});
 const two=await prepareAiTest(p);await assert.rejects(()=>confirmAiTest(p,{requestId:randomUUID(),draft:two.draft,reviewToken:two.token}),{status:429});
 assert.equal(await countRows('list',p.workspaceId),1);
});

test('late probe finalization retains the inference timestamp and cannot refresh hybrid validity',async()=>{
 const{p}=await setup(),r=await prepareAiTest(p),job=await confirmAiTest(p,{requestId:randomUUID(),draft:r.draft,reviewToken:r.token}),lease=await grantTestLease(p,job.id);
 let calls=0;const deps={conventional:async(ctx:any,input:any)=>{calls++;return{task:'summary' as const,generation:{model:'fixture',summary:'Synthetic.',evidenceIds:input.evidence.map((e:any)=>e.id),usage:{provider:'openai',operationId:ctx.operationId,units:{openaiCalls:1},costUsd:null,costKind:'unknown' as const}}};}};
 await runQualification(lease,deps);
 await testAdmin(c=>c.query("UPDATE app.prospecting_attempt SET created_at=now()-interval '25 hours' WHERE job_id=$1 AND provider='openai'",[job.id]));
 await runQualification(lease,deps);assert.equal(calls,1);
 const settings=await getAiSettings(p);assert.equal(settings.lastCheck?.outcome,'success');assert.ok(Date.parse(settings.lastCheck!.checkedAt)<Date.now()-86400000);assert.ok(settings.blockers.length);
});
for(const revokeAt of ['before-call','before-call-role','during-call','before-attestation'] as const)test('platform admin revocation fences probe '+revokeAt+' without a global success attestation',async()=>{
 const{p}=await setup(),r=await prepareAiTest(p),job=await confirmAiTest(p,{requestId:randomUUID(),draft:r.draft,reviewToken:r.token}),lease=await grantTestLease(p,job.id);let calls=0;
 const revoke=()=>revokeAt==='before-call-role'?testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId])):testAdmin(c=>c.query('UPDATE app.platform_ai_control SET admin_user_ids=$1',[[randomUUID()]]));
 const deps={conventional:async(ctx:any,input:any)=>{calls++;if(revokeAt==='during-call')await revoke();return{task:'summary' as const,generation:{model:'fixture',summary:'Synthetic.',evidenceIds:input.evidence.map((e:any)=>e.id),usage:{provider:'openai',operationId:ctx.operationId,units:{openaiCalls:1},costUsd:null,costKind:'unknown' as const}}};}};
 if(revokeAt.startsWith('before-call'))await revoke();await runQualification(lease,deps);
 if(revokeAt==='before-attestation'){await revoke();await runQualification(lease,deps);}
 assert.equal(calls,revokeAt.startsWith('before-call')?0:1);assert.equal((await getJob(p,job.id)).state,revokeAt==='before-attestation'?'partial':'failed');
 assert.equal(await testAdmin(async c=>(await c.query("SELECT count(*)::int n FROM app.ai_connection_check WHERE workspace_id=$1 AND outcome='success'",[p.workspaceId])).rows[0].n),0);
 if(calls)assert.equal((await getJob(p,job.id)).usage?.[0].units.openaiCalls,1);
});
