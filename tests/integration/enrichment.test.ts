import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,grantTestLease,closeProspectingPools,testAdmin} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {prepareJob,confirmJob,listJobItems,getJob,cancelJob} from '../../src/server/prospecting/service.ts';
import {reconcileJob} from '../../src/server/prospecting/reconciliation.ts';
import {ProviderError} from '../../src/server/prospecting/providers/transport.ts';
import {runWorkerOnce} from '../../src/server/prospecting/worker.ts';
import {readContactEnrichment} from '../../src/server/prospecting/contact-enrichment.ts';
import {readContacts} from '../../src/server/contacts/repository.ts';
import {applyJobResults} from '../../src/server/prospecting/application.ts';
import {runEnrichment} from '../../src/server/prospecting/enrichment.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {conventionalConfig} from '../../src/server/prospecting/ai/config.ts';
configureProspectingTest();Object.assign(process.env,{APIFY_CNPJ_ACTOR:'bigdavidson/brazil-cnpj-companies',APIFY_CNPJ_BUILD:'fixture-build',APIFY_WEB_ACTOR:'apify/google-search-scraper',APIFY_WEB_BUILD:'fixture-build',OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({apifyRuns:100,openaiCalls:100,candidates:1000}),PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({apifyRuns:1000,openaiCalls:1000,candidates:100000})});
beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});
const text='Empresa Exemplo: Ana Silva, diretora comercial. Contato pessoal de Ana Silva: ana.silva@example.com, celular (21) 98888-7777.';
const evidence={id:'public-e',url:'https://empresa.example/equipe',text,hash:'e',fetchedAt:'2026-10-26T21:00:00Z',truncated:false};
const usage=(operationId='fixture')=>({provider:'openai',operationId,units:{openaiCalls:1},costUsd:null,costKind:'unknown' as const});
const adapters=(useful:boolean)=>({
 collect:async()=>[evidence],
 apify:{start:async(ctx:any)=>({kind:'inline' as const,page:{receiptId:'lookup',candidates:[{name:'Empresa Exemplo',source:'CNPJ' as const,sourceRef:'12345678000190',cnpj:'12345678000190',site:'https://empresa.example',facts:{decisionMakers:[{name:'Ana Silva',role:'diretora comercial'}]},evidence:[evidence]}],nextCursor:null,exhausted:true,rawCount:1,rejected:[],usage:{provider:'apify',operationId:ctx.operationId,units:{apifyRuns:1},costUsd:null,costKind:'unknown' as const}}}),poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}},
 decisors:async(_ctx:any,input:any)=>({value:{people:useful?[{name:'Ana Silva',role:'diretora comercial',email:'ana.silva@example.com',phone:'21988887777',evidenceId:input.evidence.find((e:any)=>e.text===text).id,quote:text}]:[]},usage:usage()})
});
async function fixture(){
 const {p}=await prospectingUser(),listId=randomUUID(),leadId=randomUUID();await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:0,command:{type:'leads.import',list:{id:listId,name:'[RE] Enriquecer'},leads:[{id:leadId,listId,name:'Empresa Exemplo',cnpj:'12345678000190',site:'https://empresa.example',email:'contato@empresa.example',phone:'+5521999999999',source:'MANUAL',qualification:'qualified',createdAt:new Date().toISOString()}]}});
 await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});
 const input={kind:'qualification',listId,leadIds:[leadId],modules:['decisors'],summaryPolicy:'all',escalation:'off',enrichment:{maxCredits:1,destinationName:'[RE] Decisores'}};
 const review=await prepareJob(p,input);assert.deepEqual(review.blockers,[]);return{p,input,review,leadId};
}
const consumed=async(p:any,unit:string)=>withWorkspaceTransaction(p,async c=>Number((await c.query('SELECT COALESCE(sum(quantity),0) AS n FROM app.billing_consumption WHERE unit=$1',[unit])).rows[0].n));
async function run(f:Awaited<ReturnType<typeof fixture>>,useful:boolean){const job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token});for(let i=0;i<8;i++){if(['completed','partial','failed','needs_reconciliation'].includes((await getJob(f.p,job.id)).state))break;await runEnrichment(await grantTestLease(f.p,job.id),adapters(useful));}return job;}
test('enrichment preview has no side effects and empty evidence consumes zero commercial credit',async()=>{
 const f=await fixture(),before=await readWorkspaceSnapshot(f.p);assert.equal(before.data.lists.length,1);assert.equal(await consumed(f.p,'enrichment'),0);
 const job=await run(f,false);assert.equal((await getJob(f.p,job.id)).state,'completed');assert.equal(await consumed(f.p,'enrichment'),0);assert.equal((await readWorkspaceSnapshot(f.p)).data.lists.length,1);
 assert.equal((await listJobItems(f.p,job.id)).items[0].enrichment?.people.length,0);
});
test('useful enrichment consumes one credit; reviewed delivery is idempotent and cached retry costs no new call',async()=>{
 const f=await fixture(),imports=await consumed(f.p,'imports'),job=await run(f,true);assert.equal((await getJob(f.p,job.id)).state,'completed');assert.equal(await consumed(f.p,'enrichment'),1);
 const items=(await listJobItems(f.p,job.id)).items;assert.equal(items[0].enrichment?.people[0].whatsapp,'unverified');
 const body={requestId:randomUUID(),itemIds:items.map(i=>i.id)},applied=await applyJobResults(f.p,job.id,body);assert.equal(applied.applied,1);assert.deepEqual(await applyJobResults(f.p,job.id,body),applied);
 const snapshot=await readWorkspaceSnapshot(f.p);assert.equal(snapshot.data.lists.length,2);assert.equal(snapshot.data.leads.length,2);assert.equal(snapshot.data.leads.find(l=>l.id!==f.leadId)?.phone,'+5521988887777');assert.equal(await consumed(f.p,'imports'),imports);
 const review=await prepareJob(f.p,f.input),second=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:review.token});
 await runEnrichment(await grantTestLease(f.p,second.id),{apify:{...adapters(true).apify,start:async()=>{throw Error('Cache cannot call provider');}},collect:async()=>{throw Error('Cache cannot fetch');},decisors:async()=>{throw Error('Cache cannot call model');}});await runEnrichment(await grantTestLease(f.p,second.id));assert.equal((await getJob(f.p,second.id)).state,'completed');assert.equal(await consumed(f.p,'enrichment'),1);
 const foreign=await prospectingUser();await assert.rejects(applyJobResults(foreign.p,job.id,{requestId:randomUUID(),itemIds:body.itemIds}),/encontrad|indisponível/i);
});
test('cached enrichment remains free when provider daily unit limits are exhausted',async()=>{
 const f=await fixture();await run(f,true);const oldWorkspace=process.env.PROSPECTING_WORKSPACE_DAILY_UNITS,oldGlobal=process.env.PROSPECTING_GLOBAL_DAILY_UNITS;
 try{
  process.env.PROSPECTING_WORKSPACE_DAILY_UNITS='{}';process.env.PROSPECTING_GLOBAL_DAILY_UNITS='{}';
  const review=await prepareJob(f.p,f.input);assert.equal(review.enrichmentPreview?.maxCredits,0);assert.deepEqual(review.blockers,[]);
  const job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:review.token});await runEnrichment(await grantTestLease(f.p,job.id));await runEnrichment(await grantTestLease(f.p,job.id));assert.equal((await getJob(f.p,job.id)).state,'completed');assert.equal(await consumed(f.p,'enrichment'),1);
 }finally{process.env.PROSPECTING_WORKSPACE_DAILY_UNITS=oldWorkspace;process.env.PROSPECTING_GLOBAL_DAILY_UNITS=oldGlobal;}
});
test('QSA name and company feed the public LinkedIn fallback when the company site has no personal contact',async()=>{
 const f=await fixture(),job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token}),base=adapters(true),urls:string[]=[],queries:string[]=[];
 const linkedin='https://www.linkedin.com/in/ana-exemplo/';
 const deps={...base,apify:{...base.apify,start:async(ctx:any,input:any)=>{queries.push(input.filters.term);const reply=await base.apify.start(ctx);if(ctx.profile.source==='WEB')reply.page.candidates=[{...reply.page.candidates[0],site:'https://www.linkedin.com/',evidence:[{...evidence,id:'profile-snippet',url:linkedin,text:'Empresa Exemplo: Ana Silva — diretora comercial',hash:'snippet'}]}];else reply.page.candidates[0].evidence=[{...evidence,text:'Empresa Exemplo — sócia Ana Silva, diretora comercial',hash:'qsa'}];return reply;}},collect:async(url:string)=>{urls.push(url);return url===linkedin?[evidence]:[];}};
 for(let i=0;i<3;i++){if(['completed','partial','failed','needs_reconciliation'].includes((await getJob(f.p,job.id)).state))break;await runEnrichment(await grantTestLease(f.p,job.id),deps);}
 assert.equal((await getJob(f.p,job.id)).state,'completed');assert.ok(queries.some(q=>q.includes('Ana Silva')&&q.includes('Empresa Exemplo')&&q.includes('site:linkedin.com/in/')));assert.ok(urls.includes(linkedin));assert.equal((await listJobItems(f.p,job.id)).items[0].enrichment?.people.length,1);
});
test('hybrid enrichment assesses evidence with JEV and extracts with the selected traditional model; traditional mode never calls JEV',async()=>{
 const f=await fixture(),seed=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token});
 process.env.OPENROUTER_API_KEY='fixture';process.env.JEV_MODEL='typesafe/jev-1.13';
 const oldW=process.env.PROSPECTING_WORKSPACE_DAILY_UNITS!,oldG=process.env.PROSPECTING_GLOBAL_DAILY_UNITS!;
 process.env.PROSPECTING_WORKSPACE_DAILY_UNITS=JSON.stringify({...JSON.parse(oldW),jevCalls:100});process.env.PROSPECTING_GLOBAL_DAILY_UNITS=JSON.stringify({...JSON.parse(oldG),jevCalls:1000});
 try{
  await saveAiPolicy(f.p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'hybrid-required',conventionalProvider:'openai',jevEnabled:true}});
  const route=conventionalConfig(f.p.workspaceId).conventional.openai.route;
  await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,'hybrid-enrichment',$3,$4,$5,$6,'success')",[f.p.workspaceId,seed.id,route.provider,route.model,route.configFingerprint,route.contractVersion]));
  const review=await prepareJob(f.p,f.input);assert.deepEqual(review.blockers,[]);assert.equal(review.usage.find(u=>u.unit==='jevCalls')?.maxUnits,1);
  const job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:review.token});let decisions=0,extracts=0;
  const base=adapters(true),deps={...base,decisors:async(c:any,i:any)=>{extracts++;return base.decisors(c,i);},decide:async(c:any,i:any)=>{decisions++;assert.equal(i.intent,'contact-evidence');return{model:'typesafe/jev-1.13',verdict:'insufficient_evidence' as const,confidence:null,probabilities:{},criteria:{},evidenceIds:i.evidence.map((e:any)=>e.id),usage:{provider:'openrouter',operationId:c.operationId,units:{jevCalls:1},costUsd:null,costKind:'unknown' as const}};}};
  await runEnrichment(await grantTestLease(f.p,job.id),deps);await runEnrichment(await grantTestLease(f.p,job.id),deps);
  assert.equal(decisions,1);assert.equal(extracts,1);const item=(await listJobItems(f.p,job.id)).items[0];assert.equal(item.enrichment?.assessment?.verdict,'insufficient_evidence');assert.equal(item.enrichment?.people.length,1);assert.equal(item.enrichment?.people[0].whatsapp,'unverified');
  const conventional=await fixture(),j=await confirmJob(conventional.p,{requestId:randomUUID(),input:conventional.input,reviewToken:conventional.review.token});
  await runEnrichment(await grantTestLease(conventional.p,j.id),{...base,decide:async()=>{throw Error('Traditional mode must not call JEV');}});assert.equal((await listJobItems(conventional.p,j.id)).items[0].enrichment?.people.length,1);
 }finally{process.env.PROSPECTING_WORKSPACE_DAILY_UNITS=oldW;process.env.PROSPECTING_GLOBAL_DAILY_UNITS=oldG;}
});
test('uncertain traditional enrichment is reconciled as unavailable without repeating the inference or consuming commercial credit',async()=>{
 const f=await fixture(),job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token});let calls=0;
 await runEnrichment(await grantTestLease(f.p,job.id),{...adapters(true),decisors:async()=>{calls++;throw new ProviderError('LOST_RESPONSE',0,true);}});
 assert.equal((await getJob(f.p,job.id)).state,'needs_reconciliation');const result=await reconcileJob(f.p,job.id,{resultUnavailable:true});assert.equal(result.state,'failed');assert.equal(calls,1);assert.equal(await consumed(f.p,'enrichment'),0);
});
test('cancelled enrichment journals remote abort and polls confirmation without posting abort twice',async()=>{
 const f=await fixture(),job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token});let starts=0,aborts=0,terminal=false;
 const deps={...adapters(false),apify:{...adapters(false).apify,start:async(ctx:any)=>{starts++;return{kind:'remote' as const,run:{provider:'apify' as const,runId:'run-lookup',datasetId:'ds',profileId:ctx.profile.actor,build:ctx.profile.build,operationId:ctx.operationId}};},poll:async(_c:any,run:any)=>({run,status:terminal?'cancelled' as const:'running' as const}),abort:async(_c:any,run:any)=>{aborts++;return{run,status:'cancelling' as const};}}};
 await runEnrichment(await grantTestLease(f.p,job.id),deps);await cancelJob(f.p,job.id);
 const cancelledLease=async()=>{const lease=await grantTestLease(f.p,job.id);await testAdmin(c=>c.query("UPDATE app.prospecting_job SET state='cancelling' WHERE workspace_id=$1 AND id=$2",[f.p.workspaceId,job.id]));return lease;};
 await runEnrichment(await cancelledLease(),deps);assert.equal((await getJob(f.p,job.id)).state,'cancelling');terminal=true;await runEnrichment(await cancelledLease(),deps);assert.equal((await getJob(f.p,job.id)).state,'cancelled');assert.equal(starts,1);assert.equal(aborts,1);assert.equal(await consumed(f.p,'enrichment'),0);
});
test('a promised cache expiring after confirmation never starts a newly paid lookup',async()=>{
 const f=await fixture();await run(f,true);const review=await prepareJob(f.p,f.input),job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:review.token});
 await testAdmin(c=>c.query("UPDATE app.enrichment_resolution SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1",[f.p.workspaceId]));
 await runEnrichment(await grantTestLease(f.p,job.id),{...adapters(true),collect:async()=>{throw Error('No newly paid fetch');},decisors:async()=>{throw Error('No newly paid model');},apify:{...adapters(true).apify,start:async()=>{throw Error('No newly paid actor');}}});
 assert.equal((await listJobItems(f.p,job.id)).items[0].status,'skipped');assert.equal(await consumed(f.p,'enrichment'),1);
});
test('delivery proofs cannot be forged and source edits reject application atomically',async()=>{
 const f=await fixture(),job=await run(f,true),items=(await listJobItems(f.p,job.id)).items;
 await assert.rejects(withWorkspaceTransaction(f.p,c=>c.query('DELETE FROM app.enrichment_resolution WHERE job_id=$1',[job.id])),/permission denied/);
 await assert.rejects(withWorkspaceTransaction(f.p,c=>c.query('INSERT INTO app.enrichment_delivery(workspace_id,job_id,cache_id,person_key,lead_id,list_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',[f.p.workspaceId,job.id,items[0].enrichment!.cacheId,'fake',randomUUID(),f.input.listId,{}])),/permission denied/);
 const before=await readWorkspaceSnapshot(f.p),source=before.data.leads.find(l=>l.id===f.leadId)!;
 await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:before.revision,command:{type:'lead.upsert',lead:{...source,name:'Changed company'}}});
 await assert.rejects(applyJobResults(f.p,job.id,{requestId:randomUUID(),itemIds:items.map(i=>i.id)}),/ENRICHMENT_SOURCE_CHANGED/);assert.equal((await readWorkspaceSnapshot(f.p)).data.lists.length,1);
});
test('actual concurrent workers serialize same-workspace enrichment and reuse the paid resolution',async()=>{
 process.env.PROSPECTING_GLOBAL_CONCURRENCY='32';
 const f=await fixture();for(let i=0;i<2;i++){const review=await prepareJob(f.p,f.input);await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:review.token});}
 let models=0;const base=adapters(true),deps={...base,decisors:async(c:any,i:any)=>{models++;return base.decisors(c,i);}},options={workspaceId:f.p.workspaceId,signal:new AbortController().signal};
 for(let i=0;i<5;i++)await Promise.all([runWorkerOnce(deps,options),runWorkerOnce(deps,options)]);
 assert.equal(models,1);assert.equal(await consumed(f.p,'enrichment'),1);
});
test('contact enrichment uses protected provenance, not editable custom labels, and edited contact values lose the matching claim',async()=>{
 const f=await fixture(),job=await run(f,true),items=(await listJobItems(f.p,job.id)).items;
 await applyJobResults(f.p,job.id,{requestId:randomUUID(),itemIds:[items[0].id]});
 const snapshot=await readWorkspaceSnapshot(f.p),person=snapshot.data.leads.find(l=>l.id!==f.leadId)!;
 assert.equal((await readContactEnrichment(f.p,person.id))?.people[0].name,'Ana Silva');assert.equal((await readContacts(f.p,{page:1,pageSize:20,enriched:'yes'})).total,2);
 await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead:{...person,email:'invented@example.com',customFields:{'Fonte do contato':'fake'}}}});
 assert.equal(await readContactEnrichment(f.p,person.id),null);assert.equal((await readContacts(f.p,{page:1,pageSize:20,enriched:'yes'})).total,1);
});
test('malformed model output records the received technical consumption without caching or charging a commercial resolution',async()=>{
 const f=await fixture(),job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token});
 await runEnrichment(await grantTestLease(f.p,job.id),{...adapters(false),decisors:async()=>({value:{wrong:'shape'},usage:usage()})});const result=await getJob(f.p,job.id);assert.equal(result.state,'failed');assert.equal(result.usage?.reduce((n,u)=>n+(u.units.openaiCalls??0),0),1);assert.equal(await consumed(f.p,'enrichment'),0);
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*)::int AS n FROM app.enrichment_resolution WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].n),0);
});
test('revocation during the model call preserves the bounded receipt but publishes no resolution or person',async()=>{
 const f=await fixture(),job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token}),base=adapters(true);
 await assert.rejects(runEnrichment(await grantTestLease(f.p,job.id),{...base,decisors:async(c:any,i:any)=>{const result=await base.decisors(c,i);await testAdmin(db=>db.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));return result;}}));
 const facts=await testAdmin(async c=>(await c.query("SELECT (SELECT count(*) FROM app.enrichment_resolution WHERE workspace_id=$1)::int AS resolutions,(SELECT count(*) FROM app.prospecting_attempt WHERE job_id=$2 AND payload->>'receivedWithoutMembership'='true')::int AS receipts",[f.p.workspaceId,job.id])).rows[0]);assert.deepEqual(facts,{resolutions:0,receipts:1});
});
test('changing AI configuration during the last call preserves consumption but cannot publish or commercially charge the stale resolution',async()=>{
 const f=await fixture(),job=await confirmJob(f.p,{requestId:randomUUID(),input:f.input,reviewToken:f.review.token}),base=adapters(true);
 await runEnrichment(await grantTestLease(f.p,job.id),{...base,decisors:async(c:any,i:any)=>{const result=await base.decisors(c,i);await saveAiPolicy(f.p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'conventional-only',conventionalProvider:'gemini',jevEnabled:false}});return result;}});
 assert.equal(await consumed(f.p,'enrichment'),0);assert.equal((await listJobItems(f.p,job.id)).items.length,0);assert.equal((await getJob(f.p,job.id)).usage?.reduce((n,u)=>n+(u.units.openaiCalls??0),0),1);
});
test('unavailable later inference keeps a useful paid company result applicable',async()=>{
 const f=await fixture(),s=await readWorkspaceSnapshot(f.p),other=randomUUID();await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...s.data.leads[0],id:other,cnpj:'12345678000271',name:'Empresa Exemplo B'}}});
 const input={...f.input,leadIds:[f.leadId,other],enrichment:{...f.input.enrichment,maxCredits:2}},review=await prepareJob(f.p,input),job=await confirmJob(f.p,{requestId:randomUUID(),input,reviewToken:review.token}),base=adapters(true);let calls=0;
 const deps={...base,apify:{...base.apify,start:async(c:any,i:any)=>{const result=await base.apify.start(c);if(c.profile.source==='CNPJ')result.page.candidates[0].cnpj=i.filters.cnpj;return result;}},decisors:async(c:any,i:any)=>{calls++;if(calls===2)throw new ProviderError('LOST_RESPONSE',0,true);return base.decisors(c,i);}};
 await runEnrichment(await grantTestLease(f.p,job.id),deps);await runEnrichment(await grantTestLease(f.p,job.id),deps);const reconciled=await reconcileJob(f.p,job.id,{resultUnavailable:true});assert.equal(reconciled.state,'partial');
 const item=(await listJobItems(f.p,job.id)).items[0];assert.equal((await applyJobResults(f.p,job.id,{requestId:randomUUID(),itemIds:[item.id]})).applied,1);assert.equal(await consumed(f.p,'enrichment'),1);
});
