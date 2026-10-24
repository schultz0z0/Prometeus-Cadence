import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {channelRequestHandler} from '../../src/server/channels/http.ts';
import {messagingRequestHandler} from '../../src/server/messaging/http.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {verifiedMetaFixture,testAdmin} from './whatsapp-helpers.ts';
import {base} from './helpers.ts';
after(async()=>{await getPools().close();await closeIngressPool();});
const request=(f:Awaited<ReturnType<typeof verifiedMetaFixture>>,path:string,body?:unknown)=>new Request(base+path,{method:body?'POST':'GET',headers:f.u.headers,body:body?JSON.stringify(body):undefined});

test('removing a disconnected connection revokes local credentials and callbacks while retaining inbox history',async()=>{
 const f=await verifiedMetaFixture();
 assert.equal((await channelRequestHandler(request(f,'/api/channels/'+f.connection.id+'/archive',{requestId:randomUUID(),expectedRevision:1}),{id:f.connection.id,action:'archive'})).status,409);
 await webhookRequest(f.request({messages:[{id:'archive-inbound-'+randomUUID(),from:'5541999998888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Keep this history'}}]}),f.publicId,'meta');
 const before=await testAdmin(async c=>(await c.query('SELECT count(*)::int AS n FROM app.channel_message WHERE connection_id=$1',[f.connection.id])).rows[0].n);assert.equal(before,1);
 const disconnected=await channelRequestHandler(request(f,'/api/channels/'+f.connection.id+'/disconnect',{requestId:randomUUID(),expectedRevision:1}),{id:f.connection.id,action:'disconnect'});assert.equal(disconnected.status,200);
 const body={requestId:randomUUID(),expectedRevision:2},path='/api/channels/'+f.connection.id+'/archive',params={id:f.connection.id,action:'archive'};
 const removed=await channelRequestHandler(request(f,path,body),params);assert.equal(removed.status,200);assert.deepEqual(await removed.json(),{archived:true});
 assert.equal((await channelRequestHandler(request(f,path,body),params)).status,200);
 const list=await(await channelRequestHandler(request(f,'/api/channels'),{})).json();assert.equal(list.some((c:any)=>c.id===f.connection.id),false);
 assert.equal((await channelRequestHandler(request(f,'/api/channels/'+f.connection.id+'/verify-token',{requestId:randomUUID(),expectedRevision:3}),{id:f.connection.id,action:'verify-token'})).status,410);
 const stored=await testAdmin(async c=>({messages:(await c.query('SELECT count(*)::int AS n FROM app.channel_message WHERE connection_id=$1',[f.connection.id])).rows[0].n,keys:(await c.query('SELECT count(*)::int AS n FROM app.channel_credential WHERE connection_id=$1',[f.connection.id])).rows[0].n}));assert.equal(stored.messages,before);assert.equal(stored.keys,0);
 const {lookupIngress}=await import('../../src/server/channels/ingress-db.ts');assert.equal(await lookupIngress(f.publicId),null);
 const {withWorkspaceTransaction}=await import('../../src/server/db/transaction.ts');await assert.rejects(withWorkspaceTransaction(f.u.p,c=>c.query("UPDATE app.channel_connection SET archived_at=NULL,state='ready' WHERE id=$1",[f.connection.id])),/CHANNEL_ARCHIVED/);
 const foreign=await verifiedMetaFixture();assert.equal((await channelRequestHandler(request(foreign,path,{requestId:randomUUID(),expectedRevision:3}),params)).status,404);
});
test('HTTP origin session and workspace guards precede channel writes; connection readbacks contain no secrets',async()=>{
 const f=await verifiedMetaFixture(),path='/api/channels';
 const invalid=request(f,path,{name:'bad'});invalid.headers.set('origin','https://evil.example');assert.equal((await channelRequestHandler(invalid,{})).status,403);
 const stale=request(f,path);stale.headers.set('x-cadence-workspace',randomUUID());assert.equal((await channelRequestHandler(stale,{})).status,409);
 assert.equal((await channelRequestHandler(new Request(base+path),{})).status,401);
 const valid=await channelRequestHandler(request(f,path),{});assert.equal(valid.status,200);const text=await valid.text();assert.equal(text.includes('fixture-access-token'),false);assert.equal(text.includes('fixture-app-secret'),false);
});

test('template sync HTTP persists array results as JSON and replay returns the same catalog without another provider call',async t=>{
 const f=await verifiedMetaFixture(),path='/api/channels/'+f.connection.id+'/sync-templates',params={id:f.connection.id,action:'sync-templates'};
 let calls=0,empty=false;
 t.mock.method(globalThis,'fetch',async(url:unknown,init?:RequestInit)=>{
  const target=new URL(String(url));assert.equal(target.hostname,'graph.facebook.com');assert.ok(target.pathname.endsWith('/message_templates'));assert.equal(init?.method??'GET','GET');calls++;
  return Response.json({data:empty?[]:[{id:'444444',name:'qa_order_confirmation',language:'en_US',status:'APPROVED',components:[{type:'BODY',text:'Hi {{1}}, your order is {{2}}.'}]}]});
 });
 const body={requestId:randomUUID(),expectedRevision:1};
 const response=await channelRequestHandler(request(f,path,body),params);assert.equal(response.status,200);
 const templates=await response.json();assert.equal(templates.length,1);assert.equal(templates[0].name,'qa_order_confirmation');assert.equal(templates[0].parameters.length,2);
 const replay=await channelRequestHandler(request(f,path,body),params);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),templates);assert.equal(calls,1);
 const cached=await testAdmin(async c=>(await c.query('SELECT result FROM app.command_result WHERE workspace_id=$1 AND request_id=$2',[f.u.p.workspaceId,body.requestId])).rows[0].result);assert.deepEqual(cached,templates);
 empty=true;const emptyBody={requestId:randomUUID(),expectedRevision:1};
 const noTemplates=await channelRequestHandler(request(f,path,emptyBody),params);assert.equal(noTemplates.status,200);assert.deepEqual(await noTemplates.json(),[]);
 const emptyReplay=await channelRequestHandler(request(f,path,emptyBody),params);assert.equal(emptyReplay.status,200);assert.deepEqual(await emptyReplay.json(),[]);assert.equal(calls,2);
});
test('manual reply prepare never sends; confirmed replay enqueues once and reading cannot hide a concurrent inbound',async()=>{
 const f=await verifiedMetaFixture();process.env.CHANNEL_PUBLIC_BASE_URL='https://hooks.example';
 const limit=await channelRequestHandler(request(f,'/api/channels/'+f.connection.id+'/limits',{requestId:randomUUID(),expectedRevision:0,workspaceDailyLimit:5,senderId:f.sender.id,senderDailyLimit:5}),{id:f.connection.id,action:'limits'});assert.equal(limit.status,200);
 await webhookRequest(f.request({messages:[{id:'wamid.http.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Oi'}}]}),f.publicId,'meta');
 const list=await (await messagingRequestHandler(request(f,'/api/messaging/conversations'),{resource:'conversations'})).json();const id=list.items[0].id;
 const path='/api/messaging/conversations/'+id,params={resource:'conversations',id};
 const prepared=await messagingRequestHandler(request(f,path+'/reply-prepare',{content:{kind:'text',text:'Olá, posso ajudar?'}}),{...params,action:'reply-prepare'});assert.equal(prepared.status,200);const review=await prepared.json();assert.deepEqual(review.blockers,[]);
 const count=()=>testAdmin(async c=>Number((await c.query('SELECT count(*) FROM app.message_outbox WHERE workspace_id=$1',[f.u.p.workspaceId])).rows[0].count));assert.equal(await count(),0);
 const command={content:{kind:'text',text:'Olá, posso ajudar?'},requestId:randomUUID(),reviewToken:review.token};
 const first=await (await messagingRequestHandler(request(f,path+'/reply-confirm',command),{...params,action:'reply-confirm'})).json(),again=await (await messagingRequestHandler(request(f,path+'/reply-confirm',command),{...params,action:'reply-confirm'})).json();assert.equal(first.id,again.id);assert.equal(await count(),1);
 const changed=await messagingRequestHandler(request(f,path+'/reply-confirm',{...command,content:{kind:'text',text:'Não revisado'}}),{...params,action:'reply-confirm'});assert.equal(changed.status,409);
 const thread=await (await messagingRequestHandler(request(f,path+'/messages'),{...params,action:'messages'})).json();const lastSeen=thread.messages.at(-1).id;
 await webhookRequest(f.request({messages:[{id:'wamid.new.'+randomUUID(),from:'5541988888888',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Mais uma pergunta'}}]}),f.publicId,'meta');
 assert.equal((await messagingRequestHandler(request(f,path+'/read',{requestId:randomUUID(),messageId:lastSeen}),{...params,action:'read'})).status,200);
 const unread=await (await messagingRequestHandler(request(f,'/api/messaging/conversations'),{resource:'conversations'})).json();assert.equal(unread.items[0].unread,1);assert.equal(await count(),1);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']));
 assert.equal((await channelRequestHandler(request(f,'/api/channels/'+f.connection.id+'/verify-token',{requestId:randomUUID(),expectedRevision:1}),{id:f.connection.id,action:'verify-token'})).status,403);
 assert.equal((await messagingRequestHandler(request(f,path+'/reply-prepare',{content:{kind:'text',text:'Resposta do operador'}}),{...params,action:'reply-prepare'})).status,200);
});
