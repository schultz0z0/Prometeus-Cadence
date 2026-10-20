import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareJob,confirmJob,getJob,listJobItems,cancelJob} from '../../src/server/prospecting/service.ts';
import {runGeneration,runQualification} from '../../src/server/prospecting/steps.ts';
import {applyJobResults} from '../../src/server/prospecting/application.ts';
import {reconcileJob} from '../../src/server/prospecting/reconciliation.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {normalizeCandidate} from '../../src/server/prospecting/normalize.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {configureProspectingTest,prospectingUser,generationInput,grantTestLease,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import type {CandidatePage} from '../../src/domain/prospecting.ts';
import {runWorkerOnce} from '../../src/server/prospecting/worker.ts';
configureProspectingTest();beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});
async function setup(limit=2){const {p}=await prospectingUser(),input={...generationInput(),limit},review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});return{p,job,lease:await grantTestLease(p,job.id)};}
function page(n:number):CandidatePage{return{receiptId:'p'+n,candidates:[normalizeCandidate({id:'id'+n,name:'Company '+n,site:'https://example.com'},'MAPS')],nextCursor:n===1?'1':null,exhausted:n===2,rawCount:1,rejected:[],usage:{provider:'apify',operationId:'page'+n,units:{candidates:1},costUsd:null,costKind:'unknown'}};}
test('generation resumes durable pages without another start and keeps partial counts',async()=>{
  const {p,job,lease}=await setup();let starts=0,reads=0;
  const adapter={start:async()=>{starts++;return{kind:'remote' as const,run:{provider:'apify' as const,runId:'run1',datasetId:'ds1',profileId:'compass/crawler-google-places',build:'fixture-build',operationId:'start'}};},poll:async(_c:any,run:any)=>({run,status:'succeeded' as const}),readPage:async()=>page(++reads),abort:async(_c:any,run:any)=>({run,status:'cancelled' as const})};
  await runGeneration(lease,{apify:adapter});
  assert.equal((await getJob(p,job.id)).counts.inserted,1);
  const resumed=await grantTestLease(p,job.id);await runGeneration(resumed,{apify:adapter});
  assert.equal(starts,1);assert.equal((await getJob(p,job.id)).state,'completed');
  assert.equal((await readWorkspaceSnapshot(p)).data.leads.length,2);
  const next=await setup();reads=0;
  await runGeneration(next.lease,{apify:adapter});
  const failing={...adapter,readPage:async()=>{throw Error('failed page');}};
  await runGeneration(await grantTestLease(next.p,next.job.id),{apify:failing});
  assert.equal((await getJob(next.p,next.job.id)).state,'partial');assert.equal((await getJob(next.p,next.job.id)).counts.inserted,1);
});
test('uncertain start requires explicit reconciliation and never posts twice',async()=>{
  const {p,job,lease}=await setup();let posts=0;
  const apify={start:async()=>{posts++;return{kind:'uncertain' as const,operationId:'start'};},poll:async()=>{throw Error();},readPage:async()=>{throw Error();},abort:async()=>{throw Error();}};
  await runGeneration(lease,{apify});assert.equal((await getJob(p,job.id)).state,'needs_reconciliation');
  await assert.rejects(()=>runGeneration(lease,{apify}));assert.equal(posts,1);
  const reset=await reconcileJob(p,job.id,{confirmNotStarted:true});assert.equal(reset.state,'queued');
});
test('qualification stores proposals and confirmed application is atomic and conflict-aware',async()=>{
  const {p,job,lease}=await setup(1);
  const adapter={start:async()=>({kind:'inline' as const,page:{...page(1),exhausted:true,nextCursor:null}}),poll:async()=>{throw Error();},readPage:async()=>{throw Error();},abort:async()=>{throw Error();}};
  await runGeneration(lease,{apify:adapter});
  let snapshot=await readWorkspaceSnapshot(p);const lead=snapshot.data.leads[0];
  const input={kind:'qualification' as const,listId:job.listId,leadIds:[lead.id],modules:['email' as const],summaryPolicy:'all' as const,escalation:'off' as const};
  const review=await prepareJob(p,input),q=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});
  const qLease=await grantTestLease(p,q.id),qualificationDeps={collect:async()=>[{id:'e',url:'https://example.com',fetchedAt:new Date().toISOString(),text:'Contato company@example.com',hash:'h',truncated:false}]};
  await runQualification(qLease,qualificationDeps);await runQualification(qLease,qualificationDeps);
  assert.equal((await getJob(p,q.id)).state,'completed');
  assert.equal((await readWorkspaceSnapshot(p)).data.leads[0].email,undefined);
  const items=(await listJobItems(p,q.id)).items;assert.equal(items.length,1);
  snapshot=await readWorkspaceSnapshot(p);
  await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead:{...lead,email:'human@example.com'}}});
  const selection={requestId:randomUUID(),itemIds:[items[0].id]};
  await assert.rejects(()=>applyJobResults(p,q.id,selection),{status:409,code:'RESULT_CONFLICT'});
  assert.equal((await readWorkspaceSnapshot(p)).data.leads[0].email,'human@example.com');
  snapshot=await readWorkspaceSnapshot(p);
  await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead}});
  const applied=await applyJobResults(p,q.id,selection);assert.equal(applied.applied,1);
  assert.deepEqual(await applyJobResults(p,q.id,selection),applied);
  assert.equal((await readWorkspaceSnapshot(p)).data.leads[0].email,'company@example.com');
});

test('cancellation during start keeps cleanup metadata and blocks publication until abort is confirmed',async()=>{
  const {p,job,lease}=await setup();let aborted=false;
  const adapter={start:async()=>{await cancelJob(p,job.id);return{kind:'remote' as const,run:{provider:'apify' as const,runId:'run1',datasetId:'ds1',profileId:'compass/crawler-google-places',build:'fixture-build',operationId:'start'}};},poll:async(_c:any,run:any)=>({run,status:'succeeded' as const}),readPage:async()=>page(1),abort:async(_c:any,run:any)=>({run,status:aborted?'cancelled' as const:'cancelling' as const})};
  await assert.rejects(()=>runGeneration(lease,{apify:adapter}),{code:'STALE_JOB'});
  assert.equal((await readWorkspaceSnapshot(p)).data.leads.length,0);
  await runGeneration(lease,{apify:adapter});assert.equal((await getJob(p,job.id)).state,'cancelling');
  aborted=true;await runGeneration(lease,{apify:adapter});assert.equal((await getJob(p,job.id)).state,'cancelled');
});

test('lease expiry after remote start leaves a journal that cannot issue another start',async()=>{
  const {p,job,lease}=await setup();let starts=0;
  const adapter={start:async()=>{starts++;await testAdmin(c=>c.query("UPDATE app.prospecting_job SET lease_until=now()-interval '1 second' WHERE workspace_id=$1 AND id=$2",[p.workspaceId,job.id]));return{kind:'uncertain' as const,operationId:'start'};},poll:async()=>{throw Error();},readPage:async()=>{throw Error();},abort:async()=>{throw Error();}};
  await assert.rejects(()=>runGeneration(lease,{apify:adapter}),{code:'STALE_JOB'});
  await runGeneration(await grantTestLease(p,job.id),{apify:adapter});
  assert.equal(starts,1);assert.equal((await getJob(p,job.id)).state,'needs_reconciliation');
});

test('revocation allows only remote cleanup metadata and never late lead publication',async()=>{
  const {p,job,lease}=await setup();let aborts=0;
  const adapter={start:async()=>({kind:'remote' as const,run:{provider:'apify' as const,runId:'run1',datasetId:'ds1',profileId:'compass/crawler-google-places',build:'fixture-build',operationId:'start'}}),poll:async(_c:any,run:any)=>({run,status:'running' as const}),readPage:async()=>page(1),abort:async(_c:any,run:any)=>{aborts++;return{run,status:'cancelled' as const};}};
  await runGeneration(lease,{apify:adapter});
  await testAdmin(async c=>{await c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]);await c.query("UPDATE app.prospecting_job SET lease_until=now()-interval '1 second' WHERE workspace_id=$1 AND id=$2",[p.workspaceId,job.id]);});
  await runWorkerOnce({apify:adapter},{workerId:'cleanup',signal:new AbortController().signal,workspaceId:p.workspaceId});
  await runWorkerOnce({apify:adapter},{workerId:'cleanup',signal:new AbortController().signal,workspaceId:p.workspaceId});
  assert.equal(aborts,1);
  const state=await testAdmin(async c=>(await c.query('SELECT state FROM app.prospecting_job WHERE workspace_id=$1 AND id=$2',[p.workspaceId,job.id])).rows[0].state);
  assert.equal(state,'cancelled');await assert.rejects(()=>getJob(p,job.id),{status:403});
});

test('JEV remains a proposal, omitted summary makes no generative call, and context changes conflict',async()=>{
  process.env.OPENROUTER_API_KEY='fixture-not-live';
  const {p,job,lease}=await setup(1);
  const source={start:async()=>({kind:'inline' as const,page:{...page(1),exhausted:true,nextCursor:null}}),poll:async()=>{throw Error();},readPage:async()=>{throw Error();},abort:async()=>{throw Error();}};
  await runGeneration(lease,{apify:source});let snapshot=await readWorkspaceSnapshot(p);
  await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'context.approve',profile:{...snapshot.data.companyProfile,offer:'Software',idealCustomer:'Clínicas'}}});
  snapshot=await readWorkspaceSnapshot(p);const lead=snapshot.data.leads[0];
  const input={kind:'qualification' as const,listId:job.listId,leadIds:[lead.id],modules:['qualify' as const],summaryPolicy:'all' as const,escalation:'off' as const},review=await prepareJob(p,input),q=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token}),qLease=await grantTestLease(p,q.id);
  let generated=0,decisions=0;
  const deps={collect:async()=>[{id:'e',url:'https://example.com',fetchedAt:new Date().toISOString(),text:'Somos uma clínica odontológica com atendimento e agendamento.',hash:'h',truncated:false}],decide:async(ctx:any,source:any)=>{decisions++;return{model:'typesafe/jev-1.13' as const,verdict:'fits' as const,confidence:0.98,probabilities:{fits:0.98,does_not_fit:0.01,insufficient_evidence:0.01},criteria:{quality:0.9},evidenceIds:source.evidence.map((e:any)=>e.id),usage:{provider:'openrouter',operationId:ctx.operationId,units:{jevCalls:1},costUsd:null,costKind:'unknown' as const}};},generate:async()=>{generated++;throw Error('must not generate');}};
  await runQualification(qLease,deps);await runQualification(qLease,deps);assert.equal(decisions,1);assert.equal(generated,0);
  assert.equal((await readWorkspaceSnapshot(p)).data.leads[0].qualification,'pending');
  const items=(await listJobItems(p,q.id)).items;snapshot=await readWorkspaceSnapshot(p);
  await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'context.approve',profile:{...snapshot.data.companyProfile,idealCustomer:'Indústrias'}}});
  await assert.rejects(()=>applyJobResults(p,q.id,{requestId:randomUUID(),itemIds:[items[0].id]}),{code:'RESULT_CONFLICT'});
});
