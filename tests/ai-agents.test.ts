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
