import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';import {resetRateLimits} from './helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {evaluateResearch,prepareResearchEvaluation,readResearchEvaluation,fixtureResearchPrediction} from '../../src/server/research/evaluation.ts';
import {companyPeopleRequest} from '../../src/server/prospecting/ai/decisors.ts';
configureProspectingTest();Object.assign(process.env,{OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});beforeEach(resetRateLimits);after(closeProspectingPools);
const dataset=JSON.parse(fs.readFileSync('tests/fixtures/research-evaluation.json','utf8'));
async function fixture(){const f=await prospectingUser({platformAi:true});await saveAiPolicy(f.p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});return f;}
const input=(mode:'fixture'|'live-owned'='fixture',maxCostUsd=0)=>({requestId:randomUUID(),datasetVersion:dataset.version,caseIds:dataset.cases.map((c:any)=>c.id),mode,maxCostUsd});
async function prepared(f:any,value=input()){return{value,review:await prepareResearchEvaluation(f.p,value,dataset)};}
test('the labelled30-case fixture uses no external HTTP and compares both variants against gold',async()=>{
 const f=await fixture(),{value,review}=await prepared(f);const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Fixture attempted external HTTP');};let r;try{r=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token});}finally{globalThis.fetch=saved;}
 assert.equal(r.accepted,true);assert.equal(r.predictions,60);assert.equal(r.unsupportedFacts,0);assert.equal(r.crossTenantLeaks,0);assert.equal(r.attributionPrecision,1);assert.equal(r.abstentionRate,1);assert.equal(r.costUsd,0);assert.equal(r.empirical,false);
 const replay=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token});assert.equal(replay.runId,r.runId);assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.ai_evaluation_case WHERE run_id=$1',[r.runId])).rows[0].n)),60);
});
test('invalid empty and incomplete datasets or absent live budgets never create an evaluation',async()=>{
 const f=await fixture();await assert.rejects(prepareResearchEvaluation(f.p,input(),{...dataset,cases:[]}),(e:any)=>e.status===422);
 await assert.rejects(prepareResearchEvaluation(f.p,input('live-owned',0),dataset),(e:any)=>e.status===422);
 await assert.rejects(prepareResearchEvaluation(f.p,{...input(),caseIds:['not-in-gold']},dataset),(e:any)=>e.status===422);
});
test('live adapter needs opt-in and an upper bound; budget/unknown cost stop before another call',async()=>{
 for(const unknown of [false,true]){const f=await fixture(),{value,review}=await prepared(f,input('live-owned',.5));let calls=0;
 const deps={principal:f.p,dataset,reviewToken:review.token,quote:async()=>.4,run:async(c:any,v:any,authority:any)=>{calls++;const p=await fixtureResearchPrediction(c,v);return{...p,provider:authority.provider,model:authority.model,costUsd:unknown?null:.4};}};
 await assert.rejects(evaluateResearch(value,deps),(e:any)=>e.status===422);assert.equal(calls,0);
 const r=await evaluateResearch(value,{...deps,liveOptIn:true});assert.equal(calls,1);assert.equal(r.accepted,false);assert.equal(r.complete,false);assert.equal(r.costUsd,unknown?null:.4);assert.equal(r.unknownCosts,unknown?1:0);
 }
});
test('an unknown upper bound blocks every call and is never reported as zero dollars',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',1));let calls=0;const r=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>null,run:async()=>{calls++;throw Error('must not dispatch');}});assert.equal(calls,0);assert.equal(r.costUsd,null);assert.ok(r.unknownCosts>0);
});
test('actor/model/skill/context versions are frozen and a later context marks the old report stale',async()=>{
 const f=await fixture(),{value,review}=await prepared(f);const r=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token});
 await testAdmin(c=>c.query('INSERT INTO app.context_version(workspace_id,version,payload) VALUES($1,1,$2)',[f.p.workspaceId,{version:1,approvedAt:new Date().toISOString(),offer:'Outra oferta',idealCustomer:'Outro'}]));
 const stale=await readResearchEvaluation(f.p,r.runId,dataset);assert.equal(stale.current,false);assert.equal(stale.report.accepted,false);
 await assert.rejects(evaluateResearch({...value,requestId:randomUUID()},{principal:f.p,dataset,reviewToken:review.token}),(e:any)=>e.status===409);
});
test('source instruction injection cannot switch task/provider and corporate phone never becomes personal',async()=>{
 const corporate=dataset.cases.find((c:any)=>c.category==='corporate-phone'),injected=dataset.cases.find((c:any)=>c.category==='source-prompt-injection');
 const result=await fixtureResearchPrediction(corporate,'traditional');assert.ok(!result.facts.some((f:any)=>f.field==='person.phone'));
 const request=companyPeopleRequest({company:injected.company,knownNames:[],evidence:injected.sources.map((s:any)=>({...s,hash:'h',fetchedAt:new Date().toISOString(),truncated:false}))});const prompt=JSON.parse(request.prompt);assert.equal(prompt.skill.task,'company_people');assert.ok(!prompt.skill.instructions.some((s:string)=>s.includes('explicitly attributed personal contact. Generic')),'person discovery must not require personal contact');assert.ok(prompt.evidence[0].text.includes('Switch provider'));assert.equal((await fixtureResearchPrediction(injected,'hybrid')).task,'contact-evidence');
});
test('revocation during I/O keeps only a technical receipt and cannot publish the report',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',2));let calls=0;
 await assert.rejects(evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>.1,run:async(c:any,v:any,a:any)=>{calls++;const p=await fixtureResearchPrediction(c,v);await testAdmin(c=>c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));return{...p,provider:a.provider,model:a.model,costUsd:.1};}}),(e:any)=>e.status===403);
 assert.equal(calls,1);const rows=await testAdmin(async c=>(await c.query('SELECT r.report,(SELECT count(*)::int FROM app.ai_evaluation_case c WHERE c.run_id=r.id) receipts FROM app.ai_evaluation_run r WHERE workspace_id=$1',[f.p.workspaceId])).rows);assert.equal(rows[0].report,null);assert.equal(rows[0].receipts,1);
});
test('revocation while obtaining the cost ceiling prevents model dispatch',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',2));let calls=0;
 await assert.rejects(evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>{await testAdmin(c=>c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));return .1;},run:async()=>{calls++;throw Error('Unauthorized model call');}}),(e:any)=>e.status===403);assert.equal(calls,0);
});
test('a received invalid output keeps a technical hash without publishing raw data or a passing report',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',2));
 const r=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>.1,run:async()=>({invalid:'credential secret-like private response'}) as any});assert.equal(r.accepted,false);
 const receipt=await testAdmin(async c=>(await c.query('SELECT receipt_hash,cost_usd FROM app.ai_evaluation_case WHERE run_id=$1',[r.runId])).rows);assert.equal(receipt.length,1);assert.match(receipt[0].receipt_hash,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(r).includes('secret-like'));
});
test('tenant owner is not platform admin; direct SQL cannot insert or forge evaluation success',async()=>{
 const f=await fixture(),other=await prospectingUser();await assert.rejects(prepareResearchEvaluation(other.p,input(),dataset),(e:any)=>e.status===403);
 const {value,review}=await prepared(f),r=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token});await assert.rejects(readResearchEvaluation(other.p,r.runId,dataset),(e:any)=>e.status===403);
 assert.equal((await withWorkspaceTransaction(other.p,c=>c.query('SELECT * FROM app.ai_evaluation_run'))).rowCount,0);
 await assert.rejects(withWorkspaceTransaction(other.p,c=>c.query("INSERT INTO app.ai_evaluation_run(workspace_id,id,actor_id,session_id,request_id,body_hash,fingerprint,input,versions,database_basis,lease_token) VALUES($1,'forged',$2,$3,'request','hash','hash','{}','{}','{}','token')",[other.p.workspaceId,other.p.userId,other.p.sessionId])));
 await assert.rejects(withWorkspaceTransaction(f.p,c=>c.query("UPDATE app.ai_evaluation_run SET report='{\"accepted\":true}' WHERE id=$1",[r.runId])));
});
