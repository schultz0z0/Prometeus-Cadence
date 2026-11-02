import test,{after}from'node:test';import assert from'node:assert/strict';import{randomUUID,createHmac}from'node:crypto';
import{prospectingUser as createUser,testAdmin,closeProspectingPools}from'./prospecting-helpers.ts';
import{verifiedMetaFixture}from'./whatsapp-helpers.ts';
import{base,resetRateLimits}from'./helpers.ts';
import{executeWorkspaceCommand,readWorkspaceSnapshot}from'../../src/server/workspaces/commands.ts';
import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';
import{listWebhooks,listDeliveries,prepareWebhook,confirmWebhook,webhookAction}from'../../src/server/integrations/webhooks.ts';
import{dispatchIntegrationTick,type WebhookRequest}from'../../src/server/integrations/worker.ts';
import{integrationsRequest,integrationItemRequest}from'../../src/server/integrations/http.ts';
import type{Principal}from'../../src/domain/workspace.ts';
after(closeProspectingPools);
const prospectingUser=async()=>{await resetRateLimits();return createUser();};
const publicDns=async()=>[{address:'93.184.216.34',family:4 as const}];
const lead=(id:string,listId='base',fields:Record<string,unknown>={})=>({id,listId,name:'[RE] Contato '+id,qualification:'pending',source:'MANUAL',createdAt:new Date().toISOString(),...fields});
async function seed(p:Principal,leads:ReturnType<typeof lead>[],list={id:'base',name:'Base QA'}){const s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.import',dedupScope:'list',list,leads}});}
const input=(f:Record<string,unknown>={})=>({name:'[RE] CRM',url:'https://crm.example.com/hook',events:['lead.created'],lists:{mode:'all'},expectedRevision:0,...f});
async function destination(p:Principal,f:Record<string,unknown>={}){const i=input(f),r=await prepareWebhook(p,{input:i},{resolve:publicDns});assert.deepEqual(r.blockers,[]);return confirmWebhook(p,{input:i,token:r.token,requestId:randomUUID()},{resolve:publicDns});}
const count=(t:string,ws:string,where='')=>testAdmin(async c=>Number((await c.query(`SELECT count(*) FROM app.${t} WHERE workspace_id=$1 ${where}`,[ws])).rows[0].count));
type Call={url:string;address:string;body:string;headers:Record<string,string>};
const recorder=(answer:(n:number)=>{status:number;retryAfter?:string}|Error)=>{const calls:Call[]=[];const request:WebhookRequest=async(a,body,headers)=>{calls.push({url:a.url.toString(),address:a.address,body,headers});const r=answer(calls.length);if(r instanceof Error)throw r;return r;};return{calls,request};};
// Only this test's workspace is dispatched: other suites may have queued deliveries in the shared test database.
async function tick(ws:string,request:WebhookRequest,opts:{resolve?:typeof publicDns;now?:()=>number}={}){
 await testAdmin(c=>c.query("UPDATE app.integration_delivery SET next_at=next_at+interval '100 years' WHERE workspace_id<>$1 AND state='pending' AND next_at<now()+interval '50 years'",[ws]));
 try{return await dispatchIntegrationTick({limit:100,signal:new AbortController().signal},{request,resolve:opts.resolve??publicDns,now:opts.now});}
 finally{await testAdmin(c=>c.query("UPDATE app.integration_delivery SET next_at=next_at-interval '100 years' WHERE workspace_id<>$1 AND state='pending' AND next_at>now()+interval '50 years'",[ws]));}
}

test('aborted commit emits nothing; a committed lead emits one signed delivery with a stable id; replays stay one logical record',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId;
 const d=await destination(p,{secret:'s3cret-value-for-qa-0001'});assert.equal(d.secretConfigured,true);
 assert.doesNotMatch(JSON.stringify(await listWebhooks(p)),/s3cret/);
 await assert.rejects(withWorkspaceTransaction(p,async c=>{await c.query("INSERT INTO app.list VALUES($1,'tmp','tmp')",[ws]);await c.query("INSERT INTO app.lead VALUES($1,'x1','tmp',$2)",[ws,lead('x1','tmp')]);throw Error('rollback');}),/rollback/);
 assert.equal(await count('integration_event',ws),0);
 await seed(p,[lead('a1')]);assert.equal(await count('integration_event',ws),1);assert.equal(await count('integration_delivery',ws),1);
 const r=recorder(()=>({status:200}));assert.deepEqual(await tick(ws,r.request),{sent:1,deferred:0});
 const call=r.calls[0],env=JSON.parse(call.body);
 assert.equal(call.address,'93.184.216.34');assert.equal(env.type,'lead.created');assert.equal(env.idempotencyKey,env.id);assert.equal(env.data.lead.id,'a1');assert.equal(env.data.list.name,'Base QA');
 assert.equal(call.headers['x-webhook-signature'],createHmac('sha256','s3cret-value-for-qa-0001').update(call.body).digest('hex'));
 assert.equal((await tick(ws,r.request)).sent,0);assert.equal(r.calls.length,1);
 // A lease lost mid-attempt is retried with the same idempotency key, never as a second event.
 await testAdmin(c=>c.query("UPDATE app.integration_delivery SET state='delivering',lease_until=now()-interval '1 second',lease_token='old' WHERE workspace_id=$1",[ws]));
 await tick(ws,r.request);assert.equal(JSON.parse(r.calls[1].body).id,env.id);assert.equal(await count('integration_event',ws),1);
 const [v]=await listWebhooks(p);assert.equal(v.deliveries,1);assert.ok(v.lastSuccessAt);
});

test('private, link-local, loopback, IPv6 private and rebinding addresses are refused before any request; redirects are not followed',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId;
 const blocked=await prepareWebhook(p,{input:input({url:'http://169.254.169.254/latest'})},{resolve:publicDns});assert.equal(blocked.blockers.length,1);
 for(const address of['10.0.0.5','127.0.0.1','::1','fd00::1','169.254.169.254']){const r=await prepareWebhook(p,{input:input({url:'https://rebind.example.com/h'})},{resolve:async()=>[{address,family:address.includes(':')?6:4}]});assert.equal(r.blockers.length,1,address);}
 const i=input(),rv=await prepareWebhook(p,{input:i},{resolve:publicDns});
 await assert.rejects(confirmWebhook(p,{input:i,token:rv.token,requestId:randomUUID()},{resolve:async()=>[{address:'10.1.1.1',family:4}]}),{status:409,code:'WEBHOOK_BLOCKED'});
 await confirmWebhook(p,{input:i,token:rv.token,requestId:randomUUID()},{resolve:publicDns});
 // DNS changed after saving (rebinding): the attempt resolves again and never connects.
 await seed(p,[lead('r1')]);const r=recorder(()=>({status:200}));
 await tick(ws,r.request,{resolve:async()=>[{address:'169.254.169.254',family:4}]});
 assert.equal(r.calls.length,0);const [v]=await listWebhooks(p);assert.equal(v.state,'attention');assert.equal(v.attention,'address');
 const [held]=await listDeliveries(p,v.id);assert.equal(held.state,'held');
 await webhookAction(p,v.id,{action:'retry',expectedRevision:v.revision});
 const redirect=recorder(()=>({status:302}));await tick(ws,redirect.request);assert.equal(redirect.calls.length,1);assert.equal((await listWebhooks(p))[0].attention,'redirect');
});

test('429 honors Retry-After within 24 h, 5xx backs off, 401 holds the destination without looping, and 24 h ends retries',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId,d=await destination(p);
 await seed(p,[lead('t1')]);let now=Date.now();
 const s=recorder(n=>n===1?{status:503}:n===2?{status:429,retryAfter:'900'}:{status:401});
 await tick(ws,s.request,{now:()=>now});let [x]=await listDeliveries(p,d.id);assert.equal(x.state,'pending');assert.equal(x.lastStatus,503);
 assert.ok(Math.abs(Date.parse(x.nextAt!)-(now+60e3))<2000);
 await testAdmin(c=>c.query("UPDATE app.integration_delivery SET next_at=now() WHERE workspace_id=$1",[ws]));now=Date.now();
 await tick(ws,s.request,{now:()=>now});[x]=await listDeliveries(p,d.id);assert.equal(x.lastStatus,429);assert.ok(Math.abs(Date.parse(x.nextAt!)-(now+900e3))<2000);
 await testAdmin(c=>c.query("UPDATE app.integration_delivery SET next_at=now() WHERE workspace_id=$1",[ws]));
 await tick(ws,s.request);[x]=await listDeliveries(p,d.id);assert.equal(x.state,'held');let [v]=await listWebhooks(p);assert.equal(v.attention,'unauthorized');
 // New events wait for a person instead of hitting the refusing endpoint again.
 await seed(p,[lead('t2')]);const calls=s.calls.length;await tick(ws,s.request);assert.equal(s.calls.length,calls);
 assert.equal(await count('integration_delivery',ws,"AND state='held'"),2);
 // After 24 h a transient failure is final.
 [v]=await listWebhooks(p);await webhookAction(p,v.id,{action:'retry',expectedRevision:v.revision});
 await testAdmin(c=>c.query("UPDATE app.integration_event SET occurred_at=now()-interval '25 hours' WHERE workspace_id=$1",[ws]));
 const late=recorder(()=>({status:500}));await tick(ws,late.request);assert.equal(await count('integration_delivery',ws,"AND state='failed'"),2);
});

test('events honor subscriptions, lists and reply channels; pause cancels the queue; replies carry no message text',async()=>{
 const f=await verifiedMetaFixture(),p=f.u.p,ws=p.workspaceId;
 await seed(p,[lead('m1')]);await seed(p,[lead('o1','other')],{id:'other',name:'Outra'});
 const email=await destination(p,{name:'Email',events:['lead.connected.email']}),wa=await destination(p,{name:'WA',events:['lead.connected','lead.qualified'],lists:{mode:'specific',ids:['base']}});
 const identity=randomUUID(),conversation=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'fixture',$2)",[ws,identity]);
  await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,lead_id) VALUES($1,$2,$3,$4,$5,'WHATSAPP','m1')",[ws,conversation,f.connection.id,f.sender.id,identity]);
  await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received','Texto privado do contato',now())",[ws,f.connection.id,f.sender.id,identity,conversation]);
 });
 assert.equal(await count('integration_delivery',ws,`AND destination_id='${email.id}'`),0);
 assert.equal(await count('integration_delivery',ws,`AND destination_id='${wa.id}'`),1);
 const data=await testAdmin(async c=>(await c.query("SELECT data FROM app.integration_event WHERE workspace_id=$1 AND type='lead.connected'",[ws])).rows[0].data);
 assert.equal(data.message.channel,'WHATSAPP');assert.doesNotMatch(JSON.stringify(data),/Texto privado/);
 // Qualifying a lead of another list does not reach a destination scoped to "base".
 const s=await readWorkspaceSnapshot(p),other=s.data.leads.find(l=>l.id==='o1')!;await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...other,qualification:'qualified'}}});
 assert.equal(await count('integration_event',ws,"AND type='lead.qualified'"),0);
 const s2=await readWorkspaceSnapshot(p),mine=s2.data.leads.find(l=>l.id==='m1')!;await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s2.revision,command:{type:'lead.upsert',lead:{...mine,qualification:'qualified'}}});
 assert.equal(await count('integration_delivery',ws,`AND destination_id='${wa.id}'`),2);
 const [,current]=(await listWebhooks(p));await webhookAction(p,current.id,{action:'pause',expectedRevision:current.revision});
 assert.equal(await count('integration_delivery',ws,`AND destination_id='${wa.id}' AND state='cancelled'`),2);
});

test('owner-only management, tenant isolation, one-time secret, idempotent create, test event, limit and HTTP contract',async()=>{
 const u=await prospectingUser(),v=await prospectingUser(),mate={...v.p,workspaceId:u.p.workspaceId,role:'operator' as const};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),mate.workspaceId,mate.userId,'operator']));
 const i=input(),rv=await prepareWebhook(u.p,{input:i},{resolve:publicDns}),requestId=randomUUID();
 const one=await confirmWebhook(u.p,{input:i,token:rv.token,requestId},{resolve:publicDns}),two=await confirmWebhook(u.p,{input:i,token:rv.token,requestId},{resolve:publicDns});
 assert.equal(one.id,two.id);assert.equal((await listWebhooks(u.p)).length,1);assert.equal(one.secretConfigured,false);
 await assert.rejects(listWebhooks(mate),{status:403});await assert.rejects(webhookAction(mate,one.id,{action:'pause',expectedRevision:one.revision}),{status:403});
 assert.deepEqual(await listWebhooks(v.p),[]);await assert.rejects(webhookAction(v.p,one.id,{action:'delete',expectedRevision:one.revision}),{status:404});
 const gen=await webhookAction(u.p,one.id,{action:'secret',expectedRevision:one.revision});assert.equal(gen.secret!.length>=40,true);assert.equal(gen.webhook!.secretConfigured,true);
 assert.doesNotMatch(JSON.stringify(await listWebhooks(u.p)),new RegExp(gen.secret!));
 await assert.rejects(webhookAction(u.p,one.id,{action:'pause',expectedRevision:one.revision}),{status:409});
 const t=await webhookAction(u.p,one.id,{action:'test',expectedRevision:gen.webhook!.revision});assert.ok(t.eventId);
 assert.equal((await listDeliveries(u.p,one.id))[0].eventType,'webhook.test');
 for(let n=1;n<10;n++)await destination(u.p,{name:'D'+n});
 const full=await prepareWebhook(u.p,{input:input({name:'Onze'})},{resolve:publicDns});assert.match(full.blockers.join(' '),/limite/);
 assert.equal((await integrationsRequest(new Request(base+'/api/integrations'))).status,401);
 assert.equal((await integrationsRequest(new Request(base+'/api/integrations',{method:'POST',headers:u.headers,body:JSON.stringify({action:'prepare',input:{...i,events:['agent.qualified']}})}))).status,422);
 const listed=await integrationsRequest(new Request(base+'/api/integrations',{headers:u.headers}));assert.equal(listed.status,200);assert.equal((await listed.json()).webhooks.length,10);
 assert.equal((await integrationItemRequest(new Request(base+'/api/integrations/'+one.id+'/deliveries'),one.id,'deliveries')).status,401);
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId]));
 await assert.rejects(listWebhooks(u.p),{status:403});
});
