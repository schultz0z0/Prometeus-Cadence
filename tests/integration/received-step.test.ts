import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,generationInput,grantTestLease,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {prepareJob,confirmJob,getJob} from '../../src/server/prospecting/service.ts';
import {performStep} from '../../src/server/prospecting/journal.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
configureProspectingTest();after(closeProspectingPools);
test('a received result and measured consumption survive full membership removal without publication or new dispatch',async()=>{
 const {p}=await prospectingUser(),input=generationInput(),review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token}),lease=await grantTestLease(p,job.id);
 const step='start',result={kind:'inline',page:{synthetic:'received before revocation'}},measured={provider:'apify',operationId:'ignored',units:{apifyRuns:1},costUsd:0.01,costKind:'reported' as const};
 let receiptError='';await performStep(lease,step,'apify',{apifyRuns:1},async()=>{await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));return result;},()=>measured).catch(e=>{receiptError=e.message;});
 const saved=await testAdmin(async c=>({attempt:(await c.query('SELECT state,payload FROM app.prospecting_attempt WHERE job_id=$1',[job.id])).rows[0],consumed:(await c.query("SELECT units,cost_usd FROM app.usage_ledger WHERE job_id=$1 AND event='consume'",[job.id])).rows,leads:(await c.query('SELECT count(*) FROM app.lead WHERE workspace_id=$1',[p.workspaceId])).rows[0].count}));
 assert.equal(saved.attempt.state,'completed',receiptError);assert.deepEqual(saved.attempt.payload.result,result);assert.equal(saved.consumed.length,1);assert.deepEqual(saved.consumed[0].units,{apifyRuns:1});assert.equal(Number(saved.consumed[0].cost_usd),0.01);assert.equal(saved.leads,'0');
 let calls=0;await assert.rejects(()=>performStep(lease,'another','apify',{apifyRuns:1},async()=>{calls++;return result;}));assert.equal(calls,0);
 await assert.rejects(()=>workerPool().query('SELECT app.record_received_prospecting_step($1,$2,$3,$4,$5,$6,$7)',[job.id,'forged',lease.fence,lease.actorId,'unknown',{},null]));
 const other=await prospectingUser(),admin={...other.p,workspaceId:p.workspaceId,role:'admin' as const};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,\'admin\',clock_timestamp())',[randomUUID(),p.workspaceId,other.p.userId]));
 assert.deepEqual((await getJob(admin,job.id)).retainedResults?.[0].result,result);await assert.rejects(()=>getJob(p,job.id),{status:403});
});
test('an Apify run received after revocation remains eligible for narrow remote cleanup',async()=>{
 const {p}=await prospectingUser(),input=generationInput(),r=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:r.token}),lease=await grantTestLease(p,job.id);
 const run={provider:'apify',runId:'fixture-run',datasetId:'fixture-data',profileId:'compass/crawler-google-places',build:'fixture-build',operationId:'fixture-op'};
 await performStep(lease,'start','apify',{apifyRuns:1},async()=>{await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));return {kind:'remote',run};},()=>({provider:'apify',operationId:'ignored',units:{apifyRuns:1},costUsd:null,costKind:'unknown'})).catch(()=>{});
 await testAdmin(c=>c.query("UPDATE app.prospecting_job SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]));
 const ticket=(await workerPool().query('SELECT app.claim_revoked_prospecting_cleanup($1) AS ticket',[p.workspaceId])).rows[0].ticket;assert.equal(ticket?.run?.runId,run.runId);
 await workerPool().query('SELECT app.ack_revoked_prospecting_cleanup($1,$2,$3,$4,true)',[job.id,ticket.token,ticket.fence,run.runId]);
});
