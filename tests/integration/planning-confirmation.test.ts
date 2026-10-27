import {configurePlatformAiTest} from './platform-ai-helpers.ts';
import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPlanningFixture} from './planning-helpers.ts';
import {grantTestLease,closeProspectingPools,testAdmin} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {preparePlanning,confirmPlanning} from '../../src/server/planning/service.ts';
import {runPlanning} from '../../src/server/planning/execution.ts';
import {preparePlanningSelection,confirmPlanningSelection} from '../../src/server/planning/confirmation.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {audienceResult,cadenceResult} from '../planning-fixtures.ts';
import type {PlanningInput,PlanningProposal} from '../../src/domain/planning.ts';
import type {Principal} from '../../src/domain/workspace.ts';
import {readAutomationDefinition} from '../../src/server/automations/repository.ts';
import {scheduleV2Schema,localDateAt} from '../../src/domain/schedule.ts';
beforeEach(resetRateLimits);after(closeProspectingPools);
async function setup(){
 const {p}=await createPlanningFixture();Object.assign(process.env,{OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture',PROSPECTING_WORKSPACE_DAILY_UNITS:'{"openaiCalls":20}',PROSPECTING_GLOBAL_DAILY_UNITS:'{"openaiCalls":100000}'});
 await configurePlatformAiTest(p);await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}});return p;
}
async function complete(p:Principal,input:PlanningInput){
 const review=await preparePlanning(p,input),job=await confirmPlanning(p,{requestId:randomUUID(),input,reviewToken:review.token});
 await runPlanning(await grantTestLease(p,job.id),{generate:async(ctx,data)=>({proposal:{...(input.task==='audience_plan'?{task:'audience_plan',...audienceResult()}:{task:'cadence_options',...cadenceResult()}),contractVersion:'planning-v1',jobId:ctx.jobId,base:data.base,evidenceIds:data.sources.map(s=>s.id),recommendedOptionId:null} as PlanningProposal,usage:{provider:'openai',operationId:ctx.operationId,units:{openaiCalls:1},costUsd:null,costKind:'unknown'}})});return job.id;
}
const audience:PlanningInput={kind:'planning',task:'audience_plan',description:'Clínicas',channel:'whatsapp',timezone:'America/Sao_Paulo'};
function edits(){const {id,description,marketSize,...rest}=audienceResult().options[0];return {...rest,title:'Título humano',dailyLimit:3};}
test('confirmed audience creates one list and two paused linked automations even after lost-response retry',async()=>{
 const p=await setup(),job=await complete(p,audience),selection={optionId:'option_1',edits:edits()},review=await preparePlanningSelection(p,job,selection),body={...selection,requestId:randomUUID(),reviewToken:review.token};
 const [a,b]=await Promise.all([confirmPlanningSelection(p,job,body),confirmPlanningSelection(p,job,body)]);assert.deepEqual(a,b);
 let s=await readWorkspaceSnapshot(p);assert.equal(s.data.lists.length,1);assert.equal(s.data.automations.length,2);assert.ok(s.data.automations.every(a=>a.status==='paused'&&a.dailyLimit===3));assert.ok(s.data.automations.every(a=>a.name.includes('Título humano')));
 const qualifier=s.data.automations.find(a=>a.source==='QUALIFY')!;assert.equal(qualifier.dependsOnAutomationId,a.automationIds![0]);assert.equal(qualifier.criteria,'Clínicas com atendimento presencial');
 assert.ok(review.edits&&typeof review.edits==='object'&&'schedules' in review.edits);assert.equal((review.edits.schedules as any).search.anchorDate,localDateAt(new Date().toISOString(),'America/Sao_Paulo'));
 for(const id of a.automationIds!){const definition=await readAutomationDefinition(p,id);assert.equal(scheduleV2Schema.safeParse(definition.schedule).success,true);}
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'preferences.update',preferences:{notifyEmail:false}}});
 assert.deepEqual(await confirmPlanningSelection(p,job,body),a);
 await assert.rejects(()=>confirmPlanningSelection(p,job,{...body,edits:{...selection.edits,title:'Outro'}}),{status:409});
 await assert.rejects(()=>preparePlanningSelection(p,job,{optionId:'option_2',edits:edits()}),{status:409});
});
test('foreign jobs and changed selection reviews cannot create objects; second insertion failure rolls back all',async()=>{
 const p=await setup(),job=await complete(p,audience),selection={optionId:'option_1',edits:edits()},review=await preparePlanningSelection(p,job,selection);
 const b=await setup();await assert.rejects(()=>preparePlanningSelection(b,job,selection),{status:404});
 await assert.rejects(()=>confirmPlanningSelection(p,job,{...selection,edits:{...selection.edits,title:'Alteração sem revisão'},requestId:randomUUID(),reviewToken:review.token}),{status:409});
 // Real PostgreSQL constraint injects a failure only for this workspace's second row.
 const ddl=await testAdmin(async c=>(await c.query("SELECT format('ALTER TABLE app.automation ADD CONSTRAINT planning_qa_rollback CHECK (workspace_id <> %L OR payload->>''source'' <> ''QUALIFY'') NOT VALID',$1::text) AS ddl",[p.workspaceId])).rows[0].ddl);
 await testAdmin(c=>c.query(ddl));
 try{await assert.rejects(()=>confirmPlanningSelection(p,job,{...selection,requestId:randomUUID(),reviewToken:review.token}));assert.equal((await readWorkspaceSnapshot(p)).data.lists.length,0);}
 finally{await testAdmin(c=>c.query('ALTER TABLE app.automation DROP CONSTRAINT planning_qa_rollback'));}
 assert.equal((await readWorkspaceSnapshot(p)).data.automations.length,0);
});
test('cadence confirmation preserves edited messages as one draft and cannot activate outreach',async()=>{
 const p=await setup();let s=await readWorkspaceSnapshot(p);const listId=randomUUID();
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.import',list:{id:listId,name:'Lista'},leads:[]}});s=await readWorkspaceSnapshot(p);
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'context.approve',profile:{...s.data.companyProfile,offer:'Agenda',idealCustomer:'Clínicas'}}});
 const input:PlanningInput={kind:'planning',task:'cadence_options',listId,objective:'Primeiro contato',channels:['WHATSAPP'],tone:'Direto',rhythm:'Padrão',highlight:'',avoid:'',decisionMaker:''},job=await complete(p,input);
 const selection={optionId:'option_1',edits:{name:'Minha cadência',steps:cadenceResult().options[0].steps.map(step=>({...step,body:'Texto humano {{nome}}'}))}},review=await preparePlanningSelection(p,job,selection),body={...selection,requestId:randomUUID(),reviewToken:review.token};
 const first=await confirmPlanningSelection(p,job,body);assert.deepEqual(await confirmPlanningSelection(p,job,body),first);
 const cadences=(await readWorkspaceSnapshot(p)).data.cadences;assert.equal(cadences.length,1);assert.equal(cadences[0].status,'draft');assert.equal(cadences[0].steps[0].body,'Texto humano {{nome}}');
 s=await readWorkspaceSnapshot(p);
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'cadence.saveDraft',cadence:{...cadences[0],name:'Editada no canvas',origin:{kind:'planning',jobId:'forged'}}}});
 assert.equal((await readWorkspaceSnapshot(p)).data.cadences[0].origin?.jobId,job);
});
test('generic manual creation cannot forge planning provenance and still saves paused',async()=>{
 const p=await setup(),job=await complete(p,audience),selection={optionId:'option_1',edits:edits()},review=await preparePlanningSelection(p,job,selection);
 await confirmPlanningSelection(p,job,{...selection,requestId:randomUUID(),reviewToken:review.token});let s=await readWorkspaceSnapshot(p);
 const automation={...s.data.automations[0],id:randomUUID(),name:'Manual',status:'active',origin:{kind:'planning',jobId:'forged'}};
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'automation.save',automation}});
 const saved=(await readWorkspaceSnapshot(p)).data.automations.find(a=>a.id===automation.id)!;assert.equal(saved.status,'paused');assert.deepEqual(saved.origin,{kind:'manual'});
});
