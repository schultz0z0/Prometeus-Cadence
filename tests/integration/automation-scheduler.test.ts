import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {automationFixture,activate} from './automation-helpers.ts';
import {testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {runSchedulerOnce} from '../../src/server/automations/scheduler.ts';
import {listAutomationOccurrences,readAutomationRuntime} from '../../src/server/automations/repository.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {grantTestLease} from './prospecting-helpers.ts';
import {withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {ingestPage} from '../../src/server/prospecting/ingestion.ts';
import {normalizeCandidate} from '../../src/server/prospecting/normalize.ts';
import {finishJob} from '../../src/server/prospecting/journal.ts';
import {automationRequest} from '../../src/server/automations/http.ts';
import {cancelJob} from '../../src/server/prospecting/service.ts';
import {eligibleLeads} from '../../src/server/automations/assignments.ts';
import {pauseAutomation} from '../../src/server/automations/authorization.ts';
import {claimJob} from '../../src/server/prospecting/lease.ts';
import {readAutomationDefinition} from '../../src/server/automations/repository.ts';
import {schedulerTransaction} from './automation-helpers.ts';
import {prepareJob,confirmJob,listJobItems} from '../../src/server/prospecting/service.ts';
import {runQualification} from '../../src/server/prospecting/qualification.ts';import {applyJobResults} from '../../src/server/prospecting/application.ts';
beforeEach(()=>{resetRateLimits();process.env.AUTOMATIONS_SCHEDULER_ENABLED='true';process.env.PROSPECTING_GLOBAL_CONCURRENCY='32';});after(closeProspectingPools);
const qa=(workspaceId:string)=>({workspaceId,signal:new AbortController().signal});
async function due(workspaceId:string,id:string){await testAdmin(c=>c.query("UPDATE app.automation_runtime SET next_run_at=date_trunc('day',clock_timestamp())-interval '5 days'+interval '7 hours',retry_at=NULL WHERE workspace_id=$1 AND automation_id=$2",[workspaceId,id]));}
test('two schedulers materialize the latest missed window once and recover committed jobs',async()=>{
 const {p,id}=await automationFixture();await activate(p,id);await due(p.workspaceId,id);
 await Promise.all([runSchedulerOnce(qa(p.workspaceId)),runSchedulerOnce(qa(p.workspaceId))]);
 const first=await listAutomationOccurrences(p,id);assert.equal(first.items.length,1);assert.ok(first.items[0].jobId);assert.ok(first.items[0].skippedWindows>=4);
 assert.equal((await readAutomationRuntime(p,id)).lastRunAt,null);
 // The claim is timestamped by PostgreSQL; the Windows and container clocks can
 // differ by milliseconds. Compare within that same clock and persisted job.
 const beforeClaim=await testAdmin(async c=>(await c.query('SELECT clock_timestamp() AS stamp')).rows[0].stamp.getTime());
 const claim=await claimJob(randomUUID(),p.workspaceId);assert.ok(claim);assert.equal(claim.jobId,first.items[0].jobId);
 const actual=(await readAutomationRuntime(p,id)).lastRunAt;assert.ok(actual&&Date.parse(actual)>=beforeClaim);assert.notEqual(actual,first.items[0].scheduledAt);
 const jobStarted=await testAdmin(async c=>(await c.query('SELECT started_at FROM app.prospecting_job WHERE id=$1',[claim.jobId])).rows[0].started_at.toISOString());assert.equal(actual,jobStarted);
 assert.ok((await readAutomationRuntime(p,id)).nextRunAt!>new Date().toISOString());
 await runSchedulerOnce(qa(p.workspaceId));const replay=await listAutomationOccurrences(p,id);assert.equal(replay.items.length,1);assert.equal(replay.items[0].jobId,first.items[0].jobId);assert.equal(replay.items[0].state,'running');
 await testAdmin(c=>c.query("UPDATE app.prospecting_job SET state='needs_reconciliation' WHERE id=$1",[first.items[0].jobId]));
 await due(p.workspaceId,id);assert.equal(await runSchedulerOnce(qa(p.workspaceId)),false);assert.equal((await listAutomationOccurrences(p,id)).items.length,1);
 await testAdmin(c=>c.query("UPDATE app.prospecting_job SET state='completed' WHERE id=$1",[first.items[0].jobId]));
 await runSchedulerOnce(qa(p.workspaceId));assert.equal((await listAutomationOccurrences(p,id)).items.find(x=>x.id===first.items[0].id)?.state,'completed');
});
test('scheduler is default off; changed configuration blocks and removed authorizer is surfaced',async()=>{
 const {p,id}=await automationFixture();await activate(p,id);await due(p.workspaceId,id);
 delete process.env.AUTOMATIONS_SCHEDULER_ENABLED;assert.equal(await runSchedulerOnce(qa(p.workspaceId)),false);assert.equal((await listAutomationOccurrences(p,id)).items.length,0);
 process.env.AUTOMATIONS_SCHEDULER_ENABLED='true';const old=process.env.APIFY_MAX_CHARGE_USD;process.env.APIFY_MAX_CHARGE_USD='0.3';
 try{await runSchedulerOnce(qa(p.workspaceId));assert.equal((await readAutomationRuntime(p,id)).status,'blocked');}finally{process.env.APIFY_MAX_CHARGE_USD=old;}
 const other=await automationFixture();await activate(other.p,other.id);await due(other.p.workspaceId,other.id);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[other.p.workspaceId,other.p.userId]));
 await runSchedulerOnce(qa(other.p.workspaceId));assert.equal((await readAutomationRuntime(other.p,other.id)).blockedCode,'AUTHORIZER_REMOVED');
});
async function qualifier(f:Awaited<ReturnType<typeof automationFixture>>,limit:number,dependent=false){
 const snapshot=await readWorkspaceSnapshot(f.p),id=randomUUID(),search=snapshot.data.automations.find(a=>a.id===f.id)!;
 await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'automation.save',automation:{...search,id,name:'Qualificar QA',source:'QUALIFY',modules:['phone'],dailyLimit:limit,filters:{},criteria:'Atende clínicas',...(dependent?{dependsOnAutomationId:f.id}:{})}}});return id;
}
test('501 eligible leads yield a bounded batch, durable assignments and one remaining in backlog',async()=>{
 const f=await automationFixture(),id=await qualifier(f,500);
 await testAdmin(c=>c.query("WITH seed AS MATERIALIZED (SELECT gen_random_uuid()::text AS id,n FROM generate_series(1,501) n) INSERT INTO app.lead(workspace_id,id,list_id,payload) SELECT $1,id,$2,jsonb_build_object('id',id,'listId',$2::text,'name','QA '||n,'qualification','pending','createdAt','2026-01-01') FROM seed",[f.p.workspaceId,f.listId]));
 await activate(f.p,id);await due(f.p.workspaceId,id);await runSchedulerOnce(qa(f.p.workspaceId));
 const first=(await listAutomationOccurrences(f.p,id)).items[0];assert.ok(first.jobId);assert.equal((await readAutomationRuntime(f.p,id)).backlog,1);
 const assigned=()=>testAdmin(async c=>(await c.query('SELECT lead_id,state FROM app.automation_lead_assignment WHERE workspace_id=$1 AND automation_id=$2',[f.p.workspaceId,id])).rows);
 assert.equal((await assigned()).length,500);
 await testAdmin(c=>c.query("UPDATE app.prospecting_job SET state='completed',counts=jsonb_set(counts,'{pending}','500') WHERE id=$1",[first.jobId]));
 await due(f.p.workspaceId,id);await runSchedulerOnce(qa(f.p.workspaceId));
 assert.equal((await assigned()).filter(x=>x.state==='pending_review').length,500);
 // Same calendar window replays instead of silently charging for the last lead.
 assert.equal((await listAutomationOccurrences(f.p,id)).items.length,1);
 await testAdmin(c=>c.query("UPDATE app.automation_runtime SET next_run_at=clock_timestamp()-interval '1 hour',retry_at=NULL WHERE automation_id=$1",[id]));
 await runSchedulerOnce({...qa(f.p.workspaceId),now:()=>new Date(Date.now()+86400000)});assert.equal((await assigned()).length,501);assert.equal((await readAutomationRuntime(f.p,id)).backlog,0);
});
test('dependent qualification waits for partial search and assigns only newly inserted leads',async()=>{
 const f=await automationFixture(),id=await qualifier(f,150,true);await activate(f.p,f.id);await activate(f.p,id);await due(f.p.workspaceId,f.id);await due(f.p.workspaceId,id);
 for(let i=0;i<3;i++)await runSchedulerOnce(qa(f.p.workspaceId));
 const search=(await listAutomationOccurrences(f.p,f.id)).items[0],waiting=(await listAutomationOccurrences(f.p,id)).items[0];assert.equal(waiting.state,'waiting_dependency');assert.equal(waiting.jobId,null);
 assert.equal((await readAutomationRuntime(f.p,id)).lastRunAt,null);
 const lease=await grantTestLease(f.p,search.jobId!);
 const batch={receiptId:randomUUID(),candidates:[normalizeCandidate({id:'new',name:'Novo QA',site:'https://example.com'},'MAPS')],nextCursor:null,exhausted:true,rawCount:1,rejected:[],usage:{provider:'apify',operationId:randomUUID(),units:{candidates:1},costUsd:null,costKind:'unknown' as const}};
 await withLeasedTransaction(lease,c=>ingestPage(c,lease,batch));await finishJob(lease,'partial');
 await testAdmin(c=>c.query("INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)",[f.p.workspaceId,randomUUID(),f.listId,{name:'Outro antigo',qualification:'pending',createdAt:'2025-01-01'}]));
 await testAdmin(c=>c.query('UPDATE app.automation_runtime SET retry_at=NULL WHERE workspace_id=$1',[f.p.workspaceId]));
 for(let i=0;i<3;i++)await runSchedulerOnce(qa(f.p.workspaceId));
 const result=(await listAutomationOccurrences(f.p,id)).items[0];assert.equal(result.id,waiting.id);assert.equal(result.state,'queued');
 const input=await testAdmin(async c=>(await c.query('SELECT input FROM app.prospecting_job WHERE id=$1',[result.jobId])).rows[0].input);assert.equal(input.leadIds.length,1);
});
test('150 unapplied qualifications are never reselected; cancellation before dispatch alone releases assignments',async()=>{
 const f=await automationFixture(),id=await qualifier(f,150);
 await testAdmin(c=>c.query("WITH seed AS MATERIALIZED (SELECT gen_random_uuid()::text AS id,n FROM generate_series(1,150) n) INSERT INTO app.lead(workspace_id,id,list_id,payload) SELECT $1,id,$2,jsonb_build_object('id',id,'listId',$2::text,'name','QA '||n,'qualification','pending','createdAt','2026-01-01') FROM seed",[f.p.workspaceId,f.listId]));
 await activate(f.p,id);await due(f.p.workspaceId,id);await runSchedulerOnce(qa(f.p.workspaceId));
 const first=(await listAutomationOccurrences(f.p,id)).items[0],lease=await grantTestLease(f.p,first.jobId!);
 await testAdmin(c=>c.query("UPDATE app.prospecting_job SET counts=jsonb_set(counts,'{pending}','150') WHERE id=$1",[first.jobId]));await finishJob(lease,'completed');
 await due(f.p.workspaceId,id);await runSchedulerOnce({...qa(f.p.workspaceId),now:()=>new Date(Date.now()+86400000)});
 const occurrences=(await listAutomationOccurrences(f.p,id)).items;assert.equal(occurrences.length,2);assert.equal(occurrences[0].state,'empty');assert.equal(occurrences[0].jobId,null);assert.equal((await readAutomationRuntime(f.p,id)).backlog,0);
 const rows=await testAdmin(async c=>(await c.query('SELECT state,count(*) AS n FROM app.automation_lead_assignment WHERE automation_id=$1 GROUP BY state',[id])).rows);assert.deepEqual(rows,[{state:'pending_review',n:'150'}]);
 // A different automation and cancelled, demonstrably unsent job can release its own selection.
 const second=await qualifier(f,1);await activate(f.p,second);await due(f.p.workspaceId,second);await runSchedulerOnce(qa(f.p.workspaceId));const once=(await listAutomationOccurrences(f.p,second)).items[0];await cancelJob(f.p,once.jobId!);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT state FROM app.automation_lead_assignment WHERE automation_id=$1',[second])).rows[0].state),'released');
});
test('automation HTTP scopes reads and administrative actions and never exposes a public scheduler clock',async()=>{
 const f=await automationFixture(),url=process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210';
 const list=await automationRequest(new Request(url+'/api/automations',{headers:f.headers}));assert.equal(list.status,200);const rows=await list.json();assert.equal(rows[0].runtime.status,'paused');assert.equal('lease_token' in rows[0].runtime,false);
 assert.equal((await automationRequest(new Request(url+'/api/automations/'+f.id+'/tick',{method:'POST',headers:f.headers}),f.id,'tick')).status,404);
 const rt=await readAutomationRuntime(f.p,f.id),headers=new Headers(f.headers);headers.set('content-type','application/json');const body=JSON.stringify({action:'activate',expectedRevision:rt.revision});
 assert.equal((await automationRequest(new Request(url+'/api/automations/'+f.id+'/prepare',{method:'POST',headers,body}),f.id,'prepare')).status,200);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));
 assert.equal((await automationRequest(new Request(url+'/api/automations/'+f.id+'/prepare',{method:'POST',headers,body}),f.id,'prepare')).status,403);
});
test('dependent backlog retains unassigned inserted leads from previous completed search windows',async()=>{
 const f=await automationFixture(),id=await qualifier(f,1,true);await activate(f.p,f.id);await due(f.p.workspaceId,f.id);await runSchedulerOnce(qa(f.p.workspaceId));
 const search=(await listAutomationOccurrences(f.p,f.id)).items[0],lease=await grantTestLease(f.p,search.jobId!);
 await withLeasedTransaction(lease,c=>ingestPage(c,lease,{receiptId:randomUUID(),candidates:[1,2,3].map(n=>normalizeCandidate({id:'backlog-'+n,name:'Clínica '+n},'MAPS')),rawCount:3,rejected:[],nextCursor:null,exhausted:true,usage:{provider:'apify',operationId:randomUUID(),units:{candidates:3},costUsd:null,costKind:'unknown'}}));await finishJob(lease,'partial');
 await activate(f.p,id);await due(f.p.workspaceId,id);await runSchedulerOnce(qa(f.p.workspaceId));const first=(await listAutomationOccurrences(f.p,id)).items[0];assert.equal((await readAutomationRuntime(f.p,id)).backlog,2);
 const day2=new Date(Date.parse(first.scheduledAt)+86400000).toISOString(),newJob=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version,checkpoint) SELECT workspace_id,$2,actor_id,list_id,$3,body_hash,kind,source,'completed',input,profile_version,checkpoint FROM app.prospecting_job WHERE id=$1",[search.jobId,newJob,randomUUID()]);
  await c.query("INSERT INTO app.automation_occurrence(workspace_id,id,automation_id,definition_revision,authorization_id,origin,scheduled_at,state,job_id) SELECT workspace_id,$2,automation_id,definition_revision,authorization_id,'schedule',$3,'completed',$4 FROM app.automation_occurrence WHERE id=$1",[search.id,randomUUID(),day2,newJob]);
 });
 const definition=await readAutomationDefinition(f.p,id),remaining=await schedulerTransaction(f.p,c=>eligibleLeads(c,definition,{...first,id:randomUUID(),scheduledAt:day2},1));assert.equal(remaining.total,2);assert.equal(remaining.ids.length,1);
});
test('reactivation retires an old waiting occurrence instead of mixing authorization epochs',async()=>{
 const f=await automationFixture(),id=await qualifier(f,1,true);await activate(f.p,id);await due(f.p.workspaceId,id);await runSchedulerOnce(qa(f.p.workspaceId));
 const waiting=(await listAutomationOccurrences(f.p,id)).items[0];assert.equal(waiting.state,'waiting_dependency');
 await pauseAutomation(f.p,id,{requestId:randomUUID(),expectedRevision:(await readAutomationRuntime(f.p,id)).revision});await activate(f.p,id);
 assert.equal((await listAutomationOccurrences(f.p,id)).items.find(o=>o.id===waiting.id)?.state,'cancelled');
 const pending=await testAdmin(async c=>(await c.query('SELECT pending_occurrence_id FROM app.automation_runtime WHERE automation_id=$1',[id])).rows[0].pending_occurrence_id);assert.equal(pending,null);
});
test('recurring qualification preserves selected modules, language and source filters in the actual queued input',async()=>{
 const f=await automationFixture(),id=await qualifier(f,10),s=await readWorkspaceSnapshot(f.p),definition=s.data.automations.find(a=>a.id===id)!;
 await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'automation.save',automation:{...definition,filters:{onlyWithSite:'true',onlyMissingEmail:'true',language:'es'},modules:['email','phone']}}});
 await testAdmin(async c=>{for(const [site,email]of [['https://example.com',''],['',''],['https://example.com','existing@example.com']]){const lead=randomUUID();await c.query('INSERT INTO app.lead(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.p.workspaceId,lead,f.listId,{id:lead,listId:f.listId,name:'[RE] Seleção',qualification:'pending',site,email,createdAt:new Date().toISOString()}]);}});
 await activate(f.p,id);await due(f.p.workspaceId,id);await runSchedulerOnce(qa(f.p.workspaceId));const occurrence=(await listAutomationOccurrences(f.p,id)).items[0];assert.ok(occurrence.jobId);
 const input=await testAdmin(async c=>(await c.query('SELECT input FROM app.prospecting_job WHERE id=$1',[occurrence.jobId])).rows[0].input);assert.deepEqual(input.modules,['email','phone']);assert.deepEqual(input.options,{onlyWithSite:true,onlyMissingEmail:true,language:'es'});assert.equal(input.leadIds.length,1);
});
test('recurring skip-processed uses the same applied fingerprint proof as manual qualification',async()=>{
 const f=await automationFixture(),s=await readWorkspaceSnapshot(f.p),leadId=randomUUID();await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{id:leadId,listId:f.listId,name:'[RE] Processado',site:'https://example.com',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()}}});
 const input={kind:'qualification',listId:f.listId,leadIds:[leadId],modules:['email'],summaryPolicy:'all',escalation:'off'},review=await prepareJob(f.p,input),job=await confirmJob(f.p,{requestId:randomUUID(),input,reviewToken:review.token});
 const evidence={id:'e',url:'https://example.com',text:'Contato publicado ana@example.com',hash:'h',fetchedAt:new Date().toISOString(),truncated:false};await runQualification(await grantTestLease(f.p,job.id),{collect:async()=>[evidence]});await runQualification(await grantTestLease(f.p,job.id));await applyJobResults(f.p,job.id,{requestId:randomUUID(),itemIds:(await listJobItems(f.p,job.id)).items.map(i=>i.id)});
 const id=await qualifier(f,10),snapshot=await readWorkspaceSnapshot(f.p),definition=snapshot.data.automations.find(a=>a.id===id)!;await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'automation.save',automation:{...definition,modules:['email'],filters:{skipProcessed:'true'}}}});
 await activate(f.p,id);await due(f.p.workspaceId,id);await runSchedulerOnce(qa(f.p.workspaceId));const occurrence=(await listAutomationOccurrences(f.p,id)).items[0];assert.ok(occurrence.jobId);let calls=0;
 await runQualification(await grantTestLease(f.p,occurrence.jobId!),{collect:async()=>{calls++;return[evidence];}});assert.equal(calls,0);assert.deepEqual((await listJobItems(f.p,occurrence.jobId!)).items[0].results[0].reasons,['ALREADY_PROCESSED']);
});
