import test from 'node:test';import assert from 'node:assert/strict';
const env={PLATFORM_AI_WORKSPACE_ID:'w',PROSPECTING_ENABLED:'true',CADENCE_RUNTIME_MODE:'local',BETTER_AUTH_URL:'http://127.0.0.1:3210',GEMINI_API_KEY:'private-fixture',GEMINI_MODEL:'gemini-fixture'};
async function withEnv<T>(fn:()=>Promise<T>){const saved={...process.env};Object.assign(process.env,env);try{return await fn();}finally{process.env=saved;}}
test('every AI operation belongs to exactly one agent',async()=>{
 const {AI_AGENTS,AI_OPERATIONS}=await import('../src/domain/ai-agents.ts');
 for(const op of AI_OPERATIONS)assert.equal(Object.values(AI_AGENTS).filter(a=>a.operations.includes(op)).length,1,op);
 assert.deepEqual(Object.keys(AI_AGENTS),['prospecting','linkedin','assistant','sdr']);
 assert.deepEqual(Object.values(AI_AGENTS).map(a=>a.label),['Prospecção','LinkedIn','Assistente','Agente SDR']);
});
test('an agent cannot run another agent\'s operation',async()=>{
 const {assertAgentOperation}=await import('../src/domain/ai-agents.ts');
 assert.throws(()=>assertAgentOperation('sdr','planning'),/AI_AGENT_OPERATION/);
 assert.doesNotThrow(()=>assertAgentOperation('sdr','sdr-turn'));
});
test('the AI call refuses a foreign operation before reaching the provider',()=>withEnv(async()=>{
 const {conventionalConfig}=await import('../src/server/prospecting/ai/config.ts');const {runConventionalJson}=await import('../src/server/prospecting/ai/json.ts');
 let calls=0;
 await assert.rejects(runConventionalJson({operationId:'op',workspaceId:'w',signal:AbortSignal.timeout(5000),route:conventionalConfig('w').conventional.gemini.route,agent:'sdr',operation:'planning'},
  {prompt:'p',schema:{},maxOutputTokens:4096,parse:v=>v},{fetcher:async()=>{calls++;return Response.json({});}}),(e:any)=>e.code==='AI_AGENT_OPERATION');
 assert.equal(calls,0);
}));
test('every AI usage record names the agent that spent it',()=>withEnv(async()=>{
 const {conventionalConfig}=await import('../src/server/prospecting/ai/config.ts');const {runConventionalJson}=await import('../src/server/prospecting/ai/json.ts');
 const r=await runConventionalJson({operationId:'op',workspaceId:'w',signal:AbortSignal.timeout(5000),route:conventionalConfig('w').conventional.gemini.route,agent:'sdr',operation:'sdr-turn'},
  {prompt:'p',schema:{},maxOutputTokens:4096,parse:v=>v},{fetcher:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{}'}]}}]})});
 assert.equal(r.usage.agent,'sdr');
}));
test('each agent points at instruction files that exist',async()=>{
 const {AI_AGENTS}=await import('../src/domain/ai-agents.ts');const {existsSync}=await import('node:fs');
 for(const a of Object.values(AI_AGENTS))for(const f of a.instructions)assert.ok(existsSync(f),f);
});
// 16/11/2026: a qualification call came back without a result once (Gemini thinking spends the output budget, as in the SDR).
test('lead qualification gives the model the larger output budget',()=>withEnv(async()=>{
 const {conventionalConfig}=await import('../src/server/prospecting/ai/config.ts');const {runConventional}=await import('../src/server/prospecting/ai/conventional.ts');
 let sent:any=null;
 const evidence=[{id:'e1',url:'https://empresa.example',text:'Empresa de logística em Curitiba com 40 funcionários.',hash:'h',fetchedAt:'2026-11-14T00:00:00Z',truncated:false}];
 await runConventional({operationId:'op',workspaceId:'w',signal:AbortSignal.timeout(5000),route:conventionalConfig('w').conventional.gemini.route,agent:'prospecting',operation:'qualify'} as any,
  {task:'qualify',criteria:'Logística com mais de 20 pessoas',evidence,facts:{},company:{name:'P'},product:{name:'X'},language:'pt-BR'} as any,
  {fetcher:async(_u:any,init:any)=>{sent=JSON.parse(init.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({verdict:'fit',reason:'Porte e setor batem.',evidenceIds:['e1']})}]}}]});}}).catch(()=>undefined);
 assert.equal(sent?.generationConfig?.maxOutputTokens,8192);
}));
