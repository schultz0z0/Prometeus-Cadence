import test,{after,beforeEach} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {prospectingUser,configureProspectingTest,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import {saveAiPolicy,readAiPolicy} from '../../src/server/prospecting/ai/settings.ts';import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {getAiSettings} from '../../src/server/prospecting/ai/probe.ts';
import {configurePlatformAiTest} from './platform-ai-helpers.ts';import {prepareJob,confirmJob} from '../../src/server/prospecting/service.ts';import {generationInput} from './prospecting-helpers.ts';import {readConnectionCheck} from '../../src/server/prospecting/ai/connection.ts';import {conventionalConfig} from '../../src/server/prospecting/ai/config.ts';import {oauthStore} from '../../src/server/ai-oauth/store.ts';
configureProspectingTest();after(closeProspectingPools);
beforeEach(async()=>{delete process.env.PLATFORM_AI_WORKSPACE_ID;delete process.env.PLATFORM_AI_ADMIN_USER_IDS;});
const policy={mode:'conventional-only' as const,conventionalProvider:'openai' as const,jevEnabled:false};
test('a customer workspace owner cannot configure infrastructure or self-enroll as platform admin',async()=>{
 const a=await prospectingUser();await assert.rejects(()=>saveAiPolicy(a.p,{requestId:randomUUID(),expectedRevision:0,policy}),{status:403});
 await assert.rejects(()=>getAiSettings(a.p),{status:403});
 await assert.rejects(()=>withWorkspaceTransaction(a.p,c=>c.query("INSERT INTO app.ai_policy VALUES($1,1,'auto','openai',false)",[a.p.workspaceId])));
});
test('only explicitly designated platform administrators manage one shared policy and current role revocation wins',async()=>{
 const admin=await prospectingUser(),customer=await prospectingUser();
 await configurePlatformAiTest(admin.p);
 const body={requestId:randomUUID(),expectedRevision:0,policy};const saved=await saveAiPolicy(admin.p,body);assert.equal(saved.revision,1);
 assert.deepEqual(await withWorkspaceTransaction(customer.p,readAiPolicy),saved);
 await assert.rejects(()=>saveAiPolicy(customer.p,{requestId:randomUUID(),expectedRevision:1,policy}),{status:403});
 await assert.rejects(()=>withWorkspaceTransaction(customer.p,c=>c.query('UPDATE app.platform_ai_control SET admin_user_ids=$1',[[customer.p.userId]])));
 await assert.rejects(()=>getAiSettings(customer.p),{status:403});assert.equal((await getAiSettings(admin.p)).canManage,true);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[admin.p.workspaceId,admin.p.userId]));
 await assert.rejects(()=>saveAiPolicy(admin.p,{requestId:randomUUID(),expectedRevision:1,policy}),{status:403});
});
test('customers inherit the central attestation; an uncertain central probe shadows success and tenant checks cannot replace it',async()=>{
 const admin=await prospectingUser(),customer=await prospectingUser();await configurePlatformAiTest(admin.p);Object.assign(process.env,{OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});
 await saveAiPolicy(admin.p,{requestId:randomUUID(),expectedRevision:0,policy});const input=generationInput(),review=await prepareJob(admin.p,input),job=await confirmJob(admin.p,{requestId:randomUUID(),input,reviewToken:review.token});
 const route=conventionalConfig(admin.p.workspaceId).conventional.openai.route;
 await testAdmin(c=>c.query("INSERT INTO app.ai_connection_check(workspace_id,job_id,operation_id,provider,model,config_fingerprint,contract_version,outcome) VALUES($1,$2,$3,'openai',$4,$5,$6,'success')",[admin.p.workspaceId,job.id,randomUUID(),route.model,route.configFingerprint,route.contractVersion]));
 const inherited=await withWorkspaceTransaction(customer.p,c=>readConnectionCheck(c,route));assert.equal(inherited?.outcome,'success');assert.equal(inherited.jobId,'platform');
 await testAdmin(c=>c.query("UPDATE app.prospecting_job SET checkpoint=jsonb_set(checkpoint,'{execution}',jsonb_build_object('aiRoute',$3::jsonb)) WHERE workspace_id=$1 AND id=$2",[admin.p.workspaceId,job.id,JSON.stringify({conventional:route})]));
 await testAdmin(c=>c.query("INSERT INTO app.prospecting_attempt(workspace_id,job_id,id,step,provider,state,payload) VALUES($1,$2,$3,'probe','openai','uncertain','{}')",[admin.p.workspaceId,job.id,randomUUID()]));
 const blocked=await withWorkspaceTransaction(customer.p,c=>readConnectionCheck(c,route));assert.equal(blocked?.outcome,'uncertain');assert.equal(blocked.code,'CONVENTIONAL_ATTEMPT_UNRESOLVED');
});
test('shared OAuth runtime reads only the configured control connection rather than each customer namespace',async t=>{
 const admin=await prospectingUser(),customer=await prospectingUser();await configurePlatformAiTest(admin.p);
 const seen:string[]=[];t.mock.method(oauthStore,'read',(ws:string)=>{seen.push(ws);return ws===admin.p.workspaceId?{state:'connected',id:'fixture',revision:1,subject:'fixture',model:'fixture-model'}:null;});
 const a=conventionalConfig(admin.p.workspaceId).conventional['chatgpt-oauth'],b=conventionalConfig(customer.p.workspaceId).conventional['chatgpt-oauth'];assert.equal(a.configured,true);assert.deepEqual(b,a);assert.ok(seen.every(s=>s===admin.p.workspaceId));
});
test('changing the designated infrastructure namespace invalidates an otherwise identical credential route',async()=>{
 Object.assign(process.env,{PLATFORM_AI_WORKSPACE_ID:'control-a',OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});const old=conventionalConfig('customer').conventional.openai.route;
 process.env.PLATFORM_AI_WORKSPACE_ID='control-b';assert.notEqual(conventionalConfig('customer').conventional.openai.route.configFingerprint,old.configFingerprint);
});
