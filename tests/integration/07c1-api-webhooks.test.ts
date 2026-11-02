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
 const late=recorder(()=>({status:500}));
 // One attempt per destination per tick: the two deliveries of this destination take two ticks.
 await tick(ws,late.request);await tick(ws,late.request);assert.equal(await count('integration_delivery',ws,"AND state='failed'"),2);
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

test('review: one slow destination gets one attempt per tick; paused destinations are never sent to, even mid-flight',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId;
 const x=await destination(p,{name:'X',url:'https://x.example.com/h'}),y=await destination(p,{name:'Y',url:'https://y.example.com/h',events:['lead.qualified']});
 await seed(p,[lead('f1'),lead('f2'),lead('f3')]);
 const s=await readWorkspaceSnapshot(p),first=s.data.leads.find(l=>l.id==='f1')!;await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'lead.upsert',lead:{...first,qualification:'qualified'}}});
 const r=recorder(()=>({status:200}));await tick(ws,r.request);
 assert.deepEqual(r.calls.map(c=>new URL(c.url).hostname).sort(),['x.example.com','y.example.com']);
 // Paused while the attempt is in flight: the transient failure is cancelled instead of retried.
 const pausing:WebhookRequest=async()=>{await testAdmin(c=>c.query('UPDATE app.webhook_destination SET active=false WHERE workspace_id=$1 AND id=$2',[ws,x.id]));return{status:503};};
 await tick(ws,pausing);assert.equal(await count('integration_delivery',ws,`AND destination_id='${x.id}' AND state='cancelled'`),1);
 await testAdmin(c=>c.query("UPDATE app.integration_delivery SET state='pending',next_at=now() WHERE workspace_id=$1 AND destination_id=$2 AND state<>'delivered'",[ws,x.id]));
 const none=recorder(()=>({status:200}));await tick(ws,none.request);assert.equal(none.calls.length,0);
 assert.ok((await listWebhooks(p)).find(w=>w.id===y.id));
});

test('review: emitting never breaks a domain write; deleted leads cancel their deliveries and erase the copy; email replies wait for classification',async()=>{
 const f=await verifiedMetaFixture(),p=f.u.p,ws=p.workspaceId;const d=await destination(p,{events:['lead.created','lead.connected']});
 await testAdmin(async c=>{await c.query("INSERT INTO app.list VALUES($1,'big','Big')",[ws]);await c.query("INSERT INTO app.lead VALUES($1,'huge','big',$2)",[ws,lead('huge','big',{notes:'x'.repeat(250000)})]);});
 const data=await testAdmin(async c=>(await c.query("SELECT data FROM app.integration_event WHERE workspace_id=$1 AND entity_id='huge'",[ws])).rows[0].data);
 assert.equal(data.truncated,true);assert.equal(data.lead.id,'huge');
 await seed(p,[lead('gone')]);assert.equal(await count('integration_delivery',ws,"AND state='pending'"),2);
 const s=await readWorkspaceSnapshot(p);await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:s.revision,command:{type:'leads.delete',ids:['gone']}});
 const erased=await testAdmin(async c=>(await c.query("SELECT e.data,d.state FROM app.integration_event e JOIN app.integration_delivery d ON d.workspace_id=e.workspace_id AND d.event_id=e.id WHERE e.workspace_id=$1 AND e.entity_id='gone'",[ws])).rows[0]);
 assert.deepEqual(erased,{data:{deleted:true},state:'cancelled'});
 // An inbound email row alone (auto-reply, bounce, not yet classified) is not a reply.
 const identity=randomUUID(),conversation=randomUUID();
 await testAdmin(async c=>{
  await c.query("INSERT INTO app.channel_identity(workspace_id,id,scope,external_id) VALUES($1,$2,'fixture',$2)",[ws,identity]);
  await c.query("INSERT INTO app.channel_conversation(workspace_id,id,connection_id,sender_id,identity_id,channel,thread_key,lead_id) VALUES($1,$2,$3,$4,$5,'EMAIL','t1','huge')",[ws,conversation,f.connection.id,f.sender.id,identity]);
  await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,direction,state,text,occurred_at,channel) VALUES($1,gen_random_uuid()::text,$2,$3,$4,$5,'inbound','received','Estou fora do escritório',now(),'EMAIL')",[ws,f.connection.id,f.sender.id,identity,conversation]);
 });
 assert.equal(await count('integration_event',ws,"AND type='lead.connected'"),0);
 assert.ok(d.id);
});

test('review: a test is refused while the destination needs attention, failures count per attempt, and a replayed create with other data is refused',async()=>{
 const{p}=await prospectingUser(),ws=p.workspaceId,i=input(),rv=await prepareWebhook(p,{input:i},{resolve:publicDns}),requestId=randomUUID();
 const d=await confirmWebhook(p,{input:i,token:rv.token,requestId},{resolve:publicDns});
 const other=input({events:['lead.qualified']}),rv2=await prepareWebhook(p,{input:other},{resolve:publicDns});
 await assert.rejects(confirmWebhook(p,{input:other,token:rv2.token,requestId},{resolve:publicDns}),{status:409});
 await seed(p,[lead('c1')]);await tick(ws,recorder(()=>({status:503})).request);
 assert.equal((await listWebhooks(p))[0].consecutiveFailures,1);
 await testAdmin(c=>c.query("UPDATE app.webhook_destination SET attention='unauthorized' WHERE workspace_id=$1",[ws]));
 const [v]=await listWebhooks(p);await assert.rejects(webhookAction(p,d.id,{action:'test',expectedRevision:v.revision}),{status:409,code:'WEBHOOK_ATTENTION'});
});

// 07C.1b — public read API with scoped keys.
const v1=async(path:string,token?:string,extra:Record<string,string>={})=>{const {apiLeadsRequest,apiEventsRequest}=await import('../../src/server/integrations/public-api.ts');const req=new Request(base+path,{headers:{...(token?{authorization:'Bearer '+token}:{}),...extra}});return path.startsWith('/api/v1/leads')?apiLeadsRequest(req):apiEventsRequest(req);};

test('07C.1b keys: token shown once and stored as digest; scopes, pagination and tenant isolation; cookies never authenticate',async()=>{
 const {createApiKey,listApiKeys}=await import('../../src/server/integrations/api-auth.ts');
 const a=await prospectingUser(),b=await prospectingUser();
 await seed(a.p,Array.from({length:5},(_,i)=>lead('k'+i)));await seed(b.p,[lead('theirs')]);
 const {key,token}=await createApiKey(a.p,{name:'[RE] n8n',scopes:['leads:read']});
 assert.match(token,/^pcak_/);assert.equal(key.prefix,token.slice(0,12));
 assert.doesNotMatch(JSON.stringify(await listApiKeys(a.p)),new RegExp(token.slice(12)));
 const stored=await testAdmin(async c=>(await c.query('SELECT digest FROM app.api_credential WHERE workspace_id=$1',[a.p.workspaceId])).rows[0].digest);
 assert.notEqual(stored,token);assert.equal(stored.length,64);
 const first=await v1('/api/v1/leads?limit=3',token);assert.equal(first.status,200);const one=await first.json();assert.equal(one.data.length,3);
 const second=await (await v1('/api/v1/leads?limit=3&cursor='+one.nextCursor,token)).json();
 const ids=[...one.data,...second.data].map((l:{id:string})=>l.id);assert.equal(new Set(ids).size,5);assert.ok(!ids.includes('theirs'));assert.equal(second.nextCursor,null);
 const noScope=await v1('/api/v1/events',token);assert.equal(noScope.status,403);
 assert.equal((await v1('/api/v1/leads')).status,401);assert.equal((await v1('/api/v1/leads')).headers.get('www-authenticate'),'Bearer');
 assert.equal((await v1('/api/v1/leads',undefined,{cookie:a.headers.get('cookie')!})).status,401);
 assert.equal((await v1('/api/v1/leads','pcak_'+'Z'.repeat(43))).status,401);
 assert.equal((await v1('/api/v1/leads?limit=500',token)).status,422);
});

test('07C.1b rotation invalidates the old token at once, revocation ends the key, and a demoted or removed creator disables it',async()=>{
 const {createApiKey,rotateApiKey,revokeApiKey,listApiKeys}=await import('../../src/server/integrations/api-auth.ts');
 const u=await prospectingUser();await seed(u.p,[lead('r1')]);
 const {key,token}=await createApiKey(u.p,{name:'[RE] CRM',scopes:['leads:read','events:read']});
 const rotated=await rotateApiKey(u.p,key.id,{expectedRevision:key.revision});
 assert.notEqual(rotated.token,token);assert.doesNotMatch(JSON.stringify(rotated),new RegExp(token.slice(12)));
 assert.equal((await v1('/api/v1/leads',token)).status,401);assert.equal((await v1('/api/v1/leads',rotated.token)).status,200);
 await assert.rejects(rotateApiKey(u.p,key.id,{expectedRevision:key.revision}),{status:409});
 await testAdmin(c=>c.query(`UPDATE auth.member SET role='operator' WHERE "organizationId"=$1 AND "userId"=$2`,[u.p.workspaceId,u.p.userId]));
 assert.equal((await v1('/api/v1/leads',rotated.token)).status,401);
 await testAdmin(c=>c.query(`UPDATE auth.member SET role='owner' WHERE "organizationId"=$1 AND "userId"=$2`,[u.p.workspaceId,u.p.userId]));
 assert.equal((await v1('/api/v1/leads',rotated.token)).status,200);
 await revokeApiKey(u.p,key.id,{expectedRevision:rotated.key.revision});assert.equal((await v1('/api/v1/leads',rotated.token)).status,401);assert.deepEqual(await listApiKeys(u.p),[]);
 const again=await createApiKey(u.p,{name:'[RE] outra',scopes:['leads:read']});
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId]));
 assert.equal((await v1('/api/v1/leads',again.token)).status,401);
});

test('07C.1b events feed: recorded for an events:read key, own workspace only, cursor across pages; rate limit answers 429 with Retry-After',async()=>{
 const {createApiKey}=await import('../../src/server/integrations/api-auth.ts');
 const a=await prospectingUser(),b=await prospectingUser();
 const {token}=await createApiKey(a.p,{name:'[RE] feed',scopes:['events:read']});const other=await createApiKey(b.p,{name:'[RE] b',scopes:['events:read']});
 await seed(a.p,[lead('e1'),lead('e2'),lead('e3')]);await seed(b.p,[lead('x1')]);
 const p1=await (await v1('/api/v1/events?limit=2',token)).json();const p2=await (await v1('/api/v1/events?limit=2&cursor='+p1.nextCursor,token)).json();
 const ids=[...p1.data,...p2.data].map((e:{entity:{id:string}})=>e.entity.id).sort();assert.deepEqual(ids,['e1','e2','e3']);
 assert.equal(p1.data[0].type,'lead.created');assert.equal(p1.data[0].idempotencyKey,p1.data[0].id);
 const theirs=await (await v1('/api/v1/events',other.token)).json();assert.deepEqual(theirs.data.map((e:{entity:{id:string}})=>e.entity.id),['x1']);
 // No consumer, no copy: a workspace without destinations or event keys records nothing.
 const c=await prospectingUser();await seed(c.p,[lead('n1')]);assert.equal(await count('integration_event',c.p.workspaceId),0);
 await testAdmin(x=>x.query("UPDATE app.api_rate SET hits=120 WHERE workspace_id=$1",[a.p.workspaceId]));
 const limited=await v1('/api/v1/events',token);assert.equal(limited.status,429);assert.ok(Number(limited.headers.get('retry-after'))>=1);
});

test('07C.1b key management is owner/admin only and limited; HTTP contract',async()=>{
 const {createApiKey}=await import('../../src/server/integrations/api-auth.ts');
 const u=await prospectingUser(),v=await prospectingUser(),mate={...v.p,workspaceId:u.p.workspaceId,role:'operator' as const};
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),mate.workspaceId,mate.userId,'operator']));
 await assert.rejects(createApiKey(mate,{name:'x',scopes:['leads:read']}),{status:403});
 for(let n=0;n<10;n++)await createApiKey(u.p,{name:'K'+n,scopes:['leads:read']});
 await assert.rejects(createApiKey(u.p,{name:'Onze',scopes:['leads:read']}),{status:409});
 await assert.rejects(createApiKey(u.p,{name:'x',scopes:['leads:write']}),{status:422});
 const created=await integrationsRequest(new Request(base+'/api/integrations',{method:'POST',headers:u.headers,body:JSON.stringify({action:'create-key',input:{name:'x',scopes:['leads:read']}})}));assert.equal(created.status,409);
 const listed=await (await integrationsRequest(new Request(base+'/api/integrations',{headers:u.headers}))).json();assert.equal(listed.keys.length,10);assert.doesNotMatch(JSON.stringify(listed),/digest|pcak_[A-Za-z0-9_-]{20}/);
});
