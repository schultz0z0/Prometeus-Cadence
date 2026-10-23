import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {oauthStore} from '../src/server/ai-oauth/store.ts';
import {conventionalConfig} from '../src/server/prospecting/ai/config.ts';
import {runConventional} from '../src/server/prospecting/ai/conventional.ts';
import {generatePlanning} from '../src/server/planning/model.ts';
import {audienceResult,cadenceResult,planningSources} from './planning-fixtures.ts';
import type {PlanningInput} from '../src/domain/planning.ts';
test('ChatGPT OAuth alone executes qualification, summary and all planning tasks with no CLI or paid fallback',async()=>{
 const saved={...process.env},workspaceId='qa-oauth-'+randomUUID();
 Object.assign(process.env,{PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',CODEX_LOCAL_ENABLED:'false',CHANNEL_ACTIVE_KEY_ID:'qa',CHANNEL_KEYRING_JSON:JSON.stringify({qa:randomBytes(32).toString('base64')})});
 try{
  const row={...oauthStore.initial(workspaceId),state:'connected' as const,revision:1,model:'qa-model',clientId:'qa-client',subject:'qa-sub',expiresAt:Date.now()+3600000};oauthStore.save(workspaceId,row,{accessToken:'qa-oauth-access',refreshToken:'qa-refresh'});
  const route=conventionalConfig(workspaceId).conventional['chatgpt-oauth'].route,ctx={workspaceId,operationId:'qa-op',signal:new AbortController().signal,route};
  let calls=0;let payload:unknown;
  const fetcher:typeof fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer qa-oauth-access');const body=JSON.parse(String(init?.body));assert.equal(body.max_output_tokens,undefined);assert.equal(body.store,false);assert.equal(body.tools,undefined);return new Response('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}})+'\r\n\r\n');};
  const deps={fetcher,oauthSession:async()=> 'qa-oauth-access',runCodex:async()=>{throw Error('CLI must not run');}};
  const evidence=[{id:'page_1',url:'https://example.com/',text:'Atendemos clínicas.',fetchedAt:new Date().toISOString(),hash:'qa',truncated:false}];
  for(const task of ['qualify','summary'] as const){payload=task==='qualify'?{verdict:'fits',reason:'Atende clínicas.',evidenceIds:['page_1']}:{summary:'Atende clínicas.',evidenceIds:['page_1']};const result=await runConventional(ctx,{task,criteria:'Clínicas',facts:{},evidence},deps);assert.equal(result.task,task);assert.equal((result.task==='qualify'?result.decision:result.generation).usage.provider,'chatgpt-oauth');}
  const cases:[PlanningInput,unknown][]=[
   [{kind:'planning',task:'context_read',domain:'example.com',target:{kind:'company'}},{fields:{offer:{value:'Clínicas',quote:'Atendemos clínicas.',evidenceIds:['page_1']}}}],
   [{kind:'planning',task:'audience_plan',description:'Clínicas',channel:'whatsapp',timezone:'America/Sao_Paulo'},audienceResult()],
   [{kind:'planning',task:'cadence_options',listId:'list',objective:'Primeiro contato',channels:['WHATSAPP'],tone:'Direto',rhythm:'Curta',highlight:'',avoid:'',decisionMaker:''},cadenceResult()],
   [{kind:'planning',task:'message_preview',cadenceId:'cadence',stepId:'step',leadId:'lead'},{body:'Olá {{nome}}',evidenceIds:['page_1']}],
  ];
  for(const[request,value]of cases){payload=value;const result=await generatePlanning({...ctx,jobId:'qa-job'},{request,sources:planningSources(),context:null,product:null,base:{contextVersion:1,productVersion:null,workspaceRevision:1}},deps);assert.equal(result.proposal.task,request.task);assert.deepEqual(result.usage.units,{codexCalls:1});assert.equal(result.usage.provider,'chatgpt-oauth');}
  assert.equal(calls,6);
  const prior=conventionalConfig(workspaceId).conventional['chatgpt-oauth'].route.configFingerprint;oauthStore.save(workspaceId,{...row,revision:2},oauthStore.credentials(workspaceId,1));assert.notEqual(conventionalConfig(workspaceId).conventional['chatgpt-oauth'].route.configFingerprint,prior);
  await assert.rejects(()=>runConventional(ctx,{task:'summary',criteria:'Clínicas',evidence},deps),{code:'AI_CONFIGURATION_CHANGED'});assert.equal(calls,6);
 }finally{
  await unlink(join(process.cwd(),'.runtime','chatgpt-oauth','connection-'+createHash('sha256').update(workspaceId).digest('hex')+'.json'));
  for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);
 }
});
