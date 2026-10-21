import test from 'node:test';import assert from 'node:assert/strict';import {writeFile} from 'node:fs/promises';
import {runConventional} from '../src/server/prospecting/ai/conventional.ts';
import {conventionalConfig} from '../src/server/prospecting/ai/config.ts';
import {suggestedQualification} from '../src/server/prospecting/ai/policy.ts';
import {diagnoseCodex} from '../src/server/prospecting/ai/diagnostics.ts';
const evidence=[{id:'e1',url:'https://example.com/',text:'Clínica odontológica com consultas.',fetchedAt:new Date().toISOString(),hash:'h',truncated:false}];
for(const provider of ['codex-local','openai','gemini'] as const)for(const task of ['qualify','summary','second_opinion'] as const)test(provider+' executes '+task+' as a validated factual proposal',async()=>{
 const saved={...process.env};Object.assign(process.env,{PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',CODEX_LOCAL_ENABLED:'true',CODEX_BINARY:process.execPath,CODEX_MODEL:'fixture',CODEX_TEST_WORKSPACE_IDS:'w',OPENAI_API_KEY:'private-fixture',OPENAI_MODEL:'fixture',GEMINI_API_KEY:'private-fixture',GEMINI_MODEL:'fixture'});
 try{let calls=0;const route=conventionalConfig('w').conventional[provider].route,payload=task==='qualify'?{verdict:'fits',reason:'Clínica com consultas.',evidenceIds:['e1']}:{summary:'Clínica odontológica.',evidenceIds:['e1']};
 const result=await runConventional({workspaceId:'w',operationId:'op',signal:new AbortController().signal,route,acquireSlot:async()=>true,releaseSlot:async()=>{}},{task,criteria:'Clínicas',evidence,facts:{}},{
 fetcher:async(url,init)=>{calls++;const body=JSON.parse(init!.body as string);assert.equal(String(url).includes('private-fixture'),false);assert.equal(body.tools,undefined);
 if(provider==='openai'){assert.equal(String(url),'https://api.openai.com/v1/responses');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}],usage:{input_tokens:12,output_tokens:4}});}
 assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/v1beta/models/fixture:generateContent'));assert.equal(body.generationConfig.responseFormat.text.mimeType,'APPLICATION_JSON');return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(payload)}]}}],usageMetadata:{promptTokenCount:12,candidatesTokenCount:4}});},
 runCodex:async(invocation,input)=>{calls++;assert.equal(invocation.shell,false);assert.ok(input.includes('untrustedEvidence'));assert.ok(!JSON.stringify(invocation.env).includes('private-fixture'));await writeFile(invocation.args[invocation.args.indexOf('--output-last-message')+1],JSON.stringify(payload));return '{"type":"turn.completed"}';}
 });assert.equal(calls,1);
 if(result.task==='qualify'){assert.equal(result.decision.confidence,null);assert.equal(suggestedQualification(result.decision),'qualified');assert.equal(suggestedQualification({...result.decision,evidenceIds:[]}),'pending');}else assert.equal(result.generation.summary,'Clínica odontológica.');
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('no evidence abstains without a call and malformed or refused output never falls back',async()=>{
 const saved={...process.env};Object.assign(process.env,{PROSPECTING_ENABLED:'true',OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});
 try{const route=conventionalConfig('w').conventional.openai.route,ctx={workspaceId:'w',operationId:'op',signal:new AbortController().signal,route};let calls=0;
 const empty=await runConventional(ctx,{task:'qualify',criteria:'x',facts:{},evidence:[]},{fetcher:async()=>{calls++;throw Error();}});assert.equal(calls,0);assert.equal(empty.task==='qualify'&&empty.decision.verdict,'insufficient_evidence');
 for(const output of [[{type:'message',content:[{type:'refusal',refusal:'No'}]}],[{type:'function_call',name:'shell'}],[{type:'message',content:[{type:'output_text',text:'{}'}]}],[{type:'message',content:[{type:'output_text',text:JSON.stringify({verdict:'fits',reason:'x',evidenceIds:['foreign']})}]}]]){
 calls=0;await assert.rejects(()=>runConventional(ctx,{task:'qualify',criteria:'x',facts:{},evidence},{fetcher:async()=>{calls++;return Response.json({status:'completed',output});}}),(e:any)=>e.uncertain===true);assert.equal(calls,1);}
 for(const status of [401,402,403,429,500]){calls=0;await assert.rejects(()=>runConventional(ctx,{task:'summary',criteria:'x',evidence},{fetcher:async()=>{calls++;return new Response('',{status});}}));assert.equal(calls,1);}
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('Codex diagnostics returns only bounded authentication status without raw identity or tokens',async()=>{
 const saved={...process.env};Object.assign(process.env,{CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',CODEX_LOCAL_ENABLED:'true',CODEX_BINARY:process.execPath});
 try{const d=await diagnoseCodex(async args=>args[0]==='--version'?'codex-cli 0.163.0-alpha.10.2':'Logged in using ChatGPT\nprivate-account-token');assert.equal(d.authenticated,true);assert.equal(d.authMode,'chatgpt');assert.ok(!JSON.stringify(d).includes('private-account-token'));
 process.env.CADENCE_RUNTIME_MODE='hosted';let calls=0;assert.equal((await diagnoseCodex(async()=>{calls++;return '';})).available,false);assert.equal(calls,0);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
test('Gemini blocked truncated or tool responses remain uncertain and network loss is never retried',async()=>{
 const saved={...process.env};Object.assign(process.env,{PROSPECTING_ENABLED:'true',GEMINI_API_KEY:'fixture',GEMINI_MODEL:'fixture'});
 try{const ctx={workspaceId:'w',operationId:'op',signal:new AbortController().signal,route:conventionalConfig('w').conventional.gemini.route};
 for(const payload of [{promptFeedback:{blockReason:'SAFETY'}},{candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{}'}]}}]},{candidates:[{finishReason:'STOP',content:{parts:[{functionCall:{name:'shell'}}]}}]}]){let calls=0;await assert.rejects(()=>runConventional(ctx,{task:'summary',criteria:'x',evidence},{fetcher:async()=>{calls++;return Response.json(payload);}}),(e:any)=>e.uncertain===true);assert.equal(calls,1);}
 let calls=0;await assert.rejects(()=>runConventional(ctx,{task:'summary',criteria:'x',evidence},{fetcher:async()=>{calls++;throw Error('network');}}),(e:any)=>e.uncertain===true);assert.equal(calls,1);
 }finally{for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);}
});
