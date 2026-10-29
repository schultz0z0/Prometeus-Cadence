import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {configureProspectingTest,prospectingUser,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';import {resetRateLimits} from './helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {evaluateResearch,prepareResearchEvaluation,readResearchEvaluation,fixtureResearchPrediction} from '../../src/server/research/evaluation.ts';
import {companyPeopleRequest} from '../../src/server/prospecting/ai/decisors.ts';
import * as evaluationService from '../../src/server/research/evaluation.ts';
import {sanitizePeopleSource} from '../../src/domain/company-people.ts';
import {scoreResearchEvaluation} from '../../src/domain/research-evaluation.ts';
import {cookies,requestAuth,password} from './helpers.ts';
import {requirePrincipal} from '../../src/server/auth/principal.ts';
import {identityAction} from '../../src/server/workspaces/service.ts';
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
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'owner\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));const runId=await testAdmin(async c=>(await c.query('SELECT id FROM app.ai_evaluation_run WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].id);const recovered=await readResearchEvaluation(f.p,runId,dataset);assert.equal(recovered.report.accepted,false);assert.equal(recovered.report.knownCostUsd,.1);
});
test('a received output from a different provider closes as uncertain with its recorded cost',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',2));const r=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>.1,run:async(row:any,variant:any)=>({...await fixtureResearchPrediction(row,variant),provider:'unreviewed-provider',costUsd:.1})});assert.equal(r.accepted,false);assert.equal(r.knownCostUsd,.1);assert.equal((await readResearchEvaluation(f.p,r.runId,dataset)).state,'uncertain');
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
test('administrative CLI rejects an incomplete manifest with a safe nonzero result',()=>{
 const file='.runtime/06iah-invalid-'+randomUUID()+'.json';try{fs.writeFileSync(file,JSON.stringify({private:'must-not-echo'}));const result=spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/evaluate-research.ts','--action=check','--manifest='+file],{encoding:'utf8',windowsHide:true});assert.notEqual(result.status,0);const r=JSON.parse(result.stdout);assert.equal(r.accepted,false);assert.equal(r.code,'EVALUATION_MANIFEST_INVALID');assert.ok(!JSON.stringify(r).includes('must-not-echo'));}finally{fs.unlinkSync(file);}
});
test('CLI prepares and confirms one fixture run using an actual platform-admin session',async()=>{
 const f=await fixture(),prefix='.runtime/06iah-cli-'+randomUUID(),manifest=prefix+'-manifest.json',session=prefix+'-session.json',review=prefix+'-review.json';
 try{const value=input();fs.writeFileSync(manifest,JSON.stringify({datasetFile:'tests/fixtures/research-evaluation.json',input:value}));fs.writeFileSync(session,JSON.stringify({cookie:f.cookie,workspaceId:f.p.workspaceId}));
 const call=(action:string,extra:string[]=[])=>spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/evaluate-research.ts','--action='+action,'--manifest='+manifest,'--session='+session,...extra],{encoding:'utf8',windowsHide:true});
 const prepared=call('prepare');assert.equal(prepared.status,0,prepared.stderr);const data=JSON.parse(prepared.stdout);assert.ok(data.token);fs.writeFileSync(review,JSON.stringify(data));const confirmed=call('run',['--review='+review]);assert.equal(confirmed.status,0,confirmed.stderr);const r=JSON.parse(confirmed.stdout);assert.equal(r.accepted,true);assert.equal(r.mode,'fixture');assert.equal(r.empirical,false);assert.ok(!confirmed.stdout.includes(f.cookie));
 const replay=call('run',['--review='+review]);assert.equal(replay.status,0);assert.equal(JSON.parse(replay.stdout).runId,r.runId);
 }finally{for(const file of [manifest,session,review])if(fs.existsSync(file))fs.unlinkSync(file);}
});
test('redacted CPF and age retain the permitted person and cited contact in both variants',async()=>{
 const gold=structuredClone(dataset),row=gold.cases.find((c:any)=>c.category==='cpf-age-redaction');row.proposed.people[0].quote=sanitizePeopleSource(row.sources[0].text);
 const predictions=[];for(const item of gold.cases)for(const variant of ['traditional','hybrid'] as const)predictions.push(await fixtureResearchPrediction(item,variant));
 const retained=predictions.filter(p=>p.caseId===row.id);assert.equal(retained.length,2);assert.ok(retained.every(p=>p.facts.length===3));assert.ok(!JSON.stringify(retained).includes('123.456.789-09'));assert.ok(!JSON.stringify(retained).includes('47 anos'));assert.equal(scoreResearchEvaluation(gold,predictions).accepted,true);
});
test('reviewed administrative closure releases an uncertain run without replaying provider I/O',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',2));let calls=0;
 const run=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>.1,run:async()=>{calls++;return{invalid:true} as any;}});
 const closure={runId:run.runId,requestId:randomUUID(),reason:'acknowledge-unresolved' as const};
 const reviewed=await evaluationService.prepareEvaluationClosure(f.p,closure,dataset);const closed=await evaluationService.closeResearchEvaluation(f.p,closure,dataset,reviewed.token);assert.equal(closed.state,'closed');assert.equal(closed.report.accepted,false);assert.equal(closed.report.costUsd,null);assert.equal(calls,1);
 assert.equal((await evaluationService.closeResearchEvaluation(f.p,closure,dataset,reviewed.token)).state,'closed');
 const next=await prepared(f,input('live-owned',2));const completed=await evaluateResearch(next.value,{principal:f.p,dataset,reviewToken:next.review.token,liveOptIn:true,quote:async()=>.01,run:async(row:any,variant:any,a:any)=>{calls++;return{...await fixtureResearchPrediction(row,variant),provider:a.provider,model:a.model,costUsd:.01};}});assert.equal(completed.accepted,true);assert.equal(calls,61);
});
test('orphan closure requires an expired lease, a current admin review and preserves late receipts',async()=>{
 const f=await fixture(),other=await prospectingUser(),{value,review}=await prepared(f,input('live-owned',2));
 await assert.rejects(evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>.1,run:async(row:any,variant:any,a:any)=>{await testAdmin(c=>c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));return{...await fixtureResearchPrediction(row,variant),provider:a.provider,model:a.model,costUsd:.1};}}),(e:any)=>e.status===403);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'owner\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));const journal=await testAdmin(async c=>(await c.query('SELECT id,lease_token FROM app.ai_evaluation_run WHERE workspace_id=$1',[f.p.workspaceId])).rows[0]);const closure={runId:journal.id,requestId:randomUUID(),reason:'acknowledge-unresolved' as const};
 await assert.rejects(evaluationService.prepareEvaluationClosure(f.p,closure,dataset),(e:any)=>e.status===409);
 await testAdmin(c=>c.query('UPDATE app.ai_evaluation_run SET lease_until=clock_timestamp()-interval \'1 second\' WHERE id=$1',[journal.id]));
 await assert.rejects(evaluationService.prepareEvaluationClosure(other.p,closure,dataset),(e:any)=>e.status===403);
 const ready=await evaluationService.prepareEvaluationClosure(f.p,closure,dataset);
 await withWorkspaceTransaction(f.p,c=>c.query('SELECT app.record_evaluation_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[journal.id,journal.lease_token,dataset.cases[0].id,'hybrid','late','a'.repeat(64),.2,1]));
 await assert.rejects(evaluationService.closeResearchEvaluation(f.p,closure,dataset,ready.token),(e:any)=>e.status===409);
 const latest=await evaluationService.prepareEvaluationClosure(f.p,closure,dataset);await testAdmin(c=>c.query('UPDATE auth.member SET role=\'viewer\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));await assert.rejects(evaluationService.closeResearchEvaluation(f.p,closure,dataset,latest.token),(e:any)=>e.status===403);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'owner\' WHERE "organizationId"=$1 AND "userId"=$2',[f.p.workspaceId,f.p.userId]));const closed=await evaluationService.closeResearchEvaluation(f.p,closure,dataset,latest.token);assert.equal(closed.state,'closed');assert.ok(Math.abs(closed.report.knownCostUsd-.3)<1e-9);assert.equal(closed.report.accepted,false);
 await assert.rejects(withWorkspaceTransaction(other.p,c=>c.query('SELECT app.close_evaluation($1,$2,$3,$4,$5,$6,$7)',[journal.id,2,'running',other.p.sessionId,randomUUID(),'acknowledge-unresolved',{}])));
 await assert.rejects(withWorkspaceTransaction(f.p,c=>c.query('SELECT app.finish_evaluation($1,$2,$3,$4,$5)',[journal.id,journal.lease_token,review.basisHash,{accepted:true,empirical:false},'completed'])));
});
test('lease expiration during a quote prevents dispatch and remains administratively closable',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',2));let calls=0;
 await assert.rejects(evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>{await testAdmin(c=>c.query('UPDATE app.ai_evaluation_run SET lease_until=clock_timestamp()-interval \'1 second\' WHERE workspace_id=$1',[f.p.workspaceId]));return .1;},run:async()=>{calls++;throw Error('Expired dispatch');}}));assert.equal(calls,0);
});
test('CLI rejects incomplete submitted outputs before creating any live journal',async()=>{
 const f=await fixture(),prefix='.runtime/06iah-missing-'+randomUUID(),files=['manifest','session','review','outputs'].map(n=>prefix+'-'+n+'.json');
 try{const value=input('live-owned',2),review=await prepareResearchEvaluation(f.p,value,dataset);fs.writeFileSync(files[0],JSON.stringify({datasetFile:'tests/fixtures/research-evaluation.json',input:value}));fs.writeFileSync(files[1],JSON.stringify({cookie:f.cookie,workspaceId:f.p.workspaceId}));fs.writeFileSync(files[2],JSON.stringify(review));fs.writeFileSync(files[3],JSON.stringify({fingerprint:review.basisHash,predictions:[await fixtureResearchPrediction(dataset.cases[0],'traditional')]}));
 const r=spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/evaluate-research.ts','--action=run','--manifest='+files[0],'--session='+files[1],'--review='+files[2],'--outputs='+files[3],'--live-owned=true'],{encoding:'utf8',windowsHide:true});assert.notEqual(r.status,0);assert.equal(JSON.parse(r.stdout).accepted,false);assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) n FROM app.ai_evaluation_run WHERE workspace_id=$1',[f.p.workspaceId])).rows[0].n)),0);
 }finally{for(const file of files)if(fs.existsSync(file))fs.unlinkSync(file);}
});
test('CLI closes from a fresh admin session after original expiry without changing receipts or attesting success',async()=>{
 const f=await fixture(),{value,review}=await prepared(f,input('live-owned',2));const run=await evaluateResearch(value,{principal:f.p,dataset,reviewToken:review.token,liveOptIn:true,quote:async()=>.1,run:async()=>({invalid:true}) as any});
 const signed=await requestAuth('sign-in/email',{email:f.email,password});assert.equal(signed.status,200);const cookie=cookies(signed),headers=new Headers({cookie});await identityAction(headers,{type:'switch',workspaceId:f.p.workspaceId});const fresh=await requirePrincipal(headers);assert.notEqual(fresh.sessionId,f.p.sessionId);
 await testAdmin(c=>c.query('UPDATE auth.session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',[f.p.sessionId]));
 const prefix='.runtime/06iah-close-'+randomUUID(),files=['manifest','session','review'].map(n=>prefix+'-'+n+'.json');try{
  fs.writeFileSync(files[0],JSON.stringify({datasetFile:'tests/fixtures/research-evaluation.json',input:input()}));fs.writeFileSync(files[1],JSON.stringify({cookie,workspaceId:f.p.workspaceId}));
  const call=(action:string,extra:string[]=[])=>spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/evaluate-research.ts','--action='+action,'--manifest='+files[0],'--session='+files[1],'--run-id='+run.runId,...extra],{encoding:'utf8',windowsHide:true});
  const prepared=call('prepare-close');assert.equal(prepared.status,0,prepared.stdout);fs.writeFileSync(files[2],prepared.stdout);const closed=call('close',['--review='+files[2]]);assert.equal(closed.status,0,closed.stdout);const report=JSON.parse(closed.stdout);assert.equal(report.state,'closed');assert.equal(report.report.accepted,false);assert.equal(report.report.costUsd,null);assert.equal(report.report.predictions,1);assert.equal(call('close',['--review='+files[2]]).status,0);
  const journal=await testAdmin(async c=>(await c.query('SELECT lease_token,closed_session FROM app.ai_evaluation_run WHERE id=$1',[run.runId])).rows[0]);assert.equal(journal.closed_session,fresh.sessionId);
  await withWorkspaceTransaction(fresh,c=>c.query('SELECT app.record_evaluation_receipt($1,$2,$3,$4,$5,$6,$7,$8)',[run.runId,journal.lease_token,dataset.cases[0].id,'hybrid','after-close','b'.repeat(64),.2,1]));const latest=await readResearchEvaluation(fresh,run.runId,dataset);assert.equal(latest.report.accepted,false);assert.equal(latest.report.predictions,2);assert.equal(latest.report.knownCostUsd,.2);assert.equal(latest.report.costUsd,null);
 }finally{for(const file of files)if(fs.existsSync(file))fs.unlinkSync(file);}
});
