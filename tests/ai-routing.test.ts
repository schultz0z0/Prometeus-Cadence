import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveAiRoute,type AiPolicy,type AiRuntime,type ConnectionCheck} from '../src/domain/ai-routing.ts';
import {conventionalConfig} from '../src/server/prospecting/ai/config.ts';
const now=1800000000000;
for(const provider of ['codex-local','openai','gemini'] as const){
  test(provider+' runs alone without JEV, prioritizes JEV only with a validated companion, and obeys explicit routing',()=>{
    const route={provider,model:'fixture-model',configFingerprint:'config-a',contractVersion:'conventional-v1' as const};
    const runtime={conventional:{[provider]:{configured:true,route}},jevReady:false} as AiRuntime;
    const policy:AiPolicy={revision:1,mode:'auto',conventionalProvider:provider,jevEnabled:true};
    assert.equal(resolveAiRoute(policy,runtime,null,now).route?.decisionProvider,provider);
    runtime.jevReady=true;
    assert.ok(resolveAiRoute(policy,runtime,null,now).blockers.length);
    const check:ConnectionCheck={...route,checkedAt:new Date(now-1000).toISOString(),outcome:'success',jobId:'j',operationId:'op'};
    assert.equal(resolveAiRoute(policy,runtime,check,now).route?.decisionProvider,'jev');
    assert.deepEqual(resolveAiRoute(policy,runtime,check,now).blockers,[]);
    assert.equal(resolveAiRoute({...policy,mode:'conventional-only'},runtime,null,now).route?.decisionProvider,provider);
    assert.equal(resolveAiRoute({...policy,jevEnabled:false},runtime,null,now).route?.decisionProvider,provider);
    for(const invalid of [{...check,outcome:'failed' as const},{...check,configFingerprint:'old'},{...check,model:'other'},{...check,checkedAt:new Date(now-86400000).toISOString()}])assert.ok(resolveAiRoute(policy,runtime,invalid,now).blockers.length);
    runtime.jevReady=false;
    assert.ok(resolveAiRoute({...policy,mode:'hybrid-required'},runtime,check,now).blockers.length);
    assert.ok(resolveAiRoute({...policy,conventionalProvider:null},runtime,check,now).blockers.length);
    runtime.conventional[provider].configured=false;
    assert.ok(resolveAiRoute(policy,runtime,check,now).blockers.length);
  });
}
test('conventional configuration requires explicit provider credentials and binds the selected model without leaking keys',()=>{
  const keys=['OPENAI_API_KEY','OPENAI_MODEL','GEMINI_API_KEY','GEMINI_MODEL'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    Object.assign(process.env,{OPENAI_API_KEY:'private-fixture-key',OPENAI_MODEL:'fixture-model',GEMINI_API_KEY:'',GEMINI_MODEL:''});
    const a=conventionalConfig('workspace');assert.equal(a.conventional.openai.configured,true);assert.equal(a.conventional.gemini.configured,false);assert.ok(!JSON.stringify(a).includes('private-fixture-key'));
    process.env.OPENAI_MODEL='different-model';assert.notEqual(conventionalConfig('workspace').conventional.openai.route.configFingerprint,a.conventional.openai.route.configFingerprint);
  }finally{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;}
});
