import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {billingUser,beginTrial,testAdmin} from './billing-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
import {identityAction} from '../../src/server/workspaces/service.ts';
import {configureProspectingTest,generationInput,grantTestLease} from './prospecting-helpers.ts';
import {prepareJob,confirmJob} from '../../src/server/prospecting/service.ts';
import {withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {performStep} from '../../src/server/prospecting/journal.ts';
import {ingestPage} from '../../src/server/prospecting/ingestion.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {runGeneration} from '../../src/server/prospecting/steps.ts';
import {ProviderError} from '../../src/server/prospecting/providers/transport.ts';
import {reconcileJob} from '../../src/server/prospecting/reconciliation.ts';
after(async()=>{await closeBillingPool();const {workerPool}=await import('../../src/server/prospecting/worker-db.ts');await workerPool().end();await getPools().close();});
async function addLead(p:any,id:string){return withWorkspaceTransaction(p,async c=>{await c.query("INSERT INTO app.list VALUES($1,'list','Billing') ON CONFLICT DO NOTHING",[p.workspaceId]);await c.query("INSERT INTO app.lead VALUES($1,$2,'list',$3) ON CONFLICT(workspace_id,id) DO UPDATE SET payload=EXCLUDED.payload",[p.workspaceId,id,{id,listId:'list',name:'QA',source:'MANUAL'}]);});}
test('direct SQL lead insertion requires entitlement; concurrent imports consume once and edits do not debit',async()=>{
 const u=await billingUser();await assert.rejects(addLead(u.p,'no-plan'),{code:'BILLING_REQUIRED'});await beginTrial(u.p);
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET quantity=1 WHERE workspace_id=$1 AND unit='imports'",[u.p.workspaceId]));
 const result=await Promise.allSettled([addLead(u.p,'a'),addLead(u.p,'b')]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 const saved=await withWorkspaceTransaction(u.p,async c=>(await c.query('SELECT id FROM app.lead')).rows[0].id);
 await addLead(u.p,saved);assert.equal((await readBilling(u.p)).balances.find(x=>x.unit==='imports')?.consumed,1);
});
test('channel and pending-seat capacity is serialized in the database, including before trial',async()=>{
 const u=await billingUser();
 const connection=()=>withWorkspaceTransaction(u.p,c=>c.query("INSERT INTO app.channel_connection(workspace_id,id,provider,name,public_id,identifiers,created_by) VALUES($1,$2,'meta','QA',$2,'{}',$3)",[u.p.workspaceId,randomUUID(),u.p.userId]));
 const results=await Promise.allSettled([connection(),connection(),connection()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,2);assert.equal((results.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code,'BILLING_CAPACITY');
 await identityAction(u.headers,{type:'invite',email:'first@cadence.example',role:'operator'});
 await assert.rejects(identityAction(u.headers,{type:'invite',email:'second@cadence.example',role:'operator'}),/capacidade|BILLING_CAPACITY/i);
});
test('generation reserves commercial quota, expired subscription denies the next provider call but keeps its hold',async()=>{
 configureProspectingTest();const u=await billingUser();await beginTrial(u.p);
 const input=generationInput(),review=await prepareJob(u.p,input),job=await confirmJob(u.p,{requestId:randomUUID(),input,reviewToken:review.token});
 assert.equal((await readBilling(u.p)).balances.find(x=>x.unit==='extractions')?.reserved,5);
 const lease=await grantTestLease(u.p,job.id);await testAdmin(c=>c.query("UPDATE app.billing_account SET period_end=now()-interval '1 second' WHERE workspace_id=$1",[u.p.workspaceId]));let calls=0;
 await assert.rejects(performStep(lease,'new-expense','apify',{apifyRuns:1},async()=>{calls++;return {};}),/teste|assinatura|BILLING_REQUIRED/i);assert.equal(calls,0);
 const hold=await withLeasedTransaction(lease,async c=>(await c.query("SELECT sum(held)::int AS n FROM app.billing_allocation WHERE key=$1",['job:'+job.id])).rows[0].n);assert.equal(hold,5);
 const receipt=randomUUID();await withLeasedTransaction(lease,c=>ingestPage(c,lease,{receiptId:receipt,candidates:[{source:'MAPS',sourceRef:'late-result',name:'Already received',phone:'5511998877665'}],rejected:[],rawCount:1,nextCursor:null,exhausted:true,usage:{provider:'apify',operationId:receipt,units:{candidates:1},costUsd:null,costKind:'unknown'}}));
 assert.equal((await readBilling(u.p)).balances.find(x=>x.unit==='extractions')?.consumed,1);
});
test('activating another cadence above capacity fails without truncating stored drafts',async()=>{
 const u=await billingUser();await beginTrial(u.p);
 await testAdmin(async c=>{await c.query("INSERT INTO app.list VALUES($1,'capacity','Capacity')",[u.p.workspaceId]);await c.query("INSERT INTO app.cadence(workspace_id,id,list_id,payload) SELECT $1,'active-'||n,'capacity',jsonb_build_object('id','active-'||n,'listId','capacity','status','active') FROM generate_series(1,100) n",[u.p.workspaceId]);});
 await assert.rejects(withWorkspaceTransaction(u.p,c=>c.query("INSERT INTO app.cadence VALUES($1,'over','capacity','{\"id\":\"over\",\"listId\":\"capacity\",\"status\":\"active\"}')",[u.p.workspaceId])),{code:'BILLING_CAPACITY'});
 assert.equal((await readBilling(u.p)).usage.cadences,100);
});
test('privileged cleanup releases resolved revoked jobs but preserves unresolved remote holds',async()=>{
 configureProspectingTest();const u=await billingUser();await beginTrial(u.p);const input=generationInput(),r=await prepareJob(u.p,input),job=await confirmJob(u.p,{requestId:randomUUID(),input,reviewToken:r.token});
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId]));
 await workerPool().query('SELECT app.claim_revoked_prospecting_cleanup($1)',[u.p.workspaceId]);
 const held=await testAdmin(async c=>(await c.query('SELECT sum(held)::int AS n FROM app.billing_allocation WHERE workspace_id=$1 AND key=$2',[u.p.workspaceId,'job:'+job.id])).rows[0].n);assert.equal(held,0);
});
test('an abort timeout retains commercial credit and journals an explicitly reconcilable uncertainty',async()=>{
 configureProspectingTest();const u=await billingUser();await beginTrial(u.p);const input=generationInput(),r=await prepareJob(u.p,input),job=await confirmJob(u.p,{requestId:randomUUID(),input,reviewToken:r.token}),lease=await grantTestLease(u.p,job.id);
 const run={provider:'apify',runId:'abort-run',datasetId:'abort-data',profileId:'compass/crawler-google-places',build:'fixture-build',operationId:'start'};
 await testAdmin(c=>c.query("UPDATE app.prospecting_job SET state='cancelling',provider_run=$2 WHERE id=$1",[job.id,run]));
 await runGeneration(lease,{apify:{abort:async()=>{throw new ProviderError('TIMEOUT',0,true);}} as any});
 const result=await testAdmin(async c=>({job:(await c.query('SELECT state FROM app.prospecting_job WHERE id=$1',[job.id])).rows[0],hold:(await c.query('SELECT sum(held)::int AS n FROM app.billing_allocation WHERE workspace_id=$1 AND key=$2',[u.p.workspaceId,'job:'+job.id])).rows[0].n,attempt:(await c.query("SELECT state FROM app.prospecting_attempt WHERE job_id=$1 AND step='abort:abort-run'",[job.id])).rows[0]}));
 assert.equal(result.job.state,'needs_reconciliation');assert.equal(result.hold,5);assert.equal(result.attempt?.state,'uncertain');
 await assert.rejects(reconcileJob(u.p,job.id,{resultUnavailable:true}),{status:409});
 let status='RUNNING';const adapter={request:async(_ctx:any,path:string)=>({data:path.startsWith('/acts/')?{id:'actor_fixture'}:{actId:'actor_fixture',buildId:'fixture-build',defaultDatasetId:'abort-data',status}})} as any;
 await assert.rejects(reconcileJob(u.p,job.id,{runId:'abort-run'},{apify:adapter}),{status:409});status='ABORTED';
 assert.equal((await reconcileJob(u.p,job.id,{runId:'abort-run'},{apify:adapter})).state,'cancelled');
 assert.equal((await readBilling(u.p)).balances.find(x=>x.unit==='extractions')?.reserved,0);
});
test('a terminal receipt after creator revocation releases commercial hold while a remote run waits for confirmed cleanup',async()=>{
 for(const remote of [false,true]){
  const u=await billingUser();await beginTrial(u.p);const input=generationInput(),r=await prepareJob(u.p,input),job=await confirmJob(u.p,{requestId:randomUUID(),input,reviewToken:r.token}),lease=await grantTestLease(u.p,job.id);
  const run={provider:'apify',runId:'revoked-run',datasetId:'revoked-data',profileId:'compass/crawler-google-places',build:'fixture-build',operationId:'start'};
  await assert.rejects(performStep(lease,'start','apify',{apifyRuns:1},async()=>{await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId]));return remote?{kind:'remote',run}:{kind:'inline',page:{retained:true}};}));
  const held=async()=>testAdmin(async c=>(await c.query('SELECT sum(held)::int AS n FROM app.billing_allocation WHERE workspace_id=$1 AND key=$2',[u.p.workspaceId,'job:'+job.id])).rows[0].n);
  assert.equal(await held(),remote?5:0);
  if(remote){await testAdmin(c=>c.query("UPDATE app.prospecting_job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]));const ticket=(await workerPool().query('SELECT app.claim_revoked_prospecting_cleanup($1) AS ticket',[u.p.workspaceId])).rows[0].ticket;await workerPool().query('SELECT app.ack_revoked_prospecting_cleanup($1,$2,$3,$4,true)',[job.id,ticket.token,ticket.fence,run.runId]);await workerPool().query('SELECT app.claim_revoked_prospecting_cleanup($1)',[u.p.workspaceId]);assert.equal(await held(),0);}
 }
});
