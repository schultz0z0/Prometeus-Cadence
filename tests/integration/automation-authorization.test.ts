import test,{after,beforeEach} from 'node:test';
import {automationFixture,activate,dueLease,schedulerTransaction} from './automation-helpers.ts';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {prepareAutomationAction,confirmAutomationAction,pauseAutomation} from '../../src/server/automations/authorization.ts';
import {readAutomationRuntime,readAutomationDefinition} from '../../src/server/automations/repository.ts';
import {materializeOccurrence} from '../../src/server/automations/dispatch.ts';
import {withContextTransaction} from '../../src/server/db/transaction.ts';
import {lockWorkspace} from '../../src/server/prospecting/ingestion.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {assertAutomationAuthority} from '../../src/server/automations/guard.ts';
import {latestDueWindow,localDateAt} from '../../src/domain/schedule.ts';
import type {SchedulerLease} from '../../src/domain/automation-runtime.ts';
import type {Principal} from '../../src/domain/workspace.ts';
beforeEach(resetRateLimits);after(closeProspectingPools);
test('recurrence activation is administrative, idempotent and invalidated by generic edits',async()=>{
 const {p,id}=await automationFixture(),runtime=await readAutomationRuntime(p,id);assert.equal(runtime.status,'paused');
 const review=await prepareAutomationAction(p,id,{action:'activate',expectedRevision:runtime.revision}),body={requestId:randomUUID(),action:'activate',expectedRevision:runtime.revision,reviewToken:review.token};
 const [a,b]=await Promise.all([confirmAutomationAction(p,id,body),confirmAutomationAction(p,id,body)]);assert.deepEqual(a,b);assert.ok('status' in a);assert.equal(a.status,'active');assert.ok(a.nextRunAt!>new Date().toISOString());
 let s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'automation.save',automation:{...s.data.automations[0],name:'Editada',status:'active'}}});
 assert.equal((await readAutomationRuntime(p,id)).status,'paused');assert.deepEqual(await confirmAutomationAction(p,id,body),a);
 await assert.rejects(()=>confirmAutomationAction(p,id,{...body,requestId:randomUUID()}),{status:409});
 const bUser=await prospectingUser();await assert.rejects(()=>prepareAutomationAction(bUser.p,id,{action:'activate',expectedRevision:1}),{status:404});
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));await assert.rejects(()=>prepareAutomationAction(p,id,{action:'activate',expectedRevision:3}),{status:403});
});
test('materialization commits one occurrence job reservation and next window atomically',async()=>{
 const {p,id}=await automationFixture();await activate(p,id);const lease=await dueLease(p,id),definition=await readAutomationDefinition(p,id),runtime=await readAutomationRuntime(p,id),window=latestDueWindow(definition.schedule!,runtime.nextRunAt!,new Date().toISOString())!;
 const first=await schedulerTransaction(p,c=>materializeOccurrence(c,lease,window));assert.equal(first.state,'queued');assert.ok(first.jobId);
 const retry=await schedulerTransaction(p,c=>materializeOccurrence(c,lease,window));assert.equal(retry.id,first.id);assert.equal(retry.jobId,first.jobId);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.prospecting_job WHERE workspace_id=$1',[p.workspaceId])).rows[0].count),'1');
 assert.equal(await testAdmin(async c=>(await c.query("SELECT count(*) FROM app.usage_ledger WHERE workspace_id=$1 AND event='reserve'",[p.workspaceId])).rows[0].count),'1');
 const updated=await readAutomationRuntime(p,id);assert.ok(updated.nextRunAt!>new Date().toISOString());
 const job=await testAdmin(async c=>(await c.query('SELECT * FROM app.prospecting_job WHERE workspace_id=$1 AND id=$2',[p.workspaceId,first.jobId])).rows[0]);
 await schedulerTransaction(p,c=>assertAutomationAuthority(c,job,'dispatch'));
 await pauseAutomation(p,id,{requestId:randomUUID(),expectedRevision:updated.revision});
 await assert.rejects(()=>schedulerTransaction(p,c=>assertAutomationAuthority(c,job,'dispatch')),{status:409});
 await schedulerTransaction(p,c=>assertAutomationAuthority(c,job,'result'));
});
test('budget rejection records a blocked occurrence and no orphan job',async()=>{
 const {p,id}=await automationFixture();await activate(p,id);const lease=await dueLease(p,id),definition=await readAutomationDefinition(p,id),runtime=await readAutomationRuntime(p,id);
 // Consume the allowance through a separate valid job after authorizing recurrence.
 const {prepareJob,confirmJob}=await import('../../src/server/prospecting/service.ts');
 const input={kind:'generation' as const,source:'MAPS' as const,destination:{mode:'existing' as const,listId:definition.payload.listId},filters:{term:'clínicas',location:'São Paulo'},limit:1000,dedupScope:'workspace' as const};
 for(let i=0;i<2;i++){const request={...input,limit:500},r=await prepareJob(p,request);await confirmJob(p,{requestId:randomUUID(),input:request,reviewToken:r.token});}
 const window=latestDueWindow(definition.schedule!,runtime.nextRunAt!,new Date().toISOString())!;
 const occurrence=await schedulerTransaction(p,c=>materializeOccurrence(c,lease,window));assert.equal(occurrence.state,'blocked');assert.equal(occurrence.jobId,null);assert.equal(occurrence.blockedCode,'USAGE_LIMIT');
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.prospecting_job WHERE workspace_id=$1',[p.workspaceId])).rows[0].count),'2');
});

test('manual execution is one-shot, replayable and independent of recurring pause',async()=>{
 const {p,id}=await automationFixture(),before=await readAutomationRuntime(p,id);
 const review=await prepareAutomationAction(p,id,{action:'run-once',expectedRevision:before.revision});
 const body={requestId:randomUUID(),action:'run-once',expectedRevision:before.revision,reviewToken:review.token};
 const occurrence=await confirmAutomationAction(p,id,body);assert.ok('jobId' in occurrence);assert.ok(occurrence.jobId);assert.equal(occurrence.origin,'manual');
 assert.deepEqual(await confirmAutomationAction(p,id,body),occurrence);assert.deepEqual(await readAutomationRuntime(p,id),before);
 const job=await testAdmin(async c=>(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[occurrence.jobId])).rows[0]);
 await pauseAutomation(p,id,{requestId:randomUUID(),expectedRevision:before.revision});
 await schedulerTransaction(p,c=>assertAutomationAuthority(c,job,'dispatch'));
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));
 await assert.rejects(()=>schedulerTransaction(p,c=>assertAutomationAuthority(c,job,'dispatch')),{status:409});
});
test('manual saved dedup scope is execution metadata and never an upstream search filter',async()=>{
 const {p,id}=await automationFixture(),snapshot=await readWorkspaceSnapshot(p),automation=snapshot.data.automations[0];
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'automation.save',automation:{...automation,filters:{...automation.filters,scope:'list',dedup:'cnpj'}}}});
 const runtime=await readAutomationRuntime(p,id),review=await prepareAutomationAction(p,id,{action:'run-once',expectedRevision:runtime.revision});assert.deepEqual(review.blockers,[]);
 const occurrence=await confirmAutomationAction(p,id,{requestId:randomUUID(),action:'run-once',expectedRevision:runtime.revision,reviewToken:review.token});assert.ok('jobId' in occurrence);
 const input=await testAdmin(async c=>(await c.query('SELECT input FROM app.prospecting_job WHERE id=$1',[occurrence.jobId])).rows[0].input);assert.equal(input.dedupScope,'list');assert.deepEqual(input.filters,automation.filters);
});

test('configuration changes invalidate the review and dispatch without network; worker needs a current lease',async()=>{
 const {p,id}=await automationFixture(),runtime=await readAutomationRuntime(p,id);
 const review=await prepareAutomationAction(p,id,{action:'activate',expectedRevision:runtime.revision});
 const oldCharge=process.env.APIFY_MAX_CHARGE_USD;process.env.APIFY_MAX_CHARGE_USD='0.2';
 try{await assert.rejects(()=>confirmAutomationAction(p,id,{requestId:randomUUID(),action:'activate',expectedRevision:runtime.revision,reviewToken:review.token}),{status:409});}finally{process.env.APIFY_MAX_CHARGE_USD=oldCharge;}
 await activate(p,id);const lease=await dueLease(p,id),definition=await readAutomationDefinition(p,id),current=await readAutomationRuntime(p,id),window=latestDueWindow(definition.schedule!,current.nextRunAt!,new Date().toISOString())!;
 await assert.rejects(()=>schedulerTransaction(p,c=>materializeOccurrence(c,{...lease,token:randomUUID()},window)));
 const occurrence=await schedulerTransaction(p,c=>materializeOccurrence(c,lease,window)),job=await testAdmin(async c=>(await c.query('SELECT * FROM app.prospecting_job WHERE id=$1',[occurrence.jobId])).rows[0]);
 process.env.APIFY_MAX_CHARGE_USD='0.2';try{await assert.rejects(()=>schedulerTransaction(p,c=>assertAutomationAuthority(c,job,'dispatch')),{status:409});await schedulerTransaction(p,c=>assertAutomationAuthority(c,job,'result'));}finally{process.env.APIFY_MAX_CHARGE_USD=oldCharge;}
 await assert.rejects(()=>schedulerTransaction(p,c=>c.query("INSERT INTO app.automation_occurrence(workspace_id,id,automation_id,definition_revision,authorization_id,origin,scheduled_at,state) SELECT workspace_id,$2,automation_id,definition_revision,authorization_id,'schedule',clock_timestamp(),'empty' FROM app.automation_runtime WHERE automation_id=$1",[id,randomUUID()])));
});
