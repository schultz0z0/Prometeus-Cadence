import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createOpenwaClient,OpenwaClientError} from '../src/server/channels/openwa/client.ts';
import {createChannelClient} from '../src/client/channel-client.ts';
const session=JSON.parse(readFileSync(new URL('./fixtures/openwa/session.json',import.meta.url),'utf8'));
const sid=session.id,keyId='66666666-6666-4666-8666-666666666666';
const stored={id:'22222222-2222-4222-8222-222222222222',sessionId:sid,waMessageId:'true_15550000002@c.us_SAMPLE',chatId:'15550000002@c.us',direction:'outgoing',status:'read',timestamp:1792785600};

test('client binds fixed origin, exact owned session, scoped operator key and private webhook before start',async()=>{
 const requests:{path:string;body:any}[]=[];
 const api=createOpenwaClient({origin:'http://127.0.0.1:2785',apiKey:'fixture-admin',fetchImpl:async(url,init)=>{
  const target=new URL(String(url));assert.equal(target.origin,'http://127.0.0.1:2785');assert.equal(init?.redirect,'error');assert.equal(new Headers(init?.headers).get('x-api-key'),'fixture-admin');
  requests.push({path:target.pathname,body:init?.body?JSON.parse(String(init.body)):null});
  if(target.pathname==='/api/auth/api-keys')return Response.json({id:keyId,name:'pc-key-fixture',role:'operator',allowedSessions:[sid],isActive:true,apiKey:'fixture-operational-key'});
  if(target.pathname.endsWith('/webhooks'))return Response.json({id:keyId,url:'http://channel-ingress:3214/api/channel-webhooks/openwa/fixture-public',events:['message.received'],active:true});
  if(target.pathname.endsWith('/start'))return Response.json({success:true});
  if(target.search){assert.equal(target.searchParams.get('name'),session.name);return Response.json([session]);}
  return Response.json(session);
 }});
 assert.equal((await api.findOwnedSession(session.name))?.id,sid);
 assert.equal((await api.createSession(session.name)).id,sid);
 const scoped=await api.createScopedKey(sid,'pc-key-fixture');assert.equal(scoped.apiKey,'fixture-operational-key');
 await api.createWebhook(sid,'fixture-public','f'.repeat(64));await api.startSession(sid);
 assert.deepEqual(requests.find(r=>r.path==='/api/auth/api-keys')?.body,{name:'pc-key-fixture',role:'operator',allowedSessions:[sid]});
 const hook=requests.find(r=>r.path.endsWith('/webhooks'))?.body;assert.match(hook.url,/^http:\/\/channel-ingress:3214\/api\/channel-webhooks\/openwa\//);assert.ok(hook.events.includes('message.failed'));assert.ok(hook.events.includes('session.restriction'));assert.equal(hook.events.includes('session.qr'),false);
});
test('redirects, malformed and oversized responses fail safely without reflecting secrets',async()=>{
 for(const origin of ['http://user:password@localhost','https://example.test/path','https://example.test?key=secret','file:///tmp/gateway'])assert.throws(()=>createOpenwaClient({origin,apiKey:'fixture-secret'}));
 for(const response of [new Response('fixture-secret',{status:503}),new Response('x'.repeat(1048577)),Response.json({id:'wrong'})]){
  const api=createOpenwaClient({origin:'http://127.0.0.1:2785',apiKey:'fixture-secret',fetchImpl:async()=>response});
  await assert.rejects(api.readSession(sid),error=>error instanceof OpenwaClientError&&!String(error).includes('fixture-secret'));
 }
});
test('message REST direction and WhatsApp IDs are normalized, foreign sessions are rejected',async()=>{
 let foreign=false;
 const api=createOpenwaClient({origin:'http://127.0.0.1:2785',apiKey:'fixture-key',fetchImpl:async(url)=>{
  const target=new URL(String(url));assert.equal(target.searchParams.get('inlineMedia'),'false');
  return Response.json({messages:[{...stored,...(foreign?{sessionId:keyId}:{})}],total:1});
 }});
 const result=await api.readRemoteMessage(sid,stored.waMessageId);assert.equal(result?.remoteId,stored.waMessageId);assert.equal(result?.fromMe,true);
 const page=await api.readMessages(sid,{limit:20});assert.equal(page.items.length,1);assert.equal(page.nextCursor,null);
 foreign=true;await assert.rejects(api.readMessages(sid,{limit:20}),/OPENWA_PROTOCOL_INVALID/);
});
test('browser OpenWA creation retries the same command identity and disposal rejects late QR',async()=>{
 const bodies:any[]=[];let lost=true,release:((response:Response)=>void)|undefined;
 const client=createChannelClient({workspaceId:'workspace-a',transport:async(url,init)=>{
  assert.equal(new Headers(init?.headers).get('x-cadence-workspace'),'workspace-a');
  if(String(url).includes('openwa-qr'))return new Promise<Response>(resolve=>release=resolve);
  bodies.push(JSON.parse(String(init?.body)));if(lost){lost=false;throw Error('lost response');}return Response.json({phase:'provisioning'});
 }});
 const input={name:'Own WhatsApp',expectedRevision:0 as const};
 await assert.rejects(client.createOpenwa(input));await client.createOpenwa(input);assert.equal(bodies[0].requestId,bodies[1].requestId);
 const pending=client.openwaQr(sid,1);client.dispose();release!(Response.json({qrCode:'never-return-old-qr'}));await assert.rejects(pending,/workspace anterior/);
});
