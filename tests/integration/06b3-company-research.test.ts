import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,closeProspectingPools,testAdmin,grantTestLease} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {prepareCompanyResearch,confirmCompanyResearch,readCompanyResearch,runCompanyResearch,prepareResearchApplication,confirmResearchApplication} from '../../src/server/research/company.ts';
import {cancelJob} from '../../src/server/prospecting/service.ts';
import {runWorkerOnce} from '../../src/server/prospecting/worker.ts';
import type {ResearchPage} from '../../src/domain/company-research.ts';
import {researchRequest} from '../../src/server/research/http.ts';
import {base} from './helpers.ts';
import {ProviderError} from '../../src/server/prospecting/providers/transport.ts';
import {reconcileJob} from '../../src/server/prospecting/reconciliation.ts';
import {withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {hashValue} from '../../src/server/prospecting/review.ts';
configureProspectingTest();beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});

test('research storage is private and application users cannot forge worker facts',async()=>{
 const {p}=await prospectingUser();
 assert.deepEqual(await withWorkspaceTransaction(p,async c=>(await c.query('SELECT id FROM app.research_case')).rows),[]);
 await assert.rejects(withWorkspaceTransaction(p,c=>c.query("INSERT INTO app.research_fact(workspace_id,job_id,id,lead_id,field,value,evidence,attribution) VALUES($1,'missing',$2,'missing','email','forged@example.com','[]','company')",[p.workspaceId,randomUUID()])),/permission denied/i);
 const rows=await testAdmin(c=>c.query('SELECT id FROM app.research_case WHERE workspace_id=$1',[p.workspaceId]));assert.equal(rows.rowCount,0);
});
async function fixture(){
 const user=await prospectingUser(),leadId=randomUUID(),listId=randomUUID();
 const lead={id:leadId,listId,name:'Clínica Exemplo',site:'https://clinica.example',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()};
 await executeWorkspaceCommand(user.p,{requestId:randomUUID(),expectedRevision:0,command:{type:'leads.import',list:{id:listId,name:'[RE] Pesquisa'},leads:[lead]}});
 return {...user,leadId,listId,input:{leadIds:[leadId],sourceKinds:['website','social'] as ('website'|'social')[],maxPagesPerCompany:3}};
}
const page=(url='https://clinica.example/contato',text='Clínica Exemplo. Contato comercial: contato@clinica.example. Telefone: (21) 3333-4444.'):ResearchPage=>({id:'page',url,text,fetchedAt:'2026-10-27T12:00:00Z',hash:'fixture',truncated:false,links:[],socialLinks:[]});
async function start(f:Awaited<ReturnType<typeof fixture>>){const review=await prepareCompanyResearch(f.p,f.input),request={input:f.input,token:review.token,requestId:randomUUID()};return{review,request,job:await confirmCompanyResearch(f.p,request)};}

test('review is side-effect free and repeated confirmation creates one research job',async()=>{
 const f=await fixture(),review=await prepareCompanyResearch(f.p,f.input);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*)::int AS n FROM app.research_case WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].n),0);
 const body={input:f.input,token:review.token,requestId:randomUUID()},a=await confirmCompanyResearch(f.p,body),b=await confirmCompanyResearch(f.p,body);
 assert.equal(a.id,b.id);assert.equal(a.companies.length,1);assert.equal(a.state,'queued');
});
test('matched public sources produce reviewable contact facts and reviewed application persists once',async()=>{
 const f=await fixture(),{job}=await start(f),lease=await grantTestLease(f.p,job.id);
 await runCompanyResearch(lease,{collect:async()=>[page()]});
 const result=await readCompanyResearch(f.p,job.id);assert.equal(result.state,'completed');
 assert.equal(result.facts.find(f=>f.field==='email')?.value,'contato@clinica.example');
 const email=result.facts.find(f=>f.field==='email')!,input={caseId:job.id,factIds:[email.id],expectedRevision:result.revision};
 const review=await prepareResearchApplication(f.p,input),body={input,token:review.token,requestId:randomUUID()};
 assert.deepEqual(await confirmResearchApplication(f.p,body),{applied:1});assert.deepEqual(await confirmResearchApplication(f.p,body),{applied:1});
 assert.equal((await readWorkspaceSnapshot(f.p)).data.leads[0].email,'contato@clinica.example');
});
test('social failure preserves site results and restart reuses the completed collection',async()=>{
 const f=await fixture(),{job}=await start(f),lease=await grantTestLease(f.p,job.id);let siteCalls=0;
 const site=page();site.socialLinks=['https://www.instagram.com/clinica'];site.text+=' Links públicos: https://www.instagram.com/clinica';
 await runCompanyResearch(lease,{collect:async(kind)=>{if(kind==='social')throw Error('Blocked public profile');siteCalls++;return[site];}});
 const result=await readCompanyResearch(f.p,job.id);assert.equal(result.state,'partial');assert.ok(result.facts.some(f=>f.field==='email'&&f.attribution==='company'));assert.ok(result.missing.length>0);
 assert.equal(siteCalls,1);
});
test('unrelated domains cannot be applied and worker cannot publish after membership revocation',async()=>{
 const f=await fixture(),{job}=await start(f),lease=await grantTestLease(f.p,job.id);
 await runCompanyResearch(lease,{collect:async()=>[page('https://outra.example','Empresa distinta. Contato: outro@outra.example')]});
 const result=await readCompanyResearch(f.p,job.id),email=result.facts.find(f=>f.field==='email')!;
 assert.equal(email.attribution,'uncertain');await assert.rejects(prepareResearchApplication(f.p,{caseId:job.id,factIds:[email.id],expectedRevision:result.revision}));
 const revoked=await fixture(),s=await start(revoked),otherLease=await grantTestLease(revoked.p,s.job.id);
 await assert.rejects(runCompanyResearch(otherLease,{collect:async()=>{await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[revoked.p.workspaceId,revoked.p.userId]));return[page()];}}));
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*)::int AS n FROM app.research_fact WHERE workspace_id=$1',[revoked.p.workspaceId])).rows[0].n),0);
 assert.ok(await testAdmin(async c=>(await c.query('SELECT count(*)::int AS n FROM app.prospecting_attempt WHERE workspace_id=$1',[revoked.p.workspaceId])).rows[0].n)>0);
});
test('research review and application reject changed source data, cross-tenant IDs and selection conflicts',async()=>{
 const f=await fixture(),{job}=await start(f),lease=await grantTestLease(f.p,job.id);
 await runCompanyResearch(lease,{collect:async()=>[page()]});const result=await readCompanyResearch(f.p,job.id),email=result.facts.find(f=>f.field==='email')!;
 const input={caseId:job.id,factIds:[email.id],expectedRevision:result.revision},review=await prepareResearchApplication(f.p,input);
 const other=await fixture();await assert.rejects(readCompanyResearch(other.p,job.id));
 const s=await readWorkspaceSnapshot(f.p);await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...s.data.leads[0],email:'manual@example.com'}}});
 await assert.rejects(confirmResearchApplication(f.p,{input,token:review.token,requestId:randomUUID()}));assert.equal((await readWorkspaceSnapshot(f.p)).data.leads[0].email,'manual@example.com');
});
test('cancelled research makes no collection calls and a disabled optional source makes no provider calls',async()=>{
 const f=await fixture(),{job}=await start(f);await cancelJob(f.p,job.id);
 assert.equal((await readCompanyResearch(f.p,job.id)).state,'cancelled');
 const g=await fixture(),s=await start(g);let providerCalls=0;
 await runCompanyResearch(await grantTestLease(g.p,s.job.id),{collect:async()=>[page()],apify:{start:async()=>{providerCalls++;throw Error('Disabled profile called');},poll:async()=>{throw Error();},readPage:async()=>{throw Error();},abort:async()=>{throw Error();}}});
 assert.equal(providerCalls,0);
});
test('normal worker dispatches the reviewed research mode instead of generic qualification',async()=>{
 const f=await fixture(),{job}=await start(f);
 await runWorkerOnce({research:{collect:async()=>[page()]}},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 assert.equal((await readCompanyResearch(f.p,job.id)).state,'completed');
});
test('cancellation and profile changes during collection cannot publish facts',async()=>{
 const f=await fixture(),{job}=await start(f);
 await runCompanyResearch(await grantTestLease(f.p,job.id),{collect:async()=>{await cancelJob(f.p,job.id);return[page()];}});
 const cancelled=await readCompanyResearch(f.p,job.id);assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.facts.length,0);
 const g=await fixture(),s=await start(g),before=process.env.APIFY_MAX_CHARGE_USD;
 try{await runCompanyResearch(await grantTestLease(g.p,s.job.id),{collect:async()=>{process.env.APIFY_MAX_CHARGE_USD='0.2';return[page()];}});assert.equal((await readCompanyResearch(g.p,s.job.id)).facts.length,0);}finally{process.env.APIFY_MAX_CHARGE_USD=before;}
});
test('batch results select one company and worker checkpoints bound each turn',async()=>{
 const f=await fixture(),snapshot=await readWorkspaceSnapshot(f.p),second=randomUUID();
 await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead:{...snapshot.data.leads[0],id:second,name:'Segunda clínica'}}});
 f.input.leadIds.push(second);const {job}=await start(f),lease=await grantTestLease(f.p,job.id);let calls=0;
 await runCompanyResearch(lease,{collect:async()=>{calls++;return[page()];}});
 assert.equal(calls,1);const first=await readCompanyResearch(f.p,job.id);assert.equal(first.state,'running');
 await runCompanyResearch(lease,{collect:async()=>{calls++;return[page()];}});
 const result=await readCompanyResearch(f.p,job.id);assert.equal(result.state,'completed');assert.equal(calls,2);
 assert.equal(new Set(result.facts.map(v=>v.leadId)).size,1);
 const alternate=await readCompanyResearch(f.p,job.id,{leadId:second});assert.ok(alternate.facts.every(v=>v.leadId===second));
});
test('HTTP boundaries enforce authentication workspace origin role and reviewed idempotent actions',async()=>{
 const f=await fixture();
 const req=(body?:unknown,headers:HeadersInit=f.headers)=>new Request(base+'/api/research',{method:body?'POST':'GET',headers:new Headers(headers),...(body?{body:JSON.stringify(body)}:{})});
 assert.ok([401,403].includes((await researchRequest(req(undefined,{}))).status));
 assert.equal((await researchRequest(req({action:'prepare',input:f.input},{...Object.fromEntries(f.headers),origin:'https://evil.example'}))).status,403);
 assert.equal((await researchRequest(req({action:'prepare',input:{...f.input,leadIds:[]}}))).status,422);
 const prepared=await researchRequest(req({action:'prepare',input:f.input}));assert.equal(prepared.status,200);const review=await prepared.json();
 const body={action:'confirm',input:f.input,token:review.token,requestId:randomUUID()};
 const a=await researchRequest(req(body)),b=await researchRequest(req(body));assert.equal(a.status,200);assert.equal((await a.json()).id,(await b.json()).id);
 const other=await fixture(),cross={...body,input:other.input,requestId:randomUUID()};assert.equal((await researchRequest(req(cross))).status,404);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));
 assert.equal((await researchRequest(req({action:'prepare',input:f.input}))).status,403);
});
test('a known registry failure retains independently collected company website facts',async()=>{
 const oldActor=process.env.APIFY_CNPJ_ACTOR,oldBuild=process.env.APIFY_CNPJ_BUILD;
 try{
  process.env.APIFY_CNPJ_ACTOR='bigdavidson/brazil-cnpj-companies';process.env.APIFY_CNPJ_BUILD='fixture';
  const f=await fixture(),snapshot=await readWorkspaceSnapshot(f.p);
  await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead:{...snapshot.data.leads[0],cnpj:'11444777000161'}}});
  const input={...f.input,sourceKinds:['website','registry']},review=await prepareCompanyResearch(f.p,input),job=await confirmCompanyResearch(f.p,{input,token:review.token,requestId:randomUUID()});
  await runCompanyResearch(await grantTestLease(f.p,job.id),{collect:async()=>[page()],apify:{start:async()=>{throw new ProviderError('REMOTE_FAILED');},poll:async()=>{throw Error();},readPage:async()=>{throw Error();},abort:async()=>{throw Error();}}});
  const result=await readCompanyResearch(f.p,job.id);assert.equal(result.state,'partial');assert.ok(result.facts.some(f=>f.field==='email'));
 }finally{if(oldActor===undefined)delete process.env.APIFY_CNPJ_ACTOR;else process.env.APIFY_CNPJ_ACTOR=oldActor;if(oldBuild===undefined)delete process.env.APIFY_CNPJ_BUILD;else process.env.APIFY_CNPJ_BUILD=oldBuild;}
});
test('a company without a website uses the enabled public search without silently asserting identity',async()=>{
 const oldActor=process.env.APIFY_WEB_ACTOR,oldBuild=process.env.APIFY_WEB_BUILD;
 try{
  process.env.APIFY_WEB_ACTOR='apify/google-search-scraper';process.env.APIFY_WEB_BUILD='fixture';
  const f=await fixture(),snapshot=await readWorkspaceSnapshot(f.p),{site:_site,...lead}=snapshot.data.leads[0];
  await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead}});
  const input={...f.input,sourceKinds:['website']},review=await prepareCompanyResearch(f.p,input),job=await confirmCompanyResearch(f.p,{input,token:review.token,requestId:randomUUID()});let calls=0;
  await runCompanyResearch(await grantTestLease(f.p,job.id),{collect:async()=>[page()],apify:{start:async ctx=>{calls++;return{kind:'inline',page:{receiptId:'fixture',candidates:[{name:lead.name,source:'WEB',sourceRef:'fixture',site:'https://clinica.example'}],exhausted:true,nextCursor:null,rawCount:1,rejected:[],usage:{provider:'apify',operationId:ctx.operationId,units:{apifyRuns:1},costUsd:null,costKind:'unknown'}}};},poll:async()=>{throw Error();},readPage:async()=>{throw Error();},abort:async()=>{throw Error();}}});
  const result=await readCompanyResearch(f.p,job.id);assert.equal(calls,1);assert.equal(result.state,'partial');assert.ok(result.facts.length);assert.ok(result.facts.every(f=>f.attribution==='uncertain'));
 }finally{if(oldActor===undefined)delete process.env.APIFY_WEB_ACTOR;else process.env.APIFY_WEB_ACTOR=oldActor;if(oldBuild===undefined)delete process.env.APIFY_WEB_BUILD;else process.env.APIFY_WEB_BUILD=oldBuild;}
});
async function uncertainAttempt(f:Awaited<ReturnType<typeof fixture>>,jobId:string,lease:Awaited<ReturnType<typeof grantTestLease>>){
 const step='website:'+f.leadId,id=hashValue({job:jobId,step});await withLeasedTransaction(lease,c=>c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,provider,step,state,payload) VALUES($1,$2,$3,'apify',$4,'uncertain',$5)",[f.p.workspaceId,jobId,id,step,{reservedUnits:{}}]));return id;
}
test('uncertain starts remain reconcilable during cancellation and unavailable results terminate without requeue',async()=>{
 const f=await fixture(),{job}=await start(f),lease=await grantTestLease(f.p,job.id),operationId=await uncertainAttempt(f,job.id,lease);
 await cancelJob(f.p,job.id);await runCompanyResearch(lease);assert.equal((await readCompanyResearch(f.p,job.id)).state,'needs_reconciliation');
 const reconciled=await reconcileJob(f.p,job.id,{operationId,resultUnavailable:true});assert.ok(['failed','partial'].includes(reconciled.state));
 assert.equal((await readCompanyResearch(f.p,job.id)).companies[0].state,'unavailable');
 assert.equal(await runWorkerOnce({research:{collect:async()=>{throw Error('Must not restart');}}},{signal:new AbortController().signal,workspaceId:f.p.workspaceId}),false);
});
test('publication and worker SQL writes revalidate execution entitlement after a received page',async()=>{
 const f=await fixture(),{job}=await start(f),lease=await grantTestLease(f.p,job.id);
 await runCompanyResearch(lease,{collect:async()=>{await testAdmin(c=>c.query("UPDATE app.billing_account SET period_end=clock_timestamp()-interval '1 second' WHERE workspace_id=$1",[f.p.workspaceId]));return[page()];}});
 assert.equal((await readCompanyResearch(f.p,job.id)).facts.length,0);
 assert.ok(await testAdmin(async c=>(await c.query("SELECT count(*)::int n FROM app.prospecting_attempt WHERE job_id=$1 AND state='completed'",[job.id])).rows[0].n)>0);
 const g=await fixture(),s=await start(g),l=await grantTestLease(g.p,s.job.id);await testAdmin(c=>c.query("UPDATE app.billing_account SET period_end=clock_timestamp()-interval '1 second' WHERE workspace_id=$1",[g.p.workspaceId]));
 await assert.rejects(withLeasedTransaction(l,async c=>{await c.query("SELECT set_config('app.research_token',$1,true),set_config('app.research_fence',$2,true)",[l.token,String(l.fence)]);return c.query("INSERT INTO app.research_source(workspace_id,job_id,id,lead_id,url,text,hash,fetched_at,source_kind,attribution) VALUES($1,$2,'forged',$3,'https://clinica.example','x','x',clock_timestamp(),'website','company')",[g.p.workspaceId,s.job.id,g.leadId]);}),{code:'BILLING_REQUIRED'});
});
test('sequential reviewed applications accept this case own site normalization but still reject later manual edits',async()=>{
 const f=await fixture(),s=await readWorkspaceSnapshot(f.p);await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...s.data.leads[0],site:'https://clinica.example/'}}});
 const {job}=await start(f);await runCompanyResearch(await grantTestLease(f.p,job.id),{collect:async()=>[page()]});let result=await readCompanyResearch(f.p,job.id);
 const apply=async(field:string)=>{const fact=result.facts.find(f=>f.field===field)!,input={caseId:job.id,factIds:[fact.id],expectedRevision:result.revision},review=await prepareResearchApplication(f.p,input);await confirmResearchApplication(f.p,{input,token:review.token,requestId:randomUUID()});result=await readCompanyResearch(f.p,job.id);};
 await apply('site');await apply('email');assert.equal((await readWorkspaceSnapshot(f.p)).data.leads[0].email,'contato@clinica.example');
 const snapshot=await readWorkspaceSnapshot(f.p);await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead:{...snapshot.data.leads[0],site:'https://manual.example'}}});
 await assert.rejects(apply('phone'),/mudaram/);
});
test('a known failed collection checkpoint is not retried or stranded as an unselectable uncertainty',async()=>{
 const f=await fixture(),{job}=await start(f),lease=await grantTestLease(f.p,job.id),step='research-page:'+f.leadId+':'+hashValue('https://clinica.example/'),operation=hashValue({job:job.id,step});
 await withLeasedTransaction(lease,c=>c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,provider,step,state,payload) VALUES($1,$2,$3,'public-web',$4,'failed',$5)",[f.p.workspaceId,job.id,operation,step,{reservedUnits:{}}]));let calls=0;
 await runCompanyResearch(lease,{collect:async()=>{calls++;return[page()];}});assert.equal(calls,0);assert.equal((await readCompanyResearch(f.p,job.id)).state,'partial');
});
