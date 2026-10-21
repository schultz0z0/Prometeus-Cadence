import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {generatePlanning} from '../src/server/planning/model.ts';
import {rankPlanningOptions} from '../src/server/planning/ranking.ts';
import {conventionalConfig} from '../src/server/prospecting/ai/config.ts';
import {audienceResult,cadenceResult,planningSources} from './planning-fixtures.ts';
import type {PlanningInput} from '../src/domain/planning.ts';
const base={contextVersion:1,productVersion:null,workspaceRevision:1};
const cases:[PlanningInput,unknown][]=[
 [{kind:'planning',task:'context_read',domain:'example.com',target:{kind:'company'}},{fields:{offer:{value:'Clínicas',quote:'Atendemos clínicas.',evidenceIds:['page_1']}}}],
 [{kind:'planning',task:'audience_plan',description:'Clínicas',channel:'whatsapp',timezone:'America/Sao_Paulo'},audienceResult()],
 [{kind:'planning',task:'cadence_options',listId:'list',objective:'Primeiro contato',channels:['WHATSAPP'],tone:'Direto',rhythm:'Curta',highlight:'',avoid:'',decisionMaker:''},cadenceResult()],
 [{kind:'planning',task:'message_preview',cadenceId:'cadence',stepId:'step',leadId:'lead'},{body:'Olá {{nome}}',evidenceIds:['page_1']}],
];
for(const provider of ['codex-local','openai','gemini'] as const)test(`${provider} returns one bounded planning result per task without another provider`,async()=>{
 const saved={...process.env};Object.assign(process.env,{PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',CODEX_LOCAL_ENABLED:'true',CODEX_BINARY:process.execPath,CODEX_MODEL:'fixture',CODEX_TEST_WORKSPACE_IDS:'w',OPENAI_API_KEY:'private-fixture',OPENAI_MODEL:'fixture',GEMINI_API_KEY:'private-fixture',GEMINI_MODEL:'fixture'});
 try{
  for(const [request,payload] of cases){let calls=0;const route=conventionalConfig('w').conventional[provider].route;
   const result=await generatePlanning({workspaceId:'w',jobId:'job',operationId:'op',signal:new AbortController().signal,route,acquireSlot:async()=>true,releaseSlot:async()=>{}},{request,sources:planningSources(),context:null,product:null,base},{
    fetcher:async(url,init)=>{calls++;const body=JSON.parse(init!.body as string);assert.equal(body.tools,undefined);assert.ok(!JSON.stringify(body).includes('private-fixture'));assert.ok(!JSON.stringify(body).includes(route.configFingerprint));
     if(provider==='openai'){assert.equal(body.max_output_tokens,8192);assert.equal(body.store,false);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]});}
     assert.equal(body.generationConfig.maxOutputTokens,8192);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(payload)}]}}]});},
    runCodex:async(invocation,input)=>{calls++;assert.ok(input.includes('untrustedSources'));assert.equal(invocation.shell,false);await writeFile(invocation.args[invocation.args.indexOf('--output-last-message')+1],JSON.stringify(payload));return '{"type":"turn.completed"}';},
   });
   assert.equal(calls,1);assert.equal(result.proposal.jobId,'job');assert.equal(result.proposal.contractVersion,'planning-v1');assert.equal(result.proposal.recommendedOptionId,null);
   if(result.proposal.task==='audience_plan'){assert.equal(result.proposal.options.length,3);assert.ok(result.proposal.options.every(o=>o.marketSize===null));}
   if(result.proposal.task==='cadence_options')assert.deepEqual(result.proposal.options[0].steps.map(s=>s.delayDays),[1,2,2]);
  }
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('invalid planning facts and malformed content remain uncertain without corrective inference',async()=>{
 const saved={...process.env};Object.assign(process.env,{PROSPECTING_ENABLED:'true',OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});
 try{let calls=0;await assert.rejects(()=>generatePlanning({workspaceId:'w',jobId:'job',operationId:'op',route:conventionalConfig('w').conventional.openai.route,signal:new AbortController().signal},{request:cases[0][0],sources:planningSources(),context:null,product:null,base},{fetcher:async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({fields:{offer:{value:'Preço',quote:'R$99',evidenceIds:['foreign']}}})}]}]});}}),(e:any)=>e.uncertain===true);assert.equal(calls,1);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('JEV ranks the three fixed choices only and abstention is not fabricated confidence',async()=>{
 for(const choice of ['option_2','insufficient_evidence','foreign']){
  let calls=0;const action=()=>rankPlanningOptions({operationId:'rank',signal:new AbortController().signal,credential:'private-fixture',fetcher:async(url,init)=>{calls++;assert.equal(String(url),'https://openrouter.ai/api/alpha/decisions');const body=JSON.parse(init!.body as string);assert.equal(body.model,'typesafe/jev-1.13');assert.deepEqual(Object.keys(body.questions.recommendation.criteria),['option_1','option_2','option_3','insufficient_evidence']);assert.equal(body.tools,undefined);return Response.json({answers:{recommendation:{type:'choice',choice}},usage:{cost:0.001,prompt_tokens:20,completion_tokens:2}});}},{task:'audience_plan',options:audienceResult().options as any,criteria:'Clínicas'});
  if(choice==='foreign')await assert.rejects(action,(e:any)=>e.uncertain===true);
  else{const result=await action();assert.equal(result.recommendedOptionId,choice==='option_2'?'option_2':null);assert.equal(result.confidence,null);assert.deepEqual(result.usage.units,{jevCalls:1});}
  assert.equal(calls,1);
 }
});

test('audience generation cannot silently change the reviewed channel or timezone',async()=>{
 const saved={...process.env};Object.assign(process.env,{PROSPECTING_ENABLED:'true',OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});
 try{for(const mutate of [(v:any)=>v.options[0].channel='email',(v:any)=>v.options[0].schedules.search.timezone='UTC']){
  const payload=audienceResult();mutate(payload);
  await assert.rejects(()=>generatePlanning({workspaceId:'w',jobId:'job',operationId:'op',route:conventionalConfig('w').conventional.openai.route,signal:new AbortController().signal},{request:cases[1][0],sources:[],context:null,product:null,base},{fetcher:async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]})}),(e:any)=>e.uncertain===true);
 }}finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
