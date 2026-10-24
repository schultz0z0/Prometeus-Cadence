import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHmac} from 'node:crypto';
import {authenticateOpenwaWebhook,normalizeOpenwaEvents} from '../src/server/channels/openwa/events.ts';
import type {IngressContext} from '../src/server/channels/ingress-contracts.ts';
const fixture=(name:string)=>JSON.parse(readFileSync(new URL(`./fixtures/openwa/${name}.json`,import.meta.url),'utf8'));
const session='11111111-1111-4111-8111-111111111111',secret='f'.repeat(64);
const ctx:IngressContext={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',workspaceId:'workspace-a',publicId:'fixture-public',provider:'openwa',revision:1,state:'ready',externalAccountId:session,identifiers:{sessionId:session},senders:[{externalId:'+15550000001',address:'+15550000001'}],credentialVersions:[{revision:1,identifiers:{sessionId:session},externalAccountId:session,credentials:{webhookSecret:secret}}]};
const signed=(body:string,signature?:string)=>new Request('http://channel-ingress:3214/api/channel-webhooks/openwa/fixture-public',{method:'POST',headers:{'content-type':'application/json','x-openwa-signature':signature??'sha256='+createHmac('sha256',secret).update(body).digest('hex')},body});
test('raw HMAC and exact session binding precede normalization; modified JSON and foreign assets fail',async()=>{
 const raw=JSON.stringify(fixture('inbound'));const deps={lookup:async()=>ctx,now:()=> '2026-10-23T12:01:00Z'};
 const batch=await authenticateOpenwaWebhook(signed(raw),'fixture-public',deps);assert.equal(batch.events.length,1);assert.equal(batch.events[0].kind,'inbound');assert.equal(batch.credentialRevision,1);
 await assert.rejects(authenticateOpenwaWebhook(signed(raw+' ','sha256='+createHmac('sha256',secret).update(raw).digest('hex')),'fixture-public',deps),{status:403});
 await assert.rejects(authenticateOpenwaWebhook(signed(JSON.stringify({...fixture('inbound'),sessionId:'22222222-2222-4222-8222-222222222222'})),'fixture-public',deps),{status:403});
 const oversized=signed('x'.repeat(1048577));let lookedUp=false;await assert.rejects(authenticateOpenwaWebhook(oversized,'fixture-public',{lookup:async()=>{lookedUp=true;return ctx;}}),{status:413});assert.equal(lookedUp,false);
});
test('individual text/media use connection identity, opaque LID stays opaque and groups, system, QR and own echoes are ignored',()=>{
 const inbound=fixture('inbound');const event=normalizeOpenwaEvents(inbound,ctx)[0];assert.equal(event.kind,'inbound');
 if(event.kind!=='inbound')throw Error();assert.equal(event.identity.scope,'openwa:'+ctx.id);assert.equal(event.identity.phone,'+15550000002');assert.equal(event.occurredAt,'2026-10-23T12:00:00.000Z');
 const lid=normalizeOpenwaEvents({...inbound,data:{...inbound.data,from:'123456789012345@lid',chatId:'123456789012345@lid'}},ctx)[0];assert.equal(lid.kind==='inbound'&&lid.identity.phone,null);
 const media=normalizeOpenwaEvents({...inbound,data:{...inbound.data,type:'image',body:'',hasMedia:true}},ctx)[0];assert.equal(media.kind==='inbound'&&media.mediaKind,'image');
 for(const data of [{...inbound.data,isGroup:true},{...inbound.data,chatId:'123@g.us'},{...inbound.data,type:'call'},{...inbound.data,fromMe:true}])assert.deepEqual(normalizeOpenwaEvents({...inbound,data},ctx),[]);
 assert.deepEqual(normalizeOpenwaEvents({...inbound,event:'session.qr',data:{qr:'never-store'}},ctx),[]);
});
test('ACK/failure event dedup is derived from signed message and status, not retry headers or delivery ID',()=>{
 const ack=fixture('ack'),a=normalizeOpenwaEvents(ack,ctx)[0],b=normalizeOpenwaEvents({...ack,deliveryId:'66666666-6666-4666-8666-666666666666',idempotencyKey:'changed'},ctx)[0];assert.equal(a.dedupKey,b.dedupKey);assert.equal(a.kind,'status');
 const failed={...ack,event:'message.failed',data:{...ack.data,status:'failed'}};assert.equal(normalizeOpenwaEvents(failed,ctx)[0].dedupKey,normalizeOpenwaEvents({...failed,event:'message.ack'},ctx)[0].dedupKey);
 const restricted=normalizeOpenwaEvents(fixture('restriction'),ctx)[0];assert.equal(restricted.kind,'session');assert.equal('qrCode' in restricted,false);
});
