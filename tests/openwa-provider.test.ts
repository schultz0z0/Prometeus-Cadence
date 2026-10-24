import test from 'node:test';import assert from 'node:assert/strict';
import {createOpenwaAdapter} from '../src/server/channels/providers/openwa.ts';import type {ProviderConfig} from '../src/server/channels/providers/contracts.ts';import type {PreparedSend} from '../src/domain/whatsapp.ts';
const sid='11111111-1111-4111-8111-111111111111',cid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config:ProviderConfig={provider:'openwa',connectionId:cid,revision:1,identifiers:{sessionId:sid},credentials:{apiKey:'fixture-operational-key'},sender:{id:'sender',connectionId:cid,provider:'openwa',address:'+15550000001',externalId:'+15550000001',identityScope:'openwa:'+cid,revision:1,ready:true,dailyLimit:20},templates:[]};
const send:PreparedSend={connectionId:cid,connectionRevision:1,senderId:'sender',identity:{scope:'openwa:'+cid,externalId:'15550000002@c.us',phone:'+15550000002'},content:{kind:'text',text:'Authorized fixture'},purpose:'service',traceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
process.env.OPENWA_API_ORIGIN='http://127.0.0.1:2785';
test('one text POST has a stable idempotency key, fixed origin and accepted receipt without delivery claim',async()=>{
 let posts=0;const adapter=createOpenwaAdapter(async(url,init)=>{posts++;assert.equal(String(url),`http://127.0.0.1:2785/api/sessions/${sid}/messages/send-text`);assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('idempotency-key'),send.traceId);assert.equal(new Headers(init?.headers).get('x-api-key'),'fixture-operational-key');assert.deepEqual(JSON.parse(String(init?.body)),{chatId:'15550000002@c.us',text:'Authorized fixture'});return Response.json({messageId:'true_15550000002@c.us_REMOTE',timestamp:1792785600},{status:201});});
 const result=await adapter.sendOnce(config,send);assert.equal(result.kind,'accepted');assert.equal('deliveryStatus' in result,false);assert.equal(posts,1);
 assert.equal((await adapter.sendOnce(config,{...send,traceId:undefined})).kind,'not_accepted');assert.equal(posts,1);
});
test('only proven pre-send rejections release; lost, malformed, conflict and opaque 4xx responses stay uncertain',async()=>{
 for(const [status,body,kind]of [[400,{code:'IDEMPOTENCY_KEY_INVALID'},'not_accepted'],[409,{code:'IDEMPOTENCY_KEY_IN_PROGRESS'},'uncertain'],[409,{code:'IDEMPOTENCY_OUTCOME_UNKNOWN'},'uncertain'],[422,{code:'IDEMPOTENCY_KEY_REUSED'},'uncertain'],[400,{message:'opaque engine refusal'},'uncertain'],[500,{code:'ENGINE_PAGE_ERROR'},'uncertain']] as const){let calls=0;const adapter=createOpenwaAdapter(async()=>{calls++;return Response.json(body,{status});});assert.equal((await adapter.sendOnce(config,send)).kind,kind);assert.equal(calls,1);}
 for(const fetchImpl of [async()=>{throw Error('transport lost');},async()=>new Response('bad',{status:201}),async()=>new Response('x'.repeat(1048577),{status:201})])assert.equal((await createOpenwaAdapter(fetchImpl).sendOnce(config,send)).kind,'uncertain');
});
test('REST lookup binds session, outgoing direction, timestamp and remote ID, preserving status evidence',async()=>{
 const stored={id:'22222222-2222-4222-8222-222222222222',sessionId:sid,waMessageId:'true_15550000002@c.us_REMOTE',chatId:'15550000002@c.us',direction:'outgoing',status:'read',timestamp:1792785600};
 const adapter=createOpenwaAdapter(async()=>Response.json({messages:[stored],total:1}));const result=await adapter.lookupMessage(config,stored.waMessageId);assert.equal(result?.kind,'accepted');if(result?.kind==='accepted'){assert.equal(result.evidence?.accountId,sid);assert.equal(result.evidence?.to,'15550000002@c.us');assert.equal(result.evidence?.status,'read');}
 for(const change of [{sessionId:cid},{direction:'incoming'},{timestamp:null}])assert.equal(await createOpenwaAdapter(async()=>Response.json({messages:[{...stored,...change}],total:1})).lookupMessage(config,stored.waMessageId),null);
});
