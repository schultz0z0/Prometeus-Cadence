import {ApifySiteCrawler} from '../../src/server/prospecting/providers/site-crawler.ts';
import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,closeProspectingPools,testAdmin} from './prospecting-helpers.ts';
import {withWorkspaceTransaction,withContextTransaction} from '../../src/server/db/transaction.ts';
import {finishJob} from '../../src/server/prospecting/journal.ts';
import {prospectingRequest} from '../../src/server/prospecting/http.ts';
import {ProviderError} from '../../src/server/prospecting/providers/transport.ts';
import {createReviewToken} from '../../src/server/prospecting/review.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {prepareJourney,confirmJourney,getJourney,cancelJourney,prepareJourneyResume,resumeJourney,advanceJourney,prepareJourneyCadence,confirmJourneyCadence} from '../../src/server/research/journey.ts';
import {runWorkerOnce} from '../../src/server/prospecting/worker.ts';
import {getJob} from '../../src/server/prospecting/service.ts';
import {reconcileJob} from '../../src/server/prospecting/reconciliation.ts';
import {ApifyAdapter} from '../../src/server/prospecting/providers/apify.ts';
import {readExtractionDay} from '../../src/server/billing/extraction-day.ts';
import {preparePlanningSelection,confirmPlanningSelection} from '../../src/server/planning/confirmation.ts';
import {withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {grantTestLease} from './prospecting-helpers.ts';
import {runCompanyResearch} from '../../src/server/research/company.ts';
import {journeyRequest} from '../../src/server/research/journey-http.ts';
import {base,resetRateLimits} from './helpers.ts';
import type {JourneyInput} from '../../src/domain/prospecting-journey.ts';
configureProspectingTest();Object.assign(process.env,{APIFY_CNPJ_ACTOR:'bigdavidson/brazil-cnpj-companies',APIFY_CNPJ_BUILD:'fixture-build',APIFY_WEB_ACTOR:'apify/google-search-scraper',APIFY_WEB_BUILD:'fixture-build',PROSPECTING_GLOBAL_CONCURRENCY:'32',OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:JSON.stringify({candidates:1000,apifyRuns:2000,openaiCalls:2000}),PROSPECTING_GLOBAL_DAILY_UNITS:JSON.stringify({candidates:100000,apifyRuns:100000,openaiCalls:100000})});
after(async()=>{await workerPool().end();await closeProspectingPools();});
beforeEach(resetRateLimits);
async function fixture(n=2){
 const f=await prospectingUser({platformAi:true});await saveAiPolicy(f.p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});
 await testAdmin(c=>c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)',[f.p.workspaceId,{version:1,approvedAt:new Date().toISOString(),offer:'Gestão para clínicas',idealCustomer:'Clínicas no Rio'}]));
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET quantity=1000 WHERE workspace_id=$1 AND unit='enrichment'",[f.p.workspaceId]));
 const input:JourneyInput={brief:'Clínicas odontológicas',location:'Rio de Janeiro',limit:n};return{...f,input};
}
async function start(f:Awaited<ReturnType<typeof fixture>>){const review=await prepareJourney(f.p,f.input);assert.deepEqual(review.blockers,[]);const body={input:f.input,token:review.token,requestId:randomUUID()};return{body,journey:await confirmJourney(f.p,body)};}
async function done(f:Awaited<ReturnType<typeof fixture>>,journey:any,name:string,state='completed',n=2){
 const s=journey.stages.filter((s:any)=>s.name===name).at(-1);assert.ok(s?.jobId,name);
 if(name==='discover'){const snap=await readWorkspaceSnapshot(f.p);await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snap.revision,command:{type:'leads.import',leads:Array.from({length:n},(_,i)=>({id:randomUUID(),listId:journey.listId,name:'Clínica '+i,site:'https://clinica'+i+'.example',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()}))}});}
 await testAdmin(async c=>{await c.query("SELECT set_config('app.workspace_id',$1,false),set_config('app.user_id',$2,false)",[f.p.workspaceId,f.p.userId]);if(name==='discover'){const leads=(await c.query('SELECT id,payload FROM app.lead WHERE workspace_id=$1 AND list_id=$2',[f.p.workspaceId,journey.listId])).rows;for(const l of leads)await c.query("INSERT INTO app.prospecting_item(workspace_id,id,job_id,lead_id,name,status,payload) VALUES($1,$2,$3,$4,$5,'inserted','{}')",[f.p.workspaceId,randomUUID(),s.jobId,l.id,l.payload.name]);}
 if(state==='completed'&&['research','people'].includes(name))await c.query("UPDATE app.research_case SET state='completed',missing='[]' WHERE job_id=$1",[s.jobId]);
 if(state==='completed'&&name==='qualify'){const job=(await c.query('SELECT input FROM app.prospecting_job WHERE id=$1',[s.jobId])).rows[0];for(const leadId of job.input.leadIds)await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status,payload) VALUES($1,$2,$3,$4,'Fixture','pending_review',$5)",[f.p.workspaceId,s.jobId,randomUUID(),leadId,{results:job.input.modules.map((module:string)=>({module,status:'pending_review',proposed:{},reasons:[]}))}]);}
 await c.query('UPDATE app.prospecting_job SET state=$2,lease_until=clock_timestamp()-interval \'1 second\' WHERE id=$1',[s.jobId,state]);});
 const row=(await workerPool().query('SELECT * FROM app.claim_journey_advance($1)',[f.p.workspaceId])).rows[0];assert.ok(row,'durable advance ticket');
 return advanceJourney({workspaceId:row.workspace_id,jobId:row.job_id,actorId:row.actor_id,token:row.token,fence:Number(row.fence),expiresAt:row.expires_at.toISOString()});
}
test('one reviewed request creates one journey, one list, one queued discovery and no cadence or publication',async()=>{
 const f=await fixture(),r=await prepareJourney(f.p,f.input);assert.equal((await readWorkspaceSnapshot(f.p)).data.lists.length,0);
 const previousToken=createReviewToken({action:'journey.create',userId:f.p.userId,workspaceId:f.p.workspaceId,input:f.input,basisHash:r.basisHash,revision:0,id:null},process.env.BETTER_AUTH_SECRET!);
 await assert.rejects(confirmJourney(f.p,{input:f.input,token:previousToken,requestId:randomUUID()}),(error:any)=>error.status===409);
 const body={input:f.input,token:r.token,requestId:randomUUID()},[a,b]=await Promise.all([confirmJourney(f.p,body),confirmJourney(f.p,body)]);assert.equal(a.id,b.id);assert.equal(a.stages.length,1);
 assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.prospecting_job WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].n)),1);
 const snap=await readWorkspaceSnapshot(f.p);assert.equal(snap.data.lists.length,1);assert.equal(snap.data.cadences.length,0);
 await assert.rejects(confirmJourney(f.p,{...body,input:{...f.input,limit:3}}),(e:any)=>e.status===409);
});
test('technical capacity waits and resumes the same discovery without another confirmation',async()=>{
 const f=await fixture();
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='essential' WHERE workspace_id=$1",[f.p.workspaceId]);
  await c.query("UPDATE app.billing_grant SET source='plan',quantity=5000 WHERE workspace_id=$1 AND unit='extractions'",[f.p.workspaceId]);
  await c.query('INSERT INTO app.prospecting_policy(workspace_id,limits) VALUES($1,$2)',[f.p.workspaceId,{candidates:100,apifyRuns:1,openaiCalls:100}]);
 });
 assert.equal((await prepareJourney(f.p,f.input)).extractionRemaining,250);
 const {journey,body}=await start(f),jobId=journey.stages[0].jobId;
 assert.ok(jobId);
 assert.equal((await confirmJourney(f.p,body)).stages[0].jobId,jobId);
 let starts=0;
 const apify={start:async()=>{
  const receiptId=`capacity-page-${++starts}`;
  return {kind:'inline' as const,page:{receiptId,candidates:[],rejected:[],rawCount:0,nextCursor:null,exhausted:true,usage:{provider:'apify',operationId:receiptId,units:{candidates:0},costUsd:null,costKind:'unknown' as const}}};
 },poll:async()=>{throw Error('Unexpected poll');},readPage:async()=>{throw Error('Unexpected dataset');},abort:async()=>{throw Error('Unexpected abort');}};
 const tick=()=>runWorkerOnce({apify},{workspaceId:f.p.workspaceId,signal:new AbortController().signal});
 assert.equal(await tick(),true);
 assert.equal(await tick(),true);
 assert.equal(starts,1);
 const waiting=await getJourney(f.p,journey.id);
 assert.equal(waiting.state,'running');
 assert.equal(waiting.reason,'WAITING_CAPACITY');
 assert.equal((await getJob(f.p,jobId)).error?.code,'WAITING_CAPACITY');
 assert.equal(await tick(),false,'waiting work must yield the worker');
 const overLimit=await prepareJourney(f.p,{...f.input,limit:249});
 assert.equal(overLimit.extractionRemaining,248);
 assert.equal(overLimit.blockers.length,1);
 await assert.rejects(confirmJourney(f.p,{input:overLimit.input,token:overLimit.token,requestId:randomUUID()}),/248 disponíveis hoje/);
 await testAdmin(async c=>{
  await c.query("UPDATE app.usage_ledger SET created_at=created_at-interval '1 day' WHERE job_id=$1 AND event='consume'",[jobId]);
  await c.query('UPDATE app.prospecting_job SET capacity_retry_at=clock_timestamp() WHERE id=$1',[jobId]);
 });
 assert.equal(await tick(),true);
 assert.equal(starts,2,'first paid call must not be repeated');
 assert.equal((await getJob(f.p,jobId)).state,'partial');
 assert.equal((await getJourney(f.p,journey.id)).state,'review');
 assert.equal((await withWorkspaceTransaction(f.p,readExtractionDay))?.plan,0,'release unused commercial balance');
});
test('discovery reads a page that fits the technical capacity of one day',async()=>{
 const f=await fixture(5);
 await testAdmin(c=>c.query('INSERT INTO app.prospecting_policy(workspace_id,limits) VALUES($1,$2)',[f.p.workspaceId,{candidates:2,apifyRuns:10,openaiCalls:100}]));
 const {journey}=await start(f),jobId=journey.stages[0].jobId;
 assert.ok(jobId);
 const run={provider:'apify' as const,runId:'capacity-run',datasetId:'capacity-dataset',profileId:'fixture',build:'fixture-build',operationId:'capacity-run',status:'succeeded' as const};
 const sizes:number[]=[];
 const apify={start:async()=>({kind:'remote' as const,run}),poll:async()=>({run,status:'succeeded' as const}),readPage:async(_ctx:any,_run:any,_cursor:any,limit=100)=>{
  sizes.push(limit);
  return {receiptId:'bounded-capacity-page',candidates:[],rejected:Array.from({length:limit},()=>({reason:'MISSING_IDENTITY'})),rawCount:limit,nextCursor:null,exhausted:true,usage:{provider:'apify',operationId:'bounded-capacity-page',units:{candidates:limit},costUsd:null,costKind:'unknown' as const}};
 },abort:async()=>{throw Error('Unexpected abort');}};
 await runWorkerOnce({apify},{workspaceId:f.p.workspaceId,signal:new AbortController().signal});
 assert.deepEqual(sizes,[2]);
 assert.equal((await getJob(f.p,jobId)).counts.rejected,2);
});
test('registry-first HTTP journey replaces a homonym and resumes website collection in the same execution',async t=>{
 const f=await fixture(1),calls:string[]=[];
 const before=process.env.SITE_BROWSER_TOKEN;
 process.env.SITE_BROWSER_TOKEN='fixture-only-site-browser-token-00001';
 t.after(()=>{if(before===undefined)delete process.env.SITE_BROWSER_TOKEN;else process.env.SITE_BROWSER_TOKEN=before;});
 const input:JourneyInput={...f.input,location:'Curitiba, PR',registry:{cnae:'2512800',city:'Curitiba',uf:'PR'}};
 const call=(body:unknown)=>journeyRequest(new Request(base+'/api/prospecting/journeys',{method:'POST',headers:f.headers,body:JSON.stringify(body)}));
 const review=await (await call({action:'prepare',input})).json();
 assert.deepEqual(review.blockers,[]);
 assert.equal(review.input.location,'Curitiba, PR');
 const body={action:'confirm',input,token:review.token,requestId:randomUUID()};
 const journey=await (await call(body)).json();
 const id=journey.stages[0].jobId;
 assert.equal((await (await call(body)).json()).stages[0].jobId,id);
 const record={name:'[RE] Esquadrias Exemplo',city:'Curitiba',phone:'+5541999991234',address:'Rua Exemplo, 10',cnpj:'37297479000180',cnae:'2512800'};
 const rejected={...record,name:'[RE] Homônimo',cnpj:'11222333000181',source:'CNPJ' as const,sourceRef:'first',state:'PR',facts:{registrationStatus:'ATIVA'}};
 const accepted={...record,source:'CNPJ' as const,sourceRef:'second',state:'PR',facts:{registrationStatus:'ATIVA'}};
 const run={provider:'apify' as const,runId:'registry-run',datasetId:'registry-dataset',profileId:'bigdavidson/brazil-cnpj-companies',build:'fixture-build',operationId:'registry-run'};
 function page(candidates:import('../../src/domain/prospecting.ts').Candidate[],receiptId:string,nextCursor:string|null=null){
  return {receiptId,candidates,rejected:[],rawCount:candidates.length,nextCursor,exhausted:nextCursor===null,usage:{provider:'apify',operationId:receiptId,units:{candidates:candidates.length},costUsd:null,costKind:'unknown' as const}};
 }
 const apify={start:async(ctx:any,request:any)=>{
  calls.push(ctx.profile.source+':'+request.filters.term);
  if(ctx.profile.source==='CNPJ'){
   assert.equal(ctx.profile.registryFirst,true);
   assert.deepEqual(request.filters,{term:f.input.brief,cnae:'2512800',state:'PR',city:'Curitiba'});
   return {kind:'remote' as const,run};
  }
  const lead={...record,cnpj:undefined,source:'MAPS' as const,state:'Paraná',sourceRef:ctx.operationId};
  if(ctx.profile.source==='MAPS')return {kind:'inline' as const,page:page(request.filters.term===rejected.name?[{...lead,name:rejected.name,address:'Rua Exemplo, 99'}]:[{...lead,site:'https://google.com/'}],ctx.operationId)};
  return {kind:'inline' as const,page:page([
   {...lead,source:'WEB',site:'https://google.com/'},
   {...lead,source:'WEB',site:'https://company.example.com/'},
  ],ctx.operationId)};
 },poll:async()=>({status:'succeeded' as const,run}),readPage:async(_ctx:any,_run:any,cursor:string|null)=>{
  calls.push('dataset:'+(cursor??'0'));
  return cursor?page([accepted],'registry-page-2'):page([rejected],'registry-page-1','1');
 },abort:async()=>{throw Error('Unexpected abort');}};
 let contactReads=0;
 let browserAvailable=false;
 const playwrightModule=process.env.QA_PLAYWRIGHT_MODULE;
 const chrome=playwrightModule?await (await import(playwrightModule)).chromium.launch({headless:true,executablePath:process.env.QA_CHROME_PATH}):null;
 if(chrome)t.after(()=>chrome.close());
 const siteBrowser={available:async()=>browserAvailable,async read(kind:string,url:string){
  const path=new URL(url).pathname;
  assert.equal(new URL(url).hostname,'company.example.com');
  calls.push(kind+':'+path);
  if(kind==='robots'||kind==='sitemap')return {status:404,text:''};
  if(path!=='/'&&contactReads++===0)return {status:504,text:''};
  if(chrome){
   const page=await chrome.newPage();
   try{
    await page.route('**/*',(route:any)=>route.request().url()===url?route.fulfill({contentType:'text/html',body:path==='/'?
     '<main></main><script>document.querySelector("main").innerHTML="[RE] Esquadrias Exemplo <a href=/contato>Contato</a>"</script>':
     '<main></main><script>document.querySelector("main").textContent="[RE] Esquadrias Exemplo +55 41 99999-1234"</script>'}):route.abort());
    const response=await page.goto(url);
    const text=await page.locator('main').innerText();
    const links=await page.locator('a[href]').evaluateAll((anchors:HTMLAnchorElement[])=>anchors.map(a=>a.href));
    return {status:response?.status()??0,text,links,finalUrl:page.url()};
   }finally{await page.close();}
  }
  if(path==='/')return {status:200,text:'[RE] Esquadrias Exemplo',links:['/contato']};
  return {status:200,text:'[RE] Esquadrias Exemplo +55 41 99999-1234'};
 }};
 await runWorkerOnce({apify,siteBrowser},{signal:AbortSignal.timeout(5000),workspaceId:f.p.workspaceId});
 assert.deepEqual(calls,[],'an unavailable browser must not start a paid Actor');
 assert.equal((await getJob(f.p,id)).error?.code,'WAITING_SITE_BROWSER');
 browserAvailable=true;
 await testAdmin(c=>c.query('UPDATE app.prospecting_job SET capacity_retry_at=clock_timestamp() WHERE id=$1',[id]));
 for(let i=0;i<15;i++){
  await runWorkerOnce({apify,siteBrowser},{signal:AbortSignal.timeout(5000),workspaceId:f.p.workspaceId});
  if((await getJob(f.p,id)).state==='completed')break;
  await testAdmin(c=>c.query("UPDATE app.prospecting_site_page SET retry_at=clock_timestamp() WHERE job_id=$1 AND reason='HTTP_504' AND state='pending'",[id]));
 }
 const job=await getJob(f.p,id);
 assert.equal(job.state,'completed');
 assert.equal(job.counts.inserted,1);
 assert.equal(job.counts.rejected,1);
 assert.equal(job.discoveryReasons?.MAPS_IDENTITY_UNVERIFIED,1);
 assert.equal(job.siteCollection?.completed,2);
 assert.deepEqual(calls,[
  'CNPJ:'+f.input.brief,'dataset:0','MAPS:'+rejected.name,'dataset:1','MAPS:'+accepted.name,'WEB:'+accepted.name,
  'robots:/robots.txt','sitemap:/sitemap.xml','page:/','page:/contato','page:/contato',
 ]);
 const result=await getJourney(f.p,journey.id);
 assert.equal(result.stages[1].name,'research');
 const snapshot=await readWorkspaceSnapshot(f.p);
 assert.equal(snapshot.data.leads[0].cnpj,record.cnpj);
 assert.equal(snapshot.data.leads[0].site,'https://company.example.com/');
 assert.equal(snapshot.data.cadences.length,0);
});
test('an uncertain registry-first Maps run reconciles against Maps and resumes without another start',async t=>{
 const before=process.env.SITE_BROWSER_TOKEN;
 process.env.SITE_BROWSER_TOKEN='fixture-only-site-browser-token-00001';
 t.after(()=>{if(before===undefined)delete process.env.SITE_BROWSER_TOKEN;else process.env.SITE_BROWSER_TOKEN=before;});
 const f=await fixture(1),input:JourneyInput={...f.input,location:'Curitiba, PR',registry:{cnae:'2512800',city:'Curitiba',uf:'PR'}};
 const {journey}=await start({...f,input});
 const jobId=journey.stages[0].jobId!;
 let starts=0;
 const result=(receiptId:string,candidates:import('../../src/domain/prospecting.ts').Candidate[])=>({
  receiptId,candidates,rejected:[],rawCount:candidates.length,nextCursor:null,exhausted:true,
  usage:{provider:'apify',operationId:receiptId,units:{candidates:candidates.length},costUsd:null,costKind:'unknown' as const},
 });
 const apify={start:async(ctx:any)=>{
  starts++;
  if(ctx.profile.source==='MAPS')return {kind:'uncertain' as const,operationId:ctx.operationId};
  return {kind:'inline' as const,page:result('registry-for-reconciliation',[
   {name:'[RE] Empresa Maps',source:'CNPJ',sourceRef:'registry-company',city:'Curitiba',state:'PR',cnae:'2512800',cnpj:'37297479000180',facts:{registrationStatus:'ATIVA'}},
  ])};
 },poll:async(_ctx:any,run:any)=>({status:'succeeded' as const,run}),readPage:async()=>result('empty-maps',[]),abort:async()=>{throw Error('Unexpected abort');}};
 const siteBrowser={async read(){throw Error('No site should be visited');}};
 const tick=()=>runWorkerOnce({apify,siteBrowser},{signal:AbortSignal.timeout(5000),workspaceId:f.p.workspaceId});
 await tick();
 const pending=await getJob(f.p,jobId);
 assert.equal(pending.state,'needs_reconciliation');
 assert.match(pending.unresolvedAttempts![0].step,/^maps:/);
 const reconciling=new ApifyAdapter(async url=>{
  const path=new URL(String(url)).pathname;
  if(path.includes('/acts/'))return Response.json({data:{id:path.endsWith('/compass~crawler-google-places')?'maps-actor':'different-actor'}});
  assert.ok(path.endsWith('/actor-runs/maps-confirmed'));
  return Response.json({data:{actId:'maps-actor',buildNumber:'fixture-build',defaultDatasetId:'maps-dataset'}});
 });
 const resumed=await reconcileJob(f.p,jobId,{runId:'maps-confirmed',operationId:pending.unresolvedAttempts![0].id},{apify:reconciling});
 assert.equal(resumed.state,'queued');
 for(let i=0;i<4&&(await getJob(f.p,jobId)).state!=='partial';i++)await tick();
 assert.equal((await getJob(f.p,jobId)).state,'partial');
 assert.equal(starts,2);
});
test('discovery only delivers a verified active company and reports a shortfall',async()=>{
 const f=await fixture(),{journey}=await start(f);const calls:string[]=[];
 const apify={start:async(ctx:any,input:any)=>{
  calls.push(ctx.profile.source);
  const candidates=ctx.profile.source==='MAPS'?(calls.length>1?[]:[
   {sourceRef:'missing-phone',name:'[RE] Sem telefone',site:'https://no-phone.example',source:'MAPS' as const},
   {sourceRef:'inactive',name:'[RE] Clínica Baixada',site:'https://inactive.example',phone:'+5511987654321',source:'MAPS' as const},
   {sourceRef:'clinic',name:'[RE] Clínica Ativa',site:'https://clinic.example',phone:'+5511987654321',source:'MAPS' as const},
   {sourceRef:'closed',name:'[RE] Clínica Ativa',site:'https://clinic.example',phone:'+5511987654321',source:'MAPS' as const,facts:{permanentlyClosed:true}},
  ]):[{sourceRef:'registry',name:calls.length===2?'[RE] Clínica Baixada':'[RE] Clínica Ativa',source:'CNPJ' as const,cnpj:calls.length===2?'33000167000101':'37297479000180',facts:{registrationStatus:calls.length===2?'BAIXADA':'ATIVA'}}];
  return{kind:'inline' as const,page:{receiptId:ctx.operationId,candidates,nextCursor:null,exhausted:true,rawCount:candidates.length,rejected:[],usage:{provider:'apify',operationId:ctx.operationId+':page',units:{candidates:candidates.length},costUsd:null,costKind:'unknown' as const}}};
 },poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}};
 const collect=async(url:string)=>[{id:'site',url,text:url.includes('inactive')?'Clínica Baixada +55 11 98765-4321 33.000.167/0001-01':'Clínica Ativa +55 11 98765-4321 37.297.479/0001-80',hash:url,fetchedAt:new Date().toISOString(),truncated:false}];
 for(let batch=0;batch<2;batch++)await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 const current=await getJourney(f.p,journey.id);assert.deepEqual(calls,['MAPS','CNPJ','CNPJ','MAPS']);
 assert.equal(current.stages[0].state,'partial');assert.equal(current.stages.filter(s=>s.name==='research').length,1,JSON.stringify(current));
 const leads=(await readWorkspaceSnapshot(f.p)).data.leads;assert.equal(leads.length,1);assert.equal(leads[0].cnpj,'37297479000180');
});
test('admission uses pages from a timed-out Apify crawl without paying for a second start',async()=>{
 const f=await fixture(1);
 process.env.APIFY_SITE_ACTOR='apify/website-content-crawler';process.env.APIFY_SITE_BUILD='fixture-build';
 const {journey}=await start(f);let crawlStarts=0,polls=0;
 const apify={start:async(ctx:any)=>{
  const candidates=ctx.profile.source==='MAPS'?[{sourceRef:'maps',name:'[RE] Empresa',site:'https://example.com',phone:'+5511987654321',source:'MAPS' as const,evidence:[{id:'maps',url:'https://example.com/maps',text:'Categoria do Maps: esquadrias',hash:'maps',fetchedAt:new Date().toISOString(),truncated:false}]}]
   :[{sourceRef:'registry',name:'[RE] Empresa',cnpj:'37297479000180',source:'CNPJ' as const,facts:{registrationStatus:'ATIVA'}}];
  return{kind:'inline' as const,page:{receiptId:ctx.operationId,candidates,nextCursor:null,exhausted:true,rawCount:candidates.length,rejected:[],usage:{provider:'apify',operationId:ctx.operationId+':page',units:{candidates:candidates.length},costUsd:null,costKind:'unknown' as const}}};
 },poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No cancellation');}};
 const siteCrawler=new ApifySiteCrawler(async(url,init)=>{
  if(init?.method==='POST'){
   crawlStarts++;
   return Response.json({data:{id:'crawl',defaultDatasetId:'site'}});
  }
  if(String(url).endsWith('/actor-runs/crawl')){
   return Response.json({data:{status:++polls===1?'TIMING-OUT':'TIMED-OUT',defaultDatasetId:'site'}});
  }
  assert.match(String(url),/datasets\/site\/items/);
  return Response.json([
   {url:'https://example.com/',text:'Empresa +55 11 98765-4321'},
   {url:'https://example.com/legal',text:'CNPJ 37.297.479/0001-80'},
  ]);
 });
 await runWorkerOnce({apify,siteCrawler},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 assert.equal((await getJob(f.p,journey.stages[0].jobId!)).state,'running');
 assert.equal((await readWorkspaceSnapshot(f.p)).data.leads.length,0);
 await runWorkerOnce({apify,siteCrawler},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 assert.equal(crawlStarts,1);assert.equal((await readWorkspaceSnapshot(f.p)).data.leads[0].cnpj,'37297479000180');
 assert.equal((await getJourney(f.p,journey.id)).stages[0].state,'completed');
 const evidence=(await testAdmin(c=>c.query("SELECT text FROM app.lead_evidence WHERE workspace_id=$1",[f.p.workspaceId]))).rows;
 assert.ok(evidence.some(row=>row.text.includes('37.297.479')));
 assert.ok(evidence.some(row=>row.text.includes('Categoria do Maps: esquadrias')));
});
test('discovery searches for and verifies an institutional site missing from Maps',async()=>{
 const f=await fixture(1),{journey}=await start(f),calls:string[]=[],reads:string[]=[];
 const apify={start:async(ctx:any,input:any)=>{
  const source:string=ctx.profile.source;calls.push(source);
  if(source==='WEB'){assert.equal(input.filters.term,'[RE] Clínica Exemplo');assert.equal(input.filters.location,'Rio de Janeiro');assert.equal(input.limit,5);}
  if(source==='CNPJ')assert.equal(input.filters.cnpj,'37297479000180');
  const candidates=source==='MAPS'?[{sourceRef:'maps',name:'[RE] Clínica Exemplo',phone:'+5521987654321',city:'Rio de Janeiro',source:'MAPS' as const}]
    :source==='WEB'?[
     {sourceRef:'google',name:'[RE] Clínica Exemplo',site:'https://google.com',source:'WEB' as const},
     {sourceRef:'directory',name:'[RE] Clínica Exemplo',site:'https://cnpj.biz/37297479000180',source:'WEB' as const},
     {sourceRef:'homonym',name:'[RE] Clínica Exemplo',site:'https://clinicaexemplo.other.example',source:'WEB' as const},
     {sourceRef:'official',name:'[RE] Clínica Exemplo',site:'https://grupo-xyz.example',source:'WEB' as const},
    ]:[{sourceRef:'registry',name:'[RE] Clínica Exemplo',source:'CNPJ' as const,cnpj:'37297479000180',facts:{registrationStatus:'ATIVA'}}];
  return{kind:'inline' as const,page:{receiptId:ctx.operationId,candidates,nextCursor:null,exhausted:true,rawCount:candidates.length,rejected:[],usage:{provider:'apify',operationId:ctx.operationId+':page',units:{candidates:candidates.length},costUsd:null,costKind:'unknown' as const}}};
 },poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}};
 const collect=async(url:string)=>{reads.push(url);return[{id:'site',url,text:url.includes('other')?'Clínica Exemplo +55 11 98765-4321':'Clínica Exemplo +55 21 98765-4321 37.297.479/0001-80',hash:url,fetchedAt:new Date().toISOString(),truncated:false}];};
 await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 assert.deepEqual(calls,['MAPS','WEB','CNPJ']);
 assert.deepEqual(reads,['https://clinicaexemplo.other.example/','https://grupo-xyz.example/']);
 const leads=(await readWorkspaceSnapshot(f.p)).data.leads;assert.equal(leads.length,1);assert.equal(leads[0].site,'https://grupo-xyz.example/');assert.equal(leads[0].cnpj,'37297479000180');
 assert.equal((await getJourney(f.p,journey.id)).stages[0].state,'completed');
});
test('discovery replaces discarded Maps rows and resumes pending registry lookups without another start',async()=>{
 const f=await fixture(),{journey}=await start(f),starts:string[]=[],cursors:(string|null)[]=[];
 const entries=[
  {sourceRef:'missing-site',name:'[RE] Sem site',source:'MAPS' as const},
  {sourceRef:'generic-site',name:'[RE] Site genérico',site:'https://google.com',phone:'+5511987654321',source:'MAPS' as const},
  {sourceRef:'a',name:'[RE] Clínica Alfa',site:'https://alfa.example',phone:'+5511987654321',source:'MAPS' as const},
  {sourceRef:'b',name:'[RE] Clínica Beta',site:'https://beta.example',phone:'+5521987654321',source:'MAPS' as const},
 ];
 const cnpjs=['37297479000180','33000167000101'];
 let pending=true;
 const apify={
  start:async(ctx:any,input:any)=>{
   const source:string=ctx.profile.source;starts.push(source);
   if(source==='MAPS')assert.equal(input.limit,4);
   const runId=source==='MAPS'?'maps':source==='WEB'?'web-empty':input.filters.cnpj;
   return{kind:'remote' as const,run:{provider:'apify' as const,runId,datasetId:runId,profileId:ctx.profile.actor,build:ctx.profile.build,operationId:ctx.operationId}};
  },
  poll:async(_ctx:any,run:any)=>{
   const status=run.runId===cnpjs[0]&&pending?'running' as const:'succeeded' as const;
   if(status==='running')pending=false;
   return {run,status};
  },
  readPage:async(ctx:any,run:any,cursor:string|null,limit:number)=>{
   const maps=ctx.profile.source==='MAPS',offset=Number(cursor??0);
   if(maps)cursors.push(cursor);
   const candidates=maps?entries.slice(offset,offset+limit):run.runId==='web-empty'?[]:[
    {sourceRef:run.runId,name:run.runId===cnpjs[0]?'[RE] Clínica Alfa':'[RE] Clínica Beta',cnpj:run.runId,source:'CNPJ' as const,facts:{registrationStatus:'ATIVA'}},
   ];
   const exhausted=!maps||offset+candidates.length===entries.length,receiptId=run.runId+':'+offset;
   return{receiptId,candidates,nextCursor:exhausted?null:String(offset+candidates.length),exhausted,rawCount:candidates.length,rejected:[],usage:{provider:'apify',operationId:receiptId,units:{candidates:candidates.length},costUsd:null,costKind:'unknown' as const}};
  },
  abort:async()=>{throw Error('No cancellation expected');},
 };
 const collect=async(url:string)=>[{id:'site',url,text:url.includes('alfa')?'Clínica Alfa +55 11 98765-4321 37.297.479/0001-80':'Clínica Beta +55 21 98765-4321 33.000.167/0001-01',hash:url,fetchedAt:new Date().toISOString(),truncated:false}];
 for(let attempt=0;attempt<3;attempt++)await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 assert.deepEqual(starts,['MAPS','WEB','CNPJ','CNPJ']);
 assert.deepEqual(cursors,[null,'2','2']);
 const leads=(await readWorkspaceSnapshot(f.p)).data.leads;
 assert.deepEqual(leads.map(lead=>lead.cnpj).sort(),[...cnpjs].sort());
 assert.equal((await getJourney(f.p,journey.id)).stages[0].state,'completed');
});
test('discovery makes a bounded complementary Maps query when the first result set ends early',async()=>{
 const f=await fixture(2),{journey}=await start(f);let maps=0;
 const apify={start:async(ctx:any,input:any)=>{
  let candidates;
  if(ctx.profile.source==='MAPS'){
   maps++;if(maps===2)assert.match(input.filters.term,/Rio de Janeiro/);
   candidates=[{sourceRef:'company-'+maps,name:maps===1?'[RE] Alfa':'[RE] Beta',phone:'+5511987654321',site:maps===1?'https://alfa.example':'https://beta.example',source:'MAPS' as const}];
  }else candidates=[{sourceRef:'cnpj',name:maps===1?'[RE] Alfa':'[RE] Beta',phone:'+5511987654321',cnpj:input.filters.cnpj,source:'CNPJ' as const,facts:{registrationStatus:'ATIVA'}}];
  const rejected=ctx.profile.source==='MAPS'&&maps===1?Array.from({length:3},()=>({reason:'MISSING_IDENTITY'})):[];
  const rawCount=candidates.length+rejected.length;
  return{kind:'inline' as const,page:{receiptId:ctx.operationId,candidates,rawCount,rejected,exhausted:true,nextCursor:null,usage:{provider:'apify',operationId:ctx.operationId+':page',units:{candidates:rawCount},costUsd:null,costKind:'unknown' as const}}};
 },poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}};
 const collect=async(url:string)=>[{id:'page',url,text:url.includes('alfa')?'Alfa +55 11 98765-4321 37.297.479/0001-80':'Beta +55 11 98765-4321 33.000.167/0001-01',hash:url,fetchedAt:new Date().toISOString(),truncated:false}];
 await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 assert.equal(maps,2);assert.equal((await readWorkspaceSnapshot(f.p)).data.leads.length,2);
 assert.equal((await getJourney(f.p,journey.id)).stages[0].state,'completed');
 const cancelled=await fixture(2),created=await start(cancelled),id=created.journey.stages[0].jobId!;
 // Model the cancellation becoming visible immediately after the first receipt.
 await testAdmin(c=>c.query(`CREATE FUNCTION app.test_cancel_after_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN NEW.state:='cancelling';RETURN NEW;END $$;
 CREATE TRIGGER test_cancel_after_receipt BEFORE UPDATE OF counts ON app.prospecting_job
 FOR EACH ROW WHEN (NEW.id='${id}') EXECUTE FUNCTION app.test_cancel_after_receipt()`));
 maps=0;
 try{
  await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:cancelled.p.workspaceId});
  assert.equal((await getJob(cancelled.p,id)).state,'cancelling');
  await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:cancelled.p.workspaceId});
  assert.equal(maps,1);
  assert.equal((await getJob(cancelled.p,id)).state,'cancelled');
 }finally{await testAdmin(c=>c.query('DROP TRIGGER test_cancel_after_receipt ON app.prospecting_job; DROP FUNCTION app.test_cancel_after_receipt()'));}
});
test('a reviewed request for 250 companies leaves candidate capacity for a second Maps query',async()=>{
 const f=await fixture(250),limits:number[]=[];
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='essential' WHERE workspace_id=$1",[f.p.workspaceId]);
  await c.query("UPDATE app.billing_grant SET source='plan',quantity=5000 WHERE workspace_id=$1 AND unit='extractions'",[f.p.workspaceId]);
 });
 const {journey}=await start(f);
 const apify={start:async(ctx:any,input:any)=>{
  limits.push(input.limit);
  const count=limits.length===1?100:0;
  return{kind:'inline' as const,page:{receiptId:ctx.operationId,candidates:[],rawCount:count,rejected:Array.from({length:count},()=>({reason:'MISSING_IDENTITY'})),exhausted:true,nextCursor:null,usage:{provider:'apify',operationId:ctx.operationId+':page',units:{candidates:count},costUsd:null,costKind:'unknown' as const}}};
 },poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}};
 for(let i=0;i<2;i++)await runWorkerOnce({apify},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 assert.deepEqual(limits,[300,400]);
 const job=await getJob(f.p,journey.stages[0].jobId!);
 assert.equal(job.state,'partial');assert.equal(job.counts.rejected,100);assert.equal(job.counts.inserted,0);
});
test('partial source failures retain 70 companies and reviewed resume retries only 30 pending companies',async()=>{
 const f=await fixture(100);
 await testAdmin(async c=>{
  await c.query("UPDATE app.billing_account SET state='active',plan='essential' WHERE workspace_id=$1",[f.p.workspaceId]);
  await c.query("UPDATE app.billing_grant SET source='plan' WHERE workspace_id=$1 AND unit='extractions'",[f.p.workspaceId]);
 });
 const {journey}=await start(f);
 let j=await done(f,journey,'discover','completed',100),research=j.stages.find(s=>s.name==='research')!;
 await withWorkspaceTransaction(f.p,c=>c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,list_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,$4,$2,'fixture','generation','MAPS','queued','{\"limit\":250}','fixture')",[f.p.workspaceId,randomUUID(),f.p.userId,journey.listId]));
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
  assert.equal(calls,1);assert.equal(await testAdmin(async c=>Number((await c.query("SELECT count(*) n FROM app.prospecting_attempt WHERE job_id=$1 AND state='completed' AND payload ? 'result'",[stage.jobId])).rows[0].n)),1,'technical receipt survives authority change');assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.research_source WHERE job_id=$1',[stage.jobId])).rows[0].n)),0);if(changed==='role')await assert.rejects(advanceJourney(lease),(e:any)=>e.status===403);else await advanceJourney(lease);assert.equal((await getJourney(f.p,j.id)).stages.filter(s=>s.name==='people').length,0);
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

// Review regressions exercise real leases/roles and domain rows, never live providers.
test('active pause drains cancellation and releases its reservation before reviewed resume',async()=>{
 const f=await fixture(),{journey}=await start(f),j=await done(f,journey,'discover'),jobId=j.stages.at(-1)!.jobId!,lease=await grantTestLease(f.p,jobId);
 await cancelJourney(f.p,j.id);await runCompanyResearch(lease);
 const state=await testAdmin(async c=>(await c.query('SELECT state FROM app.prospecting_job WHERE id=$1',[jobId])).rows[0].state);assert.equal(state,'cancelled');
 assert.equal((await prepareJourneyResume(f.p,j.id)).blockers.length,0);
 assert.equal(await testAdmin(async c=>Number((await c.query("SELECT count(*) n FROM app.usage_ledger WHERE job_id=$1 AND event='release'",[jobId])).rows[0].n)),1);
});
test('context invalidation drains an active child and allows complete reviewed recovery',async()=>{
 const f=await fixture(),{journey}=await start(f),j=await done(f,journey,'discover'),jobId=j.stages.at(-1)!.jobId!,lease=await grantTestLease(f.p,jobId);
 await testAdmin(c=>c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,2,$2)',[f.p.workspaceId,{version:2,approvedAt:new Date().toISOString(),offer:'Nova',idealCustomer:'Clínicas'}]));
 await advanceJourney(lease);assert.equal((await getJourney(f.p,j.id)).state,'blocked');
 await runCompanyResearch(lease);
 const r=await prepareJourneyResume(f.p,j.id);assert.deepEqual(r.blockers,[]);const resumed=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});assert.equal(resumed.stages.at(-1)!.name,'research');
});
test('failed or independently cancelled children stop for review without creating another paid attempt',async()=>{
 for(const state of ['failed','cancelled']){const f=await fixture(),{journey}=await start(f);let j=await done(f,journey,'discover');const jobId=j.stages.at(-1)!.jobId!;
 if(state==='cancelled')assert.equal((await prospectingRequest(new Request(base+'/api/prospecting/jobs/'+jobId+'/cancel',{method:'POST',headers:f.headers}),'cancel',jobId)).status,200);
 j=await done(f,j,'research',state);assert.equal(j.state,'blocked');assert.equal(j.stages.filter(s=>s.name==='research').length,1);
 assert.equal(await runWorkerOnce({research:{collect:async()=>{throw Error('must not repeat');}}},{signal:new AbortController().signal,workspaceId:f.p.workspaceId}),false);
 const r=await prepareJourneyResume(f.p,j.id);j=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});assert.equal(j.stages.filter(s=>s.name==='research').length,2);
 }
});
test('deterministic provider failure dispatches once and waits for a newly reviewed recovery',async()=>{
 const f=await fixture(),{journey}=await start(f);let starts=0;
 const apify={start:async()=>{starts++;throw new ProviderError('REMOTE_FAILED');},poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}};
 assert.equal(await runWorkerOnce({apify},{signal:new AbortController().signal,workspaceId:f.p.workspaceId}),true);
 assert.equal((await getJourney(f.p,journey.id)).state,'blocked');assert.equal(await runWorkerOnce({apify},{signal:new AbortController().signal,workspaceId:f.p.workspaceId}),false);assert.equal(starts,1);assert.equal((await getJourney(f.p,journey.id)).stages.length,1);
});
test('a later successful recovery covers historical cancelled batches on every subsequent resume',async()=>{
 const f=await fixture(),{journey}=await start(f);let j=await done(f,journey,'discover');j=await done(f,j,'research');j=await done(f,j,'people');await cancelJourney(f.p,j.id);
 let r=await prepareJourneyResume(f.p,j.id);j=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});j=await done(f,j,'qualify');assert.equal(j.state,'review');const jobs=j.stages.length;
 r=await prepareJourneyResume(f.p,j.id);j=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});assert.equal(j.state,'review');assert.equal(j.stages.length,jobs,'successful modules must not be called or charged again');
});
test('partial people and qualification expose retryable companies and reuse successful modules',async()=>{
 const f=await fixture(),{journey}=await start(f);let j=await done(f,journey,'discover');j=await done(f,j,'research');const peopleId=j.stages.at(-1)!.jobId!;
 const leads=await testAdmin(async c=>(await c.query('SELECT lead_id FROM app.research_case WHERE job_id=$1 ORDER BY lead_id',[peopleId])).rows.map(r=>r.lead_id));
 await testAdmin(async c=>{await c.query("SELECT set_config('app.workspace_id',$1,false),set_config('app.user_id',$2,false)",[f.p.workspaceId,f.p.userId]);await c.query("UPDATE app.research_case SET state='completed' WHERE job_id=$1 AND lead_id=$2",[peopleId,leads[0]]);await c.query("UPDATE app.research_case SET state='partial',missing='[\"FONTE_INDISPONIVEL\"]' WHERE job_id=$1 AND lead_id=$2",[peopleId,leads[1]]);});
 j=await done(f,j,'people','partial');const qualifyId=j.stages.at(-1)!.jobId!;
 await testAdmin(async c=>{for(const leadId of leads)await c.query("INSERT INTO app.prospecting_item(workspace_id,job_id,id,lead_id,name,status,payload) VALUES($1,$2,$3,$4,'Fixture','pending_review',$5)",[f.p.workspaceId,qualifyId,randomUUID(),leadId,{results:[{module:'qualify',status:'pending_review',proposed:{}},{module:'summary',status:leadId===leads[0]?'pending_review':'failed',proposed:{},reasons:leadId===leads[0]?[]:['MODULE_FAILED']}]}]);});
 j=await done(f,j,'qualify','partial');assert.equal(j.missing,1);assert.equal(j.state,'review');
 let r=await prepareJourneyResume(f.p,j.id);j=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});assert.equal(j.stages.at(-1)!.name,'people');assert.equal(j.stages.at(-1)!.companies,1);j=await done(f,j,'people');
 // No automatic repetition of the earlier partial qualification: a reviewed resume owns retries.
 r=await prepareJourneyResume(f.p,j.id);j=await resumeJourney(f.p,j.id,{token:r.token,requestId:randomUUID()});const retry=j.stages.at(-1)!;
 assert.equal(retry.name,'qualify');assert.equal(retry.companies,1);const input=await testAdmin(async c=>(await c.query('SELECT input FROM app.prospecting_job WHERE id=$1',[retry.jobId])).rows[0].input);assert.deepEqual(input.leadIds,[leads[1]]);assert.deepEqual(input.modules,['summary']);
 j=await done(f,j,'qualify');assert.equal(j.missing,0);assert.equal(j.state,'review');
});
test('discovery skips a workspace duplicate in another list and still investigates its new contact',async()=>{
 const f=await fixture(),snap=await readWorkspaceSnapshot(f.p),otherList=randomUUID(),otherLead=randomUUID();
 await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:snap.revision,command:{type:'leads.import',list:{id:otherList,name:'Anterior'},leads:[{id:otherLead,listId:otherList,name:'Anterior',site:'https://duplicate.example',source:'MANUAL',qualification:'pending',createdAt:new Date().toISOString()}]}});
 await testAdmin(c=>c.query('INSERT INTO app.lead_identity(workspace_id,list_id,identity,lead_id) VALUES($1,$2,$3,$4)',[f.p.workspaceId,otherList,'source:MAPS:old',otherLead]));
 const {journey}=await start(f);const apify={start:async(ctx:any)=>{
  const candidates=ctx.profile.source==='MAPS'?[{sourceRef:'old',name:'Anterior',site:'https://duplicate.example',source:'MAPS' as const},{sourceRef:'new',name:'Nova',site:'https://new.example',phone:'+5511987654321',source:'MAPS' as const}]:[{sourceRef:'cnpj',name:'Nova',cnpj:'37297479000180',source:'CNPJ' as const,facts:{registrationStatus:'ATIVA'}}];
  return{kind:'inline' as const,page:{receiptId:ctx.operationId,candidates,nextCursor:null,exhausted:true,rawCount:candidates.length,rejected:[],usage:{provider:'apify',operationId:ctx.operationId,units:{candidates:candidates.length},costUsd:null,costKind:'unknown' as const}}};
 },poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');}};
 const collect=async(url:string)=>[{id:'site',url,text:'Nova +55 11 98765-4321 37.297.479/0001-80',hash:url,fetchedAt:new Date().toISOString(),truncated:false}];
 for(let i=0;i<2;i++)await runWorkerOnce({apify,collect},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});const j=await getJourney(f.p,journey.id);assert.equal(j.state,'running');assert.equal(j.stages.at(-1)?.name,'research');assert.equal(j.stages.at(-1)?.companies,1);assert.equal((j as any).excluded,1);
 assert.equal((await readWorkspaceSnapshot(f.p)).data.leads.length,2,'preserve one contact per company');
});
test('a duplicate in the destination list cannot bypass discovery admission',async()=>{
 const f=await fixture(1),listId=randomUUID(),leadId=randomUUID();
 await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:(await readWorkspaceSnapshot(f.p)).revision,command:{type:'leads.import',list:{id:listId,name:'[RE] Destino'},leads:[{id:leadId,listId,name:'[RE] Sem site',source:'MAPS',qualification:'pending',createdAt:new Date().toISOString()}]}});
 await testAdmin(c=>c.query('INSERT INTO app.lead_identity(workspace_id,list_id,identity,lead_id) VALUES($1,$2,$3,$4)',[f.p.workspaceId,listId,'source:MAPS:duplicate',leadId]));
 const {journey}=await start({...f,input:{...f.input,destinationListId:listId}}),apify={
  start:async(ctx:any)=>({kind:'inline' as const,page:{receiptId:ctx.operationId,candidates:[{sourceRef:'duplicate',name:'[RE] Sem site',source:'MAPS' as const}],nextCursor:null,exhausted:true,rawCount:1,rejected:[],usage:{provider:'apify',operationId:ctx.operationId,units:{candidates:1},costUsd:null,costKind:'unknown' as const}}}),
  poll:async()=>{throw Error('No remote');},readPage:async()=>{throw Error('No remote');},abort:async()=>{throw Error('No remote');},
 };
 for(let i=0;i<2;i++)await runWorkerOnce({apify},{signal:new AbortController().signal,workspaceId:f.p.workspaceId});
 const current=await getJourney(f.p,journey.id);assert.equal(current.state,'review');assert.equal(current.stages.length,1);
 assert.equal((await readWorkspaceSnapshot(f.p)).data.leads.length,1);
});
test('SQL ownership cannot be transferred by another operator and an admin can pause the original actor',async()=>{
 const f=await fixture(),{journey}=await start(f),b=await fixture(),admin=await fixture();
 await testAdmin(async c=>{await c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]);for(const [u,role] of [[b.p.userId,'operator'],[admin.p.userId,'admin']])await c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),f.p.workspaceId,u,role]);});
 const bp={...b.p,workspaceId:f.p.workspaceId,role:'operator' as const},ap={...admin.p,workspaceId:f.p.workspaceId,role:'admin' as const};
 let changed=0;try{changed=(await withWorkspaceTransaction(bp,c=>c.query('UPDATE app.prospecting_journey SET actor_id=$2 WHERE id=$1',[journey.id,bp.userId]))).rowCount??0;}catch(e:any){assert.ok(['42501','P0001'].includes(e.code));}assert.equal(changed,0);
 await assert.rejects(cancelJourney(bp,journey.id),(e:any)=>[403,404].includes(e.status));assert.equal((await cancelJourney(ap,journey.id)).state,'paused');
 assert.equal(await testAdmin(async c=>(await c.query('SELECT actor_id FROM app.prospecting_journey WHERE id=$1',[journey.id])).rows[0].actor_id),f.p.userId);
});
test('failed cancelled and context-invalid cadence proposals can be replaced once by reviewed analysis',async()=>{
 for(const state of ['failed','cancelled','context']){const f=await fixture(),{journey}=await start(f);let j=await done(f,journey,'discover');j=await done(f,j,'research');j=await done(f,j,'people');j=await done(f,j,'qualify');
 const first=await prepareJourneyCadence(f.p,j.id,{channels:['EMAIL']});j=await confirmJourneyCadence(f.p,j.id,{channels:['EMAIL'],token:first.token,requestId:randomUUID()});const previous=j.proposalJobId!;
 await testAdmin(async c=>{await c.query('UPDATE app.prospecting_job SET state=$2 WHERE id=$1',[previous,state==='context'?'completed':state]);if(state==='context')await c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,2,$2)',[f.p.workspaceId,{version:2,approvedAt:new Date().toISOString(),offer:'Nova',idealCustomer:'Clínicas'}]);});
 const r=await prepareJourneyCadence(f.p,j.id,{channels:['EMAIL']}),body={channels:['EMAIL'],token:r.token,requestId:randomUUID()},[a,b]=await Promise.all([confirmJourneyCadence(f.p,j.id,body),confirmJourneyCadence(f.p,j.id,body)]);assert.equal(a.proposalJobId,b.proposalJobId);assert.notEqual(a.proposalJobId,previous);
 const steps=[{channel:'EMAIL',delayDays:0,subject:'Olá',body:'Olá {{nome}}, podemos conversar?',stopOnReply:true}];
 await testAdmin(async c=>{for(const jobId of [previous,a.proposalJobId!]){const job=(await c.query('SELECT checkpoint FROM app.prospecting_job WHERE id=$1',[jobId])).rows[0];await c.query("UPDATE app.prospecting_job SET state='completed' WHERE id=$1",[jobId]);await c.query('INSERT INTO app.planning_proposal(workspace_id,job_id,body_hash,payload) VALUES($1,$2,\'fixture\',$3)',[f.p.workspaceId,jobId,{task:'cadence_options',contractVersion:'planning-v1',jobId,base:job.checkpoint.planning.base,evidenceIds:[],recommendedOptionId:null,options:['option_1','option_2','option_3'].map(id=>({id,name:'Contato',description:'Opção',steps}))}]);}});
 const edits={name:'Substituição revisada',steps};await assert.rejects(preparePlanningSelection(f.p,previous,{optionId:'option_1',edits}),(e:any)=>e.status===409);
 const selection=await preparePlanningSelection(f.p,a.proposalJobId!,{optionId:'option_1',edits});await confirmPlanningSelection(f.p,a.proposalJobId!,{optionId:'option_1',edits,reviewToken:selection.token,requestId:randomUUID()});assert.equal((await getJourney(f.p,j.id)).state,'ready');assert.equal((await readWorkspaceSnapshot(f.p)).data.cadences.length,1);
 await assert.rejects(prepareJourneyCadence(f.p,j.id,{channels:['EMAIL']}),(e:any)=>e.status===409);
 }
});
test('direct SQL publication rejects changed journey context or central policy with a valid worker lease',async()=>{
 for(const change of ['context','policy']){
 const f=await fixture(),{journey}=await start(f),j=await done(f,journey,'discover'),jobId=j.stages.at(-1)!.jobId!,lease=await grantTestLease(f.p,jobId);
 if(change==='context')await testAdmin(c=>c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,2,$2)',[f.p.workspaceId,{version:2,approvedAt:new Date().toISOString(),offer:'Mudou',idealCustomer:'Outro'}]));
 else await saveAiPolicy(f.p,{requestId:randomUUID(),expectedRevision:1,policy:{mode:'auto',conventionalProvider:'openai',jevEnabled:true}});
 const leadId=await testAdmin(async c=>(await c.query('SELECT lead_id FROM app.research_case WHERE job_id=$1',[jobId])).rows[0].lead_id);
 await assert.rejects(withContextTransaction(workerPool(),f.p,async c=>{await c.query("SELECT set_config('app.research_token',$1,true),set_config('app.research_fence',$2,true)",[lease.token,String(lease.fence)]);await c.query("INSERT INTO app.research_source(workspace_id,job_id,id,lead_id,url,text,hash,fetched_at,source_kind,attribution) VALUES($1,$2,'bypass',$3,'https://clinic.example','Company','hash',now(),'website','company')",[f.p.workspaceId,jobId,leadId]);}),/JOURNEY_CHANGED|row-level security/);
 assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.research_source WHERE job_id=$1',[jobId])).rows[0].n)),0);
 }
});
