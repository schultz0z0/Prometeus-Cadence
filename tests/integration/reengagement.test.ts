import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {automationFixture,activate} from './automation-helpers.ts';import {testAdmin,closeProspectingPools} from './prospecting-helpers.ts';import {resetRateLimits} from './helpers.ts';
import {readWorkspaceSnapshot,executeWorkspaceCommand} from '../../src/server/workspaces/commands.ts';import {readAutomationRuntime,listAutomationOccurrences} from '../../src/server/automations/repository.ts';
import {prepareAutomationAction,confirmAutomationAction,pauseAutomation} from '../../src/server/automations/authorization.ts';import {runSchedulerOnce} from '../../src/server/automations/scheduler.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
beforeEach(()=>{resetRateLimits();process.env.AUTOMATIONS_SCHEDULER_ENABLED='true';});after(async()=>{await workerPool().end();await closeProspectingPools();});
async function fixture(){const f=await automationFixture(),s=await readWorkspaceSnapshot(f.p),target=randomUUID(),id=randomUUID(),model=s.data.automations[0];await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'automation.save',list:{id:target,name:'[RE] Segunda lista'},automation:{...model,id,name:'Reengajar',source:'REENGAGE',listId:target,modules:[],filters:{sourceListId:f.listId,afterDays:'7'},dailyLimit:10}}});return{...f,id,target};}
async function lead(f:Awaited<ReturnType<typeof fixture>>,kind:'eligible'|'replied'|'suppressed'|'recent'|'active'|'unanswered'='eligible'){
 const id=randomUUID(),identity=randomUUID(),cadence=randomUUID(),publication=randomUUID(),enrollment=randomUUID();
 await testAdmin(async c=>{await c.query('BEGIN');try{
 await c.query('INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.p.workspaceId,id,f.listId,{id,listId:f.listId,name:'[RE] '+kind,source:'MANUAL',qualification:'qualified',createdAt:new Date().toISOString()}]);
 await c.query('INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.p.workspaceId,cadence,f.listId,{id:cadence}]);
 await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id,reply_epoch) VALUES($1,$2,'email',$3,$4)",[f.p.workspaceId,identity,id+'@example.test',kind==='replied'?1:0]);
 await c.query('INSERT INTO app.cadence_publication(workspace_id,id,cadence_id,created_by,snapshot) VALUES($1,$2,$3,$4,$5)',[f.p.workspaceId,publication,cadence,f.p.userId,{}]);
 await c.query("INSERT INTO app.cadence_enrollment(workspace_id,id,publication_id,lead_id,identity_id,state,anchor_at,last_accepted_at,next_at,authorized_reply_epoch,completed_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()-interval '20 days',clock_timestamp()-interval '10 days',clock_timestamp()-interval '10 days',0,clock_timestamp()-$7::interval)",[f.p.workspaceId,enrollment,publication,id,identity,kind==='active'?'active':'completed',kind==='recent'?'1 day':'8 days']);
 if(kind==='unanswered')await c.query('UPDATE app.cadence_enrollment SET last_accepted_at=NULL WHERE id=$1',[enrollment]);
 if(kind==='suppressed')await c.query("INSERT INTO app.contact_suppression(workspace_id,identity_id,reason) VALUES($1,$2,'optout')",[f.p.workspaceId,identity]);
 await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}});return id;
}
test('reviewed reengagement moves only completed unanswered cadences after the interval, without job, imports or messages; replay is inert',async()=>{
 const f=await fixture(),eligible=await lead(f);for(const k of ['replied','suppressed','recent','active','unanswered'] as const)await lead(f,k);
 const runtime=await readAutomationRuntime(f.p,f.id),review=await prepareAutomationAction(f.p,f.id,{action:'run-once',expectedRevision:runtime.revision});assert.deepEqual(review.blockers,[]);assert.deepEqual(review.usage,[]);
 const body={requestId:randomUUID(),action:'run-once',expectedRevision:runtime.revision,reviewToken:review.token},result=await confirmAutomationAction(f.p,f.id,body);assert.equal('jobId'in result&&result.jobId,null);assert.equal('counts'in result&&result.counts.found,1);assert.deepEqual(await confirmAutomationAction(f.p,f.id,body),result);
 assert.equal((await readWorkspaceSnapshot(f.p)).data.leads.find(l=>l.id===eligible)?.listId,f.target);
 const effects=await testAdmin(async c=>(await c.query('SELECT (SELECT count(*) FROM app.prospecting_job WHERE workspace_id=$1)::int AS jobs,(SELECT count(*) FROM app.message_outbox WHERE workspace_id=$1)::int AS messages,(SELECT count(*) FROM app.billing_consumption WHERE workspace_id=$1)::int AS consumption',[f.p.workspaceId])).rows[0]);assert.deepEqual(effects,{jobs:0,messages:0,consumption:0});
});
test('reengagement scheduler is replay-safe and pause invalidates an outstanding action review',async()=>{
 const f=await fixture();await lead(f);await activate(f.p,f.id);
 await testAdmin(c=>c.query("UPDATE app.automation_runtime SET next_run_at=date_trunc('day',clock_timestamp())-interval '2 days'+interval '7 hours',retry_at=NULL WHERE automation_id=$1",[f.id]));const opts={workspaceId:f.p.workspaceId,signal:new AbortController().signal};await Promise.all([runSchedulerOnce(opts),runSchedulerOnce(opts)]);assert.equal((await listAutomationOccurrences(f.p,f.id)).items.length,1);
 const rt=await readAutomationRuntime(f.p,f.id),review=await prepareAutomationAction(f.p,f.id,{action:'run-once',expectedRevision:rt.revision});await pauseAutomation(f.p,f.id,{requestId:randomUUID(),expectedRevision:rt.revision});await assert.rejects(confirmAutomationAction(f.p,f.id,{requestId:randomUUID(),action:'run-once',expectedRevision:rt.revision,reviewToken:review.token}),/mudou|revis/i);
});
