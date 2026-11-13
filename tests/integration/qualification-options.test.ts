import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {configureProspectingTest,prospectingUser,grantTestLease,closeProspectingPools} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {executeWorkspaceCommand} from '../../src/server/workspaces/commands.ts';
import {prepareJob,confirmJob,listJobItems,getJob} from '../../src/server/prospecting/service.ts';
import {runQualification} from '../../src/server/prospecting/qualification.ts';
import {applyJobResults} from '../../src/server/prospecting/application.ts';
import {readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
configureProspectingTest();beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});
async function fixture(module:string|string[],options?:unknown,site?:string){
 const {p}=await prospectingUser(),listId=randomUUID(),leadId=randomUUID();await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:0,command:{type:'leads.import',list:{id:listId,name:'QA Options'},leads:[{id:leadId,listId,name:'[RE] Exemplo',email:'ana@example.com',...(site?{site}:{}),source:'MANUAL',qualification:'pending',favorite:false,createdAt:new Date().toISOString()}]}});
 const input={kind:'qualification',listId,leadIds:[leadId],modules:Array.isArray(module)?module:[module],summaryPolicy:'all',escalation:'off',...(options?{options}:{})},review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});return{p,job,input,listId,leadId,lease:await grantTestLease(p,job.id)};
}
test('qualification filters skip before provider calls and persist the exact reason',async()=>{
 const {p,job,lease}=await fixture('email',{onlyWithSite:true});let calls=0;
 await runQualification(lease,{collect:async()=>{calls++;throw Error('Should not collect');}});
 const item=(await listJobItems(p,job.id)).items[0];assert.equal(item.results[0].status,'skipped');assert.deepEqual(item.results[0].reasons,['NO_SITE']);assert.equal(calls,0);
 await runQualification(await grantTestLease(p,job.id));assert.equal((await getJob(p,job.id)).state,'completed');
});
const page={id:'public-e',url:'https://example.com/contato',text:'Contato publicado ana.nova@example.com',hash:'h',fetchedAt:'2026-10-26T21:00:00Z',truncated:false};
test('skip processed uses applied result anchors and changed source inputs block stale application',async()=>{
 const f=await fixture('email',undefined,'https://example.com');await runQualification(f.lease,{collect:async()=>[page]});await runQualification(await grantTestLease(f.p,f.job.id));
 const item=(await listJobItems(f.p,f.job.id)).items[0];await applyJobResults(f.p,f.job.id,{requestId:randomUUID(),itemIds:[item.id]});
 const input={...f.input,options:{skipProcessed:true}},review=await prepareJob(f.p,input),second=await confirmJob(f.p,{requestId:randomUUID(),input,reviewToken:review.token});let calls=0;
 await runQualification(await grantTestLease(f.p,second.id),{collect:async()=>{calls++;return[page];}});assert.equal(calls,0);assert.deepEqual((await listJobItems(f.p,second.id)).items[0].results[0].reasons,['ALREADY_PROCESSED']);
 const next=await fixture('email',undefined,'https://example.com');await runQualification(next.lease,{collect:async()=>[page]});await runQualification(await grantTestLease(next.p,next.job.id));
 const pending=(await listJobItems(next.p,next.job.id)).items[0],snap=await readWorkspaceSnapshot(next.p);
 await executeWorkspaceCommand(next.p,{requestId:randomUUID(),expectedRevision:snap.revision,command:{type:'lead.upsert',lead:{...snap.data.leads[0],site:'https://changed.example'}}});
 await assert.rejects(applyJobResults(next.p,next.job.id,{requestId:randomUUID(),itemIds:[pending.id]}),/mudou|fontes/i);
});
test('email assessment records unknown DNS as unverified with the checked address and timestamp',async()=>{
 const {p,job,lease}=await fixture('validateEmail');let calls=0;
 await runQualification(lease,{checkEmail:async()=>{calls++;return{format:true,dns:null,mailbox:'not_verified'};}});
 const result=(await listJobItems(p,job.id)).items[0].results[0];assert.equal(calls,1);assert.equal(result.emailAssessment?.address,'ana@example.com');assert.equal(result.emailAssessment?.domain,'unknown');assert.equal(result.emailAssessment?.mailbox,'unverified');assert.ok(result.emailAssessment?.checkedAt);
});
test('explicit no-email rule produces an applicable reviewed disqualification even when extraction found no email',async()=>{
 const f=await fixture('email',undefined,'https://example.com'),s=await readWorkspaceSnapshot(f.p);await executeWorkspaceCommand(f.p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...s.data.leads[0],email:''}}});
 const input={...f.input,options:{disqualifyNoEmail:true}},review=await prepareJob(f.p,input),job=await confirmJob(f.p,{requestId:randomUUID(),input,reviewToken:review.token});
 await runQualification(await grantTestLease(f.p,job.id),{collect:async()=>[{...page,text:'Página pública da empresa sem contato de e-mail.'}]});await runQualification(await grantTestLease(f.p,job.id));const item=(await listJobItems(f.p,job.id)).items[0];assert.equal(item.results[0].status,'pending_review');await applyJobResults(f.p,job.id,{requestId:randomUUID(),itemIds:[item.id]});assert.equal((await readWorkspaceSnapshot(f.p)).data.leads[0].qualification,'disqualified');
});
test('06B.7 a lead without site or CNPJ keeps each selected module independent and reports why it abstained',async t=>{
 Object.assign(process.env,{APIFY_CNPJ_ACTOR:'bigdavidson/brazil-cnpj-companies',APIFY_CNPJ_BUILD:'fixture-build'});t.after(()=>{delete process.env.APIFY_CNPJ_ACTOR;delete process.env.APIFY_CNPJ_BUILD;});
 const {p}=await prospectingUser(),listId=randomUUID(),leadId=randomUUID();
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:0,command:{type:'leads.import',list:{id:listId,name:'[RE] Maps parcial'},leads:[{id:leadId,listId,name:'[RE] Clínica Exemplo',phone:'+5541999990001',source:'MAPS',qualification:'pending',favorite:false,createdAt:new Date().toISOString()}]}});
 const input={kind:'qualification',listId,leadIds:[leadId],modules:['registry','email'],summaryPolicy:'all',escalation:'off'},review=await prepareJob(p,input);
 assert.deepEqual(review.blockers,[]);
 const job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});let starts=0;
 const deps={collect:async()=>[],apify:{start:async()=>{starts++;throw Error('No registry lookup without a CNPJ');}} as any};
 for(let i=0;i<3&&(await getJob(p,job.id)).state!=='completed';i++)await runQualification(await grantTestLease(p,job.id),deps);
 assert.equal((await getJob(p,job.id)).state,'completed');
 const results=(await listJobItems(p,job.id)).items[0].results;
 assert.deepEqual(results.map((r:any)=>[r.module,r.status,r.reasons]),[['registry','skipped',['NO_CNPJ']],['email','skipped',['NO_EVIDENCE']]]);
 assert.equal(starts,0);
 const lead=(await readWorkspaceSnapshot(p)).data.leads.find(l=>l.id===leadId)!;assert.equal(lead.qualification,'pending');assert.equal(lead.phone,'+5541999990001');
});
test('a reviewer applies some proposed fields of a lead and rejects the others',async()=>{
 const f=await fixture(['email','phone'],undefined,'https://example.com');
 const contact={...page,text:'Contato publicado ana.nova@example.com, telefone (41) 3013-6190 ou 3013-6190'};
 await runQualification(f.lease,{collect:async()=>[contact]});for(let i=0;i<5&&(await getJob(f.p,f.job.id)).state!=='completed';i++)await runQualification(await grantTestLease(f.p,f.job.id),{collect:async()=>[contact]});
 const item=(await listJobItems(f.p,f.job.id)).items[0];
 assert.deepEqual(item.results.map(r=>r.proposed),[{email:'ana.nova@example.com'},{phone:'+554130136190'}]);
 await applyJobResults(f.p,f.job.id,{requestId:randomUUID(),itemIds:[item.id],rejected:{[item.id]:['email']}});
 const lead=(await readWorkspaceSnapshot(f.p)).data.leads.find(l=>l.id===f.leadId)!;
 assert.equal(lead.email,'ana@example.com');assert.equal(lead.phone,'+554130136190');
});
