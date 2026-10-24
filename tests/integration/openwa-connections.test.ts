import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {readFileSync} from 'node:fs';
import {channelRequestHandler} from '../../src/server/channels/http.ts';import {getPools} from '../../src/server/db/pool.ts';
import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import {runOpenwaMaintenanceTick,readOpenwaQr,requestOpenwaDisconnect,requestOpenwaReconnect,readOpenwaConnection} from '../../src/server/channels/openwa/lifecycle.ts';
import {whatsappUser,testAdmin,openwaInput,openwaFixture,openwaGatewayDouble} from './openwa-helpers.ts';
import {base} from './helpers.ts';
after(async()=>{await Promise.all([getPools().close(),closeDispatchPool()]);});
const qr=JSON.parse(readFileSync(new URL('../fixtures/openwa/qr.json',import.meta.url),'utf8'));
const sessionFixture=JSON.parse(readFileSync(new URL('../fixtures/openwa/session.json',import.meta.url),'utf8'));
const request=(u:Awaited<ReturnType<typeof whatsappUser>>,path:string,body?:unknown)=>new Request(base+path,{method:body?'POST':'GET',headers:u.headers,...(body?{body:JSON.stringify(body)}:{})});

test('managed HTTP checks tenant, role, revision and strict body before gateway I/O, QR is no-store',async t=>{
 const u=await whatsappUser(),b=await whatsappUser(),input={...openwaInput(),expectedRevision:0};
 let calls=0,paired=false,session:any=null,keys:any[]=[],hooks:any[]=[],starts=0;
 process.env.OPENWA_API_ORIGIN='http://127.0.0.1:2785';process.env.OPENWA_ADMIN_API_KEY='fixture-admin-key';
 const realFetch=fetch;
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  const target=new URL(String(url));if(target.origin!==process.env.OPENWA_API_ORIGIN)return realFetch(url as string,init);calls++;
  const method=init?.method??'GET',body=init?.body?JSON.parse(String(init.body)):null;
  if(target.pathname==='/api/sessions'&&method==='GET')return Response.json(session?[session]:[]);
  if(target.pathname==='/api/sessions'&&method==='POST'){session={...sessionFixture,id:randomUUID(),name:body.name,status:'created',phone:null,engineLoaded:false};return Response.json(session,{status:201});}
  if(target.pathname==='/api/auth/api-keys'&&method==='GET')return Response.json(keys);
  if(target.pathname==='/api/auth/api-keys'&&method==='POST'){const key={id:randomUUID(),...body,isActive:true};keys.push(key);return Response.json({...key,apiKey:'fixture-operational-key'});}
  if(target.pathname.startsWith('/api/auth/api-keys/')&&method==='DELETE'){keys=keys.filter(k=>k.id!==target.pathname.split('/').at(-1));return new Response(null,{status:204});}
  if(target.pathname.endsWith('/webhooks')&&method==='GET')return Response.json(hooks);
  if(target.pathname.endsWith('/webhooks')&&method==='POST'){const hook={id:randomUUID(),url:body.url,events:body.events,active:true};hooks.push(hook);return Response.json(hook);}
  if(target.pathname.endsWith('/start')){starts++;session={...session,status:'qr_ready',engineLoaded:true};return Response.json(session);}
  if(target.pathname.endsWith('/qr'))return Response.json(qr);
  if(target.pathname.endsWith('/logout')){session={...session,status:'disconnected',engineLoaded:false};return Response.json({success:true});}
  if(target.pathname===`/api/sessions/${session?.id}`)return Response.json({...session,...(paired?{status:'ready',phone:'15550000001'}:{})});
  throw Error('Unexpected gateway fixture request');
 });
 const created=await channelRequestHandler(request(u,'/api/channels/openwa',input),{id:'openwa'});assert.equal(created.status,200);const view=await created.json(),id=view.connection.id;
 assert.equal(calls,0);
 assert.equal((await channelRequestHandler(request(u,'/api/channels/openwa',{...input,requestId:randomUUID(),sessionId:randomUUID()}),{id:'openwa'})).status,422);
 assert.equal((await channelRequestHandler(request(b,`/api/channels/${id}/openwa-qr?revision=1`),{id,action:'openwa-qr'})).status,404);assert.equal(calls,0);
 const changed=request(u,`/api/channels/${id}/openwa-status`);changed.headers.set('x-cadence-workspace',b.p.workspaceId);assert.equal((await channelRequestHandler(changed,{id,action:'openwa-status'})).status,409);
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 assert.equal(starts,1);assert.equal(hooks.length,1);assert.equal(keys.length,1);
 const response=await channelRequestHandler(request(u,`/api/channels/${id}/openwa-qr?revision=1`),{id,action:'openwa-qr'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).qrCode,qr.qrCode);
 const status=await channelRequestHandler(request(u,`/api/channels/${id}/openwa-status`),{id,action:'openwa-status'});const publicText=await status.text();assert.equal(publicText.includes(session.id),false);assert.equal(publicText.includes('fixture-operational-key'),false);
 paired=true;await runOpenwaMaintenanceTick({now:new Date(Date.now()+31000).toISOString(),maxConnections:1});
 const ready=await(await channelRequestHandler(request(u,`/api/channels/${id}/openwa-status`),{id,action:'openwa-status'})).json();assert.equal(ready.phase,'ready');assert.equal(ready.connection.senders[0].ready,true);
 const command={requestId:randomUUID(),expectedRevision:1};const off=await requestOpenwaDisconnect(u.p,id,command);assert.equal(off.connection.senders[0].ready,false);assert.equal(off.connection.state,'disconnected');assert.notEqual(off.phase,'disconnected');
 assert.deepEqual(await requestOpenwaDisconnect(u.p,id,command),off);
 await assert.rejects(readOpenwaQr(u.p,id,1),{status:409});
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:3});assert.equal(keys.length,0);
 assert.equal((await(await channelRequestHandler(request(u,`/api/channels/${id}/openwa-status`),{id,action:'openwa-status'})).json()).phase,'disconnected');
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId,'operator']));
 const before=calls;assert.equal((await channelRequestHandler(request(u,`/api/channels/${id}/openwa-qr?revision=2`),{id,action:'openwa-qr'})).status,403);assert.equal(calls,before);
});
for(const lostStage of ['session','key','webhook','start'])test(`lost ${lostStage} response recovers owned resources without duplicate session, hook or start`,async t=>{
 const fixture=await openwaFixture(),gateway=openwaGatewayDouble([lostStage]);
 process.env.OPENWA_API_ORIGIN='http://127.0.0.1:2785';process.env.OPENWA_ADMIN_API_KEY='fixture-admin-key';
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[fixture.id]));
 t.mock.method(globalThis,'fetch',gateway.fetch);
 for(let i=0;i<4;i++)await runOpenwaMaintenanceTick({now:new Date(Date.now()+120000).toISOString(),maxConnections:5});
 const status=await readOpenwaConnection(fixture.u.p,fixture.id);assert.equal(status.phase,'qr_ready');
 assert.equal(gateway.creates,1);assert.equal(gateway.hookCreates,1);assert.equal(gateway.starts,1);assert.equal(gateway.keys.length,1);assert.equal(gateway.hooks.length,1);
 assert.equal(gateway.keyCreates,lostStage==='key'?2:1);
 gateway.expireQr=true;assert.equal((await readOpenwaQr(fixture.u.p,fixture.id,1)).qrCode,null);
 const off=await requestOpenwaDisconnect(fixture.u.p,fixture.id,{requestId:randomUUID(),expectedRevision:1});assert.equal(off.connection.revision,2);
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:3});
 await requestOpenwaReconnect(fixture.u.p,fixture.id,{requestId:randomUUID(),expectedRevision:2});
 gateway.expireQr=false;
 for(let i=0;i<2;i++)await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 assert.equal(gateway.creates,1);assert.equal(gateway.keys.length,1);assert.equal(gateway.hooks.length,1);assert.equal(gateway.stops,1);assert.equal(gateway.starts,2);
 await assert.rejects(readOpenwaQr(fixture.u.p,fixture.id,1),{status:409});
});
test('logout requested while start is in flight fences late success and never readies the sender',async t=>{
 const fixture=await openwaFixture(),gateway=openwaGatewayDouble();
 process.env.OPENWA_API_ORIGIN='http://127.0.0.1:2785';process.env.OPENWA_ADMIN_API_KEY='fixture-admin-key';
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[fixture.id]));
 t.mock.method(globalThis,'fetch',gateway.fetch);
 gateway.onStart=async()=>{await requestOpenwaDisconnect(fixture.u.p,fixture.id,{requestId:randomUUID(),expectedRevision:1});};
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 const status=await readOpenwaConnection(fixture.u.p,fixture.id);assert.equal(status.phase,'disconnected');assert.equal(status.connection.senders.some(s=>s.ready),false);assert.equal(gateway.keys.length,0);
});
test('explicit reconnect replaces the old scoped key and invalidates the old QR revision',async t=>{
 const fixture=await openwaFixture(),gateway=openwaGatewayDouble();
 process.env.OPENWA_API_ORIGIN='http://127.0.0.1:2785';process.env.OPENWA_ADMIN_API_KEY='fixture-admin-key';
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[fixture.id]));
 t.mock.method(globalThis,'fetch',gateway.fetch);
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 const oldKey=gateway.keys[0].id;
 await requestOpenwaReconnect(fixture.u.p,fixture.id,{requestId:randomUUID(),expectedRevision:1});
 for(let i=0;i<2;i++)await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 assert.equal(gateway.keys.length,1);assert.notEqual(gateway.keys[0].id,oldKey);assert.equal(gateway.stops,1);
 await assert.rejects(readOpenwaQr(fixture.u.p,fixture.id,1),{status:409});
});
test('role revocation while a QR request is in flight discards the late image',async t=>{
 const fixture=await openwaFixture(),gateway=openwaGatewayDouble();
 process.env.OPENWA_API_ORIGIN='http://127.0.0.1:2785';process.env.OPENWA_ADMIN_API_KEY='fixture-admin-key';
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[fixture.id]));
 let arrive!:()=>void,release!:(response:Response)=>void;
 const arrived=new Promise<void>(resolve=>arrive=resolve);
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  if(new URL(String(url)).pathname.endsWith('/qr')){arrive();return new Promise<Response>(resolve=>release=resolve);}return gateway.fetch(url as string,init);
 });
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 const pending=readOpenwaQr(fixture.u.p,fixture.id,1);await arrived;
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[fixture.u.p.workspaceId,fixture.u.p.userId,'operator']));
 release(Response.json(qr));await assert.rejects(pending,{status:403});
});
test('concurrent create requests reserve one local connection and reject arbitrary gateway authority',async t=>{
 const u=await whatsappUser(),body={...openwaInput(),expectedRevision:0};let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('Gateway must not be contacted during reservation');});
 const create=()=>channelRequestHandler(request(u,'/api/channels/openwa',body),{id:'openwa'});
 const [first,second]=await Promise.all([create(),create()]);assert.equal(first.status,200);assert.equal(second.status,200);assert.deepEqual(await first.json(),await second.json());
 for(const extra of [{origin:'http://evil.example'},{apiKey:'client-cannot-supply-this'},{sessionId:randomUUID()}])assert.equal((await channelRequestHandler(request(u,'/api/channels/openwa',{...body,requestId:randomUUID(),...extra}),{id:'openwa'})).status,422);
 assert.equal(calls,0);
});
test('incomplete remote logout revokes the key and stays visibly unconfirmed',async t=>{
 const fixture=await openwaFixture(),gateway=openwaGatewayDouble();
 process.env.OPENWA_API_ORIGIN='http://127.0.0.1:2785';process.env.OPENWA_ADMIN_API_KEY='fixture-admin-key';
 await testAdmin(c=>c.query("UPDATE app.openwa_connection SET next_at=clock_timestamp()+interval '1 day' WHERE connection_id<>$1",[fixture.id]));
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>new URL(String(url)).pathname.endsWith('/logout')?Response.json({code:'SESSION_LOGOUT_INCOMPLETE'},{status:502}):gateway.fetch(url as string,init));
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:5});
 await requestOpenwaDisconnect(fixture.u.p,fixture.id,{requestId:randomUUID(),expectedRevision:1});
 await runOpenwaMaintenanceTick({now:new Date(Date.now()+1000).toISOString(),maxConnections:3});
 const status=await readOpenwaConnection(fixture.u.p,fixture.id);assert.equal(status.phase,'action_required');assert.equal(status.errorCode,'OPENWA_UNLINK_UNCONFIRMED');assert.equal(status.connection.state,'disconnected');assert.equal(gateway.keys.length,0);assert.equal(gateway.stops,1);
});
