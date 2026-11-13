import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {apiKeyView,providerApiKey,writeApiKey} from '../src/server/prospecting/ai/api-keys.ts';
import {conventionalConfig} from '../src/server/prospecting/ai/config.ts';
test('a stored platform key is encrypted, overrides the environment, is scoped to the platform and falls back when removed',()=>{
 const saved={...process.env},cwd=process.cwd(),dir=mkdtempSync(join(tmpdir(),'ai-keys-'));
 try{
  process.chdir(dir);
  Object.assign(process.env,{PLATFORM_AI_WORKSPACE_ID:'scope-a',CHANNEL_ACTIVE_KEY_ID:'k1',CHANNEL_KEYRING_JSON:JSON.stringify({k1:randomBytes(32).toString('base64')}),GEMINI_API_KEY:'env-key',GEMINI_MODEL:'env-model'});
  assert.equal(providerApiKey('gemini'),'env-key');
  const view=writeApiKey('scope-a','gemini',0,{key:'stored-secret-1234',model:'gemini-fixture',models:['gemini-fixture']});
  assert.equal(view?.hint,'1234');assert.equal(view?.revision,1);
  assert.ok(!readFileSync(join(dir,'.runtime','ai-keys','gemini.json'),'utf8').includes('stored-secret'));
  assert.equal(providerApiKey('gemini'),'stored-secret-1234');
  assert.equal(conventionalConfig('customer').conventional.gemini.route.model,'gemini-fixture');
  assert.throws(()=>writeApiKey('scope-a','gemini',0,null),/AI_KEY_CHANGED/);
  process.env.PLATFORM_AI_WORKSPACE_ID='scope-b';assert.equal(providerApiKey('gemini'),'env-key');assert.equal(apiKeyView('scope-b','gemini'),null);
  process.env.PLATFORM_AI_WORKSPACE_ID='scope-a';writeApiKey('scope-a','gemini',1,null);
  assert.equal(providerApiKey('gemini'),'env-key');assert.equal(conventionalConfig('customer').conventional.gemini.route.model,'env-model');
 }finally{process.chdir(cwd);process.env=saved;rmSync(dir,{recursive:true,force:true});}
});
