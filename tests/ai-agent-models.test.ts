import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {writeAgentModels,writeApiKey,apiKeyView} from '../src/server/prospecting/ai/api-keys.ts';
import {conventionalConfig} from '../src/server/prospecting/ai/config.ts';
import {assertConventionalConfiguration} from '../src/server/prospecting/ai/json.ts';
function sandbox(fn:()=>void){
 const saved={...process.env},cwd=process.cwd(),dir=mkdtempSync(join(tmpdir(),'ai-agent-models-'));
 try{process.chdir(dir);Object.assign(process.env,{PLATFORM_AI_WORKSPACE_ID:'scope',PROSPECTING_ENABLED:'true',CHANNEL_ACTIVE_KEY_ID:'k1',CHANNEL_KEYRING_JSON:JSON.stringify({k1:randomBytes(32).toString('base64')})});
  writeApiKey('scope','gemini',0,{key:'stored-secret-1234',model:'gemini-a',models:['gemini-a','gemini-b']});fn();}
 finally{process.chdir(cwd);process.env=saved;rmSync(dir,{recursive:true,force:true});}
}
test('without a choice every agent keeps today\'s route, fingerprint included',()=>sandbox(()=>{
 for(const agent of ['prospecting','linkedin','assistant','sdr'] as const)assert.deepEqual(conventionalConfig('w',agent),conventionalConfig('w'));
}));
test('a chosen model changes only that agent',()=>sandbox(()=>{
 writeAgentModels('scope','gemini',1,{sdr:'gemini-b'});
 const sdr=conventionalConfig('w','sdr').conventional.gemini.route,base=conventionalConfig('w').conventional.gemini.route;
 assert.equal(sdr.model,'gemini-b');assert.notEqual(sdr.configFingerprint,base.configFingerprint);
 assert.deepEqual(conventionalConfig('w','prospecting'),conventionalConfig('w'));
 assert.deepEqual(apiKeyView('scope','gemini')?.agentModels,{sdr:'gemini-b'});
}));
test('a model the key does not offer is refused, and a stale one falls back to the default',()=>sandbox(()=>{
 assert.throws(()=>writeAgentModels('scope','gemini',1,{sdr:'gemini-z'}),/AI_AGENT_MODEL_INVALID/);
 writeAgentModels('scope','gemini',1,{sdr:'gemini-b'});
 writeApiKey('scope','gemini',2,{key:'stored-secret-5678',model:'gemini-a',models:['gemini-a']});
 assert.equal(apiKeyView('scope','gemini')?.agentModels?.sdr,undefined);
 assert.equal(conventionalConfig('w','sdr').conventional.gemini.route.model,'gemini-a');
}));
test('a queued prospecting job stops when its agent model changes',()=>sandbox(()=>{
 const route=conventionalConfig('w','prospecting').conventional.gemini.route;
 assert.doesNotThrow(()=>assertConventionalConfiguration({workspaceId:'w',route,agent:'prospecting'}));
 writeAgentModels('scope','gemini',1,{prospecting:'gemini-b'});
 assert.throws(()=>assertConventionalConfiguration({workspaceId:'w',route,agent:'prospecting'}),(e:any)=>e.code==='AI_CONFIGURATION_CHANGED');
}));
