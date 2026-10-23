import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {createOAuthStore} from '../src/server/ai-oauth/store.ts';
test('workspace storage encrypts credentials, fences revisions and consumes callback state once',async()=>{
 process.env.CHANNEL_ACTIVE_KEY_ID='qa';process.env.CHANNEL_KEYRING_JSON=JSON.stringify({qa:randomBytes(32).toString('base64')});const root=await mkdtemp(join(tmpdir(),'cadence-oauth-')),store=createOAuthStore(root);
 try{
  const meta=store.initial('workspace-a');store.save('workspace-a',{...meta,state:'connected',revision:1},{accessToken:'qa-secret-access',refreshToken:'qa-secret-refresh'});
  assert.equal(store.read('workspace-b'),null);assert.equal(store.credentials('workspace-a',1).accessToken,'qa-secret-access');assert.throws(()=>store.credentials('workspace-a',0));
  const files=await readdir(root);for(const file of files)assert.ok(!(await readFile(join(root,file),'utf8')).includes('qa-secret'));
  store.putAttempt('a'.repeat(43),{workspaceId:'workspace-a',userId:'actor',sessionHash:'session',revision:1,connectionId:meta.id,expiresAt:Date.now()+60000},{nonce:'n',verifier:'v'});
  assert.equal(store.consumeAttempt('a'.repeat(43)).proof.verifier,'v');assert.throws(()=>store.consumeAttempt('a'.repeat(43)));
 }finally{await rm(root,{recursive:true,force:true});}
});
