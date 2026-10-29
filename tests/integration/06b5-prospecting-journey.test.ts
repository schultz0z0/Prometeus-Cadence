import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,closeProspectingPools,testAdmin} from './prospecting-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {prepareJourney,confirmJourney,getJourney,cancelJourney,prepareJourneyResume,resumeJourney,advanceJourney,prepareJourneyCadence,confirmJourneyCadence} from '../../src/server/research/journey.ts';
import {runWorkerOnce} from '../../src/server/prospecting/worker.ts';
import {preparePlanningSelection,confirmPlanningSelection} from '../../src/server/planning/confirmation.ts';
import {withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {grantTestLease} from './prospecting-helpers.ts';
import {runCompanyResearch} from '../../src/server/research/company.ts';
import {journeyRequest} from '../../src/server/research/journey-http.ts';
import {base,resetRateLimits} from './helpers.ts';
configureProspectingTest();Object.assign(process.env,{PROSPECTING_GLOBAL_CONCURRENCY:'32',OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({candidates:1000,apifyRuns:2000,openaiCalls:2000}),PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({candidates:100000,apifyRuns:100000,openaiCalls:100000})});
after(async()=>{await workerPool().end();await closeProspectingPools();});
beforeEach(resetRateLimits);
async function fixture(n=2){
 const f=await prospectingUser({platformAi:true});await saveAiPolicy(f.p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});
 await testAdmin(c=>c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)',[f.p.workspaceId,{version:1,approvedAt:new Date().toISOString(),offer:'Gestão para clínicas',idealCustomer:'Clínicas no Rio'}]));
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET quantity=1000 WHERE workspace_id=$1 AND unit='enrichment'",[f.p.workspaceId]));
 const input={brief:'Clínicas odontológicas',location:'Rio de Janeiro',limit:n};return{...f,input};
}
async function start(f:Awaited<ReturnType<typeof fixture>>){const review=await prepareJourney(f.p,f.input);assert.deepEqual(review.blockers,[]);const body={input:f.input,token:review.token,requestId:randomUUID()};return{body,journey:await confirmJourney(f.p,body)};}
async function done(f:Awaited<ReturnType<typeof fixture>>,journey:any,name:string,state='completed',n=2){
 const s=journey.stages.filter((s:any)=>s.name===name).at(-1);assert.ok(s?.jobId,name);
 if(name==='discover'){const snap=await readWorkspaceSnapshot(f.p);await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snap.revision,command:{type:'leads.import',leads:Array.from({length:n},(_,i)=>({id:randomUUID(),listId:journey.listId,name:'Clínica '+i,site:'https://clinica'+i+'.example',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()}))}});}
 await testAdmin(async c=>{if(name==='discover'){const leads=(await c.query('SELECT id,payload FROM app.lead WHERE workspace_id=$1 AND list_id=$2',[f.p.workspaceId,journey.listId])).rows;for(const l of leads)await c.query("INSERT INTO app.prospecting_item(workspace_id,id,job_id,lead_id,name,status,payload) VALUES($1,$2,$3,$4,$5,'inserted','{}')",[f.p.workspaceId,randomUUID(),s.jobId,l.id,l.payload.name]);}
 await c.query('UPDATE app.prospecting_job SET state=$2,lease_until=clock_timestamp()-interval \'1 second\' WHERE id=$1',[s.jobId,state]);});
 const row=(await workerPool().query('SELECT * FROM app.claim_journey_advance($1)',[f.p.workspaceId])).rows[0];assert.ok(row,'durable advance ticket');
 return advanceJourney({workspaceId:row.workspace_id,jobId:row.job_id,actorId:row.actor_id,token:row.token,fence:Number(row.fence),expiresAt:row.expires_at.toISOString()});
}
test('one reviewed request creates one journey, one list, one reserved discovery and no cadence or publication',async()=>{
 const f=await fixture(),r=await prepareJourney(f.p,f.input);assert.equal((await readWorkspaceSnapshot(f.p)).data.lists.length,0);
 const body={input:f.input,token:r.token,requestId:randomUUID()},[a,b]=await Promise.all([confirmJourney(f.p,body),confirmJourney(f.p,body)]);assert.equal(a.id,b.id);assert.equal(a.stages.length,1);
 assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.prospecting_job WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].n)),1);
 const snap=await readWorkspaceSnapshot(f.p);assert.equal(snap.data.lists.length,1);assert.equal(snap.data.cadences.length,0);
 await assert.rejects(confirmJourney(f.p,{...body,input:{...f.input,limit:3}}),(e:any)=>e.status===409);
});
test('discovery advances through existing job dispatcher; no second discovery runs after the crash gap',async()=>{
 const f=await fixture(),{journey}=await start(f);let calls=0;
 const apify={start:async(ctx:any)=>{calls++;return{kind:'inline' as const,page:{receiptId:'r',candidates:[{sourceRef:'clinic',name:'Clínica',site:'https://clinic.example',source:'MAPS' as const}],nextCursor:null,exhausted:true,rawCount:1,rejected:[],usage:{provider:'apify',operationId:ctx.operationId,units:{candidates:1},costUsd:null,costKind:'unknown' as const}}};},poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}};
 await runWorkerOnce({apify},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 const current=await getJourney(f.p,journey.id);assert.equal(calls,1,JSON.stringify(current));assert.equal(current.stages.filter(s=>s.name==='research').length,1,JSON.stringify(current));assert.equal((await readWorkspaceSnapshot(f.p)).data.leads.length,1);
});
test('partial source failures retain 70 companies and reviewed resume retries only 30 pending companies',async()=>{
 const f=await fixture(100),{journey}=await start(f);let j=await done(f,journey,'discover','completed',100),research=j.stages.find(s=>s.name==='research')!;
 await testAdmin(async c=>{await c.query("SELECT set_config('app.workspace_id',$1,false),set_config('app.user_id',$2,false)",[f.p.workspaceId,f.p.userId]);const cases=(await c.query('SELECT lead_id FROM app.research_case WHERE job_id=$1 ORDER BY lead_id',[research.jobId])).rows;for(let i=0;i<cases.length;i++)await c.query("UPDATE app.research_case SET state=$3,missing=$4::jsonb WHERE job_id=$1 AND lead_id=$2",[research.jobId,cases[i].lead_id,i<70?'completed':'partial',JSON.stringify(i<70?[]:['PAGINA_INDISPONIVEL'])]);});
 j=await done(f,j,'research','partial');assert.ok(j.stages.some(s=>s.name==='people'));
 await cancelJourney(f.p,j.id);const review=await prepareJourneyResume(f.p,j.id),resumed=await resumeJourney(f.p,j.id,{token:review.token,requestId:randomUUID()});
 const latest=resumed.stages.filter(s=>s.name==='research').at(-1)!;assert.equal(latest.companies,30);assert.notEqual(latest.jobId,research.jobId);
 const successful=await testAdmin(async c=>Number((await c.query("SELECT count(*) n FROM app.research_case WHERE job_id=$1 AND state='completed'",[research.jobId])).rows[0].n));assert.equal(successful,70);
});
test('context changes require a new review and keep discovery facts; stale confirmations and uncertain effects cannot restart',async()=>{
 const f=await fixture(),{journey}=await start(f),j=await done(f,journey,'discover');await cancelJourney(f.p,j.id);const old=await prepareJourneyResume(f.p,j.id);
 await testAdmin(c=>c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,2,$2)',[f.p.workspaceId,{version:2,approvedAt:new Date().toISOString(),offer:'Outra oferta',idealCustomer:'Clínicas'}]));
 await assert.rejects(resumeJourney(f.p,j.id,{token:old.token,requestId:randomUUID()}),(e:any)=>e.status===409);
 const r=await prepareJourneyResume(f.p,j.id),again=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});assert.equal(again.stages.filter(s=>s.name==='discover').length,1);assert.equal((await readWorkspaceSnapshot(f.p)).data.leads.length,2);
 const g=await fixture(),s=await start(g);await testAdmin(c=>c.query("UPDATE app.prospecting_job SET state='needs_reconciliation',lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[s.journey.stages[0].jobId]));await cancelJourney(g.p,s.journey.id);const unknown=await prepareJourneyResume(g.p,s.journey.id);assert.ok(unknown.blockers.length);await assert.rejects(resumeJourney(g.p,s.journey.id,{token:unknown.token,requestId:randomUUID()}),(e:any)=>e.status===409);
});
test('resuming a paused queued stage does not skip research or cancelled downstream people batches',async()=>{
 const f=await fixture(),{journey}=await start(f);let j=await done(f,journey,'discover');await cancelJourney(f.p,j.id);let r=await prepareJourneyResume(f.p,j.id);j=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});assert.equal(j.stages.at(-1)?.name,'research');
 j=await done(f,j,'research');assert.equal(j.stages.at(-1)?.name,'people');await cancelJourney(f.p,j.id);r=await prepareJourneyResume(f.p,j.id);j=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});assert.equal(j.stages.at(-1)?.name,'people');
 j=await done(f,j,'people');assert.equal(j.stages.at(-1)?.name,'qualify');j=await done(f,j,'qualify');assert.equal(j.state,'review');assert.equal(j.stages.filter(s=>s.name==='discover').length,1);
});
test('tenant, current role, stale worker fence and revoked actor cannot create downstream jobs',async()=>{
 const f=await fixture(),other=await fixture(),{journey}=await start(f);await assert.rejects(getJourney(other.p,journey.id),(e:any)=>e.status===404);
 await assert.rejects(advanceJourney({workspaceId:f.p.workspaceId,actorId:f.p.userId,jobId:journey.stages[0].jobId!,token:'forged',fence:1,expiresAt:new Date().toISOString()}),(e:any)=>e.status===409);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));await assert.rejects(prepareJourney(f.p,f.input),(e:any)=>e.status===403);
 assert.equal((await withWorkspaceTransaction(f.p,c=>c.query("UPDATE app.prospecting_journey SET state='ready' WHERE id=$1",[journey.id]))).rowCount,0);
 assert.equal((await getJourney(f.p,journey.id)).state,'running');
});
test('revocation or context mutation during collection prevents result publication and later jobs',async()=>{
 for(const changed of ['role','context']){const f=await fixture(),{journey}=await start(f),j=await done(f,journey,'discover'),stage=j.stages.find(s=>s.name==='research')!,lease=await grantTestLease(f.p,stage.jobId!);let calls=0;
  await runCompanyResearch(lease,{collect:async()=>{calls++;await testAdmin(c=>changed==='role'?c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]):c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,2,$2)',[f.p.workspaceId,{version:2,approvedAt:new Date().toISOString(),offer:'Alterada',idealCustomer:'Outra empresa'}]));return[{id:'page',url:'https://clinica0.example',text:'Clínica teste contato contato@example.com',hash:'test',fetchedAt:new Date().toISOString(),truncated:false}];}}).catch(()=>{});
  assert.equal(calls,1);assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.research_source WHERE job_id=$1',[stage.jobId])).rows[0].n)),0);if(changed==='role')await assert.rejects(advanceJourney(lease),(e:any)=>e.status===403);else await advanceJourney(lease);assert.equal((await getJourney(f.p,j.id)).stages.filter(s=>s.name==='people').length,0);
 }
});
test('preparing cadence has no side effects, repeated confirmation queues once and selection creates exactly one draft',async()=>{
 const f=await fixture(),{journey}=await start(f);let j=await done(f,journey,'discover');j=await done(f,j,'research');j=await done(f,j,'people');j=await done(f,j,'qualify');assert.equal(j.state,'review');
 const before=await readWorkspaceSnapshot(f.p),r=await prepareJourneyCadence(f.p,j.id,{channels:['EMAIL']}),body={channels:['EMAIL'],token:r.token,requestId:randomUUID()};
 assert.equal((await readWorkspaceSnapshot(f.p)).data.lists.length,before.data.lists.length);assert.equal((await readWorkspaceSnapshot(f.p)).data.cadences.length,0);
 const [a,b]=await Promise.all([confirmJourneyCadence(f.p,j.id,body),confirmJourneyCadence(f.p,j.id,body)]);assert.equal(a.proposalJobId,b.proposalJobId);
 const jobId=a.proposalJobId!,steps=[{channel:'EMAIL',delayDays:0,subject:'Olá {{nome}}',body:'Olá {{nome}}, podemos conversar?',stopOnReply:true}],options=['option_1','option_2','option_3'].map((id,i)=>({id,name:'Contato '+i,description:'Proposta',steps:steps.map(s=>({...s,body:s.body+' '+i}))}));
 await testAdmin(async c=>{await c.query("UPDATE app.prospecting_job SET state='completed' WHERE id=$1",[jobId]);const job=(await c.query('SELECT checkpoint FROM app.prospecting_job WHERE id=$1',[jobId])).rows[0];await c.query('INSERT INTO app.planning_proposal(workspace_id,job_id,body_hash,payload) VALUES($1,$2,\'fixture\',$3)',[f.p.workspaceId,jobId,{task:'cadence_options',contractVersion:'planning-v1',jobId,base:job.checkpoint.planning.base,evidenceIds:[],recommendedOptionId:null,options}]);});
 const edits={name:'Rascunho revisado',steps},selection=await preparePlanningSelection(f.p,jobId,{optionId:'option_1',edits}),confirm={optionId:'option_1',edits,reviewToken:selection.token,requestId:randomUUID()},first=await confirmPlanningSelection(f.p,jobId,confirm),again=await confirmPlanningSelection(f.p,jobId,confirm);assert.equal(first.cadenceId,again.cadenceId);
 const snap=await readWorkspaceSnapshot(f.p);assert.equal(snap.data.cadences.length,1);assert.equal(snap.data.cadences[0].status,'draft');assert.equal(snap.data.cadences[0].steps.length,1);assert.equal(snap.data.cadences[0].origin?.jobId,jobId);assert.equal((await getJourney(f.p,j.id)).state,'ready');
 assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.message_outbox WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].n)),0);
});
test('HTTP authenticates and scopes every operation, rejects invalid bodies and stale reviews, and replays once',async()=>{
 const f=await fixture(),call=(body:unknown,headers:Headers=f.headers,id?:string,action?:string)=>journeyRequest(new Request(base+'/api/prospecting/journeys',{method:'POST',headers,body:JSON.stringify(body)}),id,action);
 assert.ok([401,403].includes((await call({action:'prepare',input:f.input},new Headers({origin:base}))).status));
 assert.equal((await call({action:'prepare',input:{...f.input,limit:501}})).status,422);
 const review=await(await call({action:'prepare',input:f.input})).json(),body={action:'confirm',input:f.input,token:review.token,requestId:randomUUID()},first=await call(body);assert.equal(first.status,200);const j=await first.json();assert.equal((await(await call(body)).json()).id,j.id);
 const foreign=await fixture();assert.equal((await journeyRequest(new Request(base+'/api/prospecting/journeys?id='+j.id,{headers:foreign.headers}))).status,404);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));assert.equal((await call({action:'prepare',input:f.input})).status,403);
 const g=await fixture(),r=await(await call({action:'prepare',input:g.input},g.headers)).json();await testAdmin(c=>c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,2,$2)',[g.p.workspaceId,{version:2,approvedAt:new Date().toISOString(),offer:'Nova',idealCustomer:'Novo'}]));assert.equal((await call({action:'confirm',input:g.input,token:r.token,requestId:randomUUID()},g.headers)).status,409);
});
