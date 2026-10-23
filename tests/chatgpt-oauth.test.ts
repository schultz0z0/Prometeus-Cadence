import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createAuthorization,verifyIdentity,chatgptJson} from '../src/server/ai-oauth/protocol.ts';

test('direct ChatGPT registration uses fresh PKCE/state/nonce and no CLI client id',()=>{
 const a=createAuthorization('urn:uuid:11111111-1111-4111-8111-111111111111','http://127.0.0.1:3210/api/ai-oauth/chatgpt/callback'),b=createAuthorization('urn:uuid:11111111-1111-4111-8111-111111111111',a.redirectUri);
 const url=new URL(a.url);assert.equal(url.origin,'https://auth.openai.com');assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('resource'),'https://api.openai.com/v1');assert.ok(url.searchParams.get('scope')!.includes('chatgpt.tokens.use.direct'));assert.notEqual(a.state,b.state);assert.notEqual(a.verifier,b.verifier);assert.notEqual(a.nonce,b.nonce);
 assert.throws(()=>createAuthorization('urn:uuid:11111111-1111-4111-8111-111111111111','https://attacker.example/callback'));
});
test('identity rejects unsigned tokens, wrong nonce, wrong audience and expired grants',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'),key=await exportJWK(publicKey),keys={keys:[{...key,kid:'qa',alg:'RS256'}]};
 const token=await new SignJWT({nonce:'expected',email:'qa@example.org'}).setProtectedHeader({alg:'RS256',kid:'qa'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_qa').setSubject('qa-user').setExpirationTime('5m').sign(privateKey);
 assert.equal((await verifyIdentity(token,'oaiapp_qa','expected',keys)).subject,'qa-user');
 await assert.rejects(verifyIdentity(token,'oaiapp_other','expected',keys));await assert.rejects(verifyIdentity(token,'oaiapp_qa','different',keys));await assert.rejects(verifyIdentity('x.y.z','oaiapp_qa','expected',keys));
 const expired=await new SignJWT({nonce:'expected'}).setProtectedHeader({alg:'RS256',kid:'qa'}).setIssuer('https://auth.openai.com').setAudience('oaiapp_qa').setSubject('qa-user').setExpirationTime(1).sign(privateKey);await assert.rejects(verifyIdentity(expired,'oaiapp_qa','expected',keys));
});
test('OAuth inference requires completed SSE and never falls back or resends on late quota error',async()=>{
 let calls=0;const send=(events:unknown[])=>async(_url:unknown,init?:RequestInit)=>{calls++;const body=JSON.parse(String(init?.body));assert.equal(body.store,false);assert.equal(body.stream,true);assert.equal(body.max_output_tokens,undefined);return new Response(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});};
 const result=await chatgptJson('oauth-access','qa-model','Give JSON',{type:'object'},new AbortController().signal,send([{type:'response.output_text.delta',delta:'partial'},{type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}],usage:{input_tokens:2,output_tokens:3}}}]));assert.deepEqual(result.value,{ok:true});assert.equal(result.outputTokens,3);
 await assert.rejects(chatgptJson('oauth-access','qa-model','JSON',{},new AbortController().signal,send([{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),{code:'CHATGPT_QUOTA_EXCEEDED'});assert.equal(calls,2);
 await assert.rejects(chatgptJson('oauth-access','qa-model','JSON',{},new AbortController().signal,send([{type:'response.output_text.delta',delta:'{}'}])),{uncertain:true});
});
