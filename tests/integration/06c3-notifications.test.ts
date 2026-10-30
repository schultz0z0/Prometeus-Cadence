import test,{after}from'node:test';import assert from'node:assert/strict';import{randomUUID}from'node:crypto';
import{prospectingUser as createUser,testAdmin}from'./prospecting-helpers.ts';import{resetRateLimits}from'./helpers.ts';import{saveConnection}from'../../src/server/channels/repository.ts';import{metaConnectionInput}from'./whatsapp-helpers.ts';
import{getPools}from'../../src/server/db/pool.ts';import{withWorkspaceTransaction}from'../../src/server/db/transaction.ts';import{workerPool}from'../../src/server/prospecting/worker-db.ts';
import{defaultNotificationPreferences as defaults}from'../../src/domain/notifications.ts';
import{saveNotificationPreferences,listNotifications,readNotification}from'../../src/server/notifications/service.ts';import{processNotificationTick}from'../../src/server/notifications/worker.ts';
after(async()=>{await getPools().close();await workerPool().end();});
const signal=new AbortController().signal;
async function prospectingUser(){await resetRateLimits();return createUser();}
async function event(p:any){process.env.CHANNEL_KEYRING_JSON=JSON.stringify({fixture:Buffer.alloc(32,12).toString('base64')});process.env.CHANNEL_ACTIVE_KEY_ID='fixture';const c=await saveConnection(p,metaConnectionInput());await testAdmin(db=>db.query("UPDATE app.channel_connection SET state='attention' WHERE id=$1",[c.id]));return c;}
async function prefs(p:any,patch:Record<string,unknown>={}){return saveNotificationPreferences(p,{...defaults,email:true,...patch});}
test('committed source event becomes one private item and delivery across ticks; read is idempotent per user',async()=>{
 const u=await prospectingUser(),other=await prospectingUser();await prefs(u.p);await prefs(other.p);await event(u.p);let calls=0;const sendEmail=async(v:any)=>{calls++;assert.equal(v.to,u.email);assert.doesNotMatch(JSON.stringify(v),/fixture-access-token|appSecret/);};
 process.env.NOTIFICATIONS_DELIVERY_ENABLED='true';await processNotificationTick({limit:100,signal},{sendEmail});await processNotificationTick({limit:100,signal},{sendEmail});assert.equal(calls,1);
 const a=await listNotifications(u.p);assert.equal(a.unread,1);assert.equal(a.items.length,1);assert.equal((await listNotifications(other.p)).unread,0);await assert.rejects(readNotification(other.p,a.items[0].id),{status:404});
 await readNotification(u.p,a.items[0].id);await readNotification(u.p,a.items[0].id);assert.equal((await listNotifications(u.p)).unread,0);assert.equal((await listNotifications(u.p)).items.length,1);
 await assert.rejects(withWorkspaceTransaction(u.p,c=>c.query("INSERT INTO app.notification_item(workspace_id,user_id,event_key,event_type,title,href) VALUES($1,$2,'forged','lead_reply','forged','/dashboard')",[u.p.workspaceId,u.p.userId])),/permission denied/);
});
test('current preference and membership are rechecked at claim; quiet defers rather than duplicates',async()=>{
 process.env.NOTIFICATIONS_DELIVERY_ENABLED='false';const u=await prospectingUser();await prefs(u.p);await event(u.p);await processNotificationTick({limit:100,signal});
 await saveNotificationPreferences(u.p,{...defaults,expectedRevision:1,email:false});let calls=0;process.env.NOTIFICATIONS_DELIVERY_ENABLED='true';await processNotificationTick({limit:100,signal},{sendEmail:async()=>{calls++;}});assert.equal(calls,0);
 const v=await prospectingUser();await prefs(v.p,{quiet:{timezone:'UTC',start:'22:00',end:'08:00'}});await event(v.p);const day=new Date().toISOString().slice(0,10),now=day+'T23:00:00Z';
 await processNotificationTick({limit:100,signal},{now:()=>now,sendEmail:async()=>{calls++;}});assert.equal(calls,0);assert.equal((await listNotifications(v.p)).unread,1);
 await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[v.p.workspaceId,v.p.userId]));await processNotificationTick({limit:100,signal},{now:()=>new Date(Date.parse(now)+12*3600000).toISOString(),sendEmail:async()=>{calls++;}});assert.equal(calls,0);await assert.rejects(listNotifications(v.p),{status:403});
});
test('uncertain network I/O is not retried and revocation during I/O preserves only the receipt',async()=>{
 const u=await prospectingUser();await prefs(u.p);await event(u.p);let calls=0;await processNotificationTick({limit:100,signal},{sendEmail:async()=>{calls++;throw Error('lost response');}});await processNotificationTick({limit:100,signal},{sendEmail:async()=>{calls++;}});assert.equal(calls,1);
 const v=await prospectingUser();await prefs(v.p);await event(v.p);await processNotificationTick({limit:100,signal},{sendEmail:async()=>{await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[v.p.workspaceId,v.p.userId]));}});
 const rows=await testAdmin(c=>c.query("SELECT state FROM app.notification_delivery WHERE workspace_id=$1",[v.p.workspaceId]));assert.equal(rows.rows[0].state,'delivered');await assert.rejects(listNotifications(v.p),{status:403});
});
test('weekly summary is deduplicated and contains no facts from neighboring workspaces',async()=>{
 process.env.NOTIFICATIONS_DELIVERY_ENABLED='false';const u=await prospectingUser(),v=await prospectingUser();await prefs(u.p,{summary:{frequency:'weekly',time:'09:00'}});await prefs(v.p,{summary:{frequency:'weekly',time:'09:00'}});
 await testAdmin(async c=>{await c.query("UPDATE app.scheduled_summary SET next_at=now()-interval '1 minute' WHERE workspace_id=ANY($1::text[])",[[u.p.workspaceId,v.p.workspaceId]]);await c.query("INSERT INTO app.list VALUES($1,'summary-list','Synthetic summary')",[v.p.workspaceId]);await c.query("INSERT INTO app.lead VALUES($1,'neighbor','summary-list',jsonb_build_object('id','neighbor','name','DO NOT LEAK','createdAt',(now()-interval '3 days')::text))",[v.p.workspaceId]);});
 await processNotificationTick({limit:100,signal});await processNotificationTick({limit:100,signal});const rows=(await listNotifications(u.p)).items.filter(i=>i.eventKey.startsWith('summary:'));assert.equal(rows.length,1);assert.match(rows[0].title,/0 contatos/);assert.doesNotMatch(JSON.stringify(rows),/DO NOT LEAK|neighbor/);
});
test('preferences conflict and SQL direct calls cannot set arbitrary destinations or overwrite another user',async()=>{
 const u=await prospectingUser();await prefs(u.p);await assert.rejects(prefs(u.p),{status:409});await assert.rejects(saveNotificationPreferences(u.p,{...defaults,...{destination:'elsewhere@example.com'}} as any),{status:422});
 await assert.rejects(withWorkspaceTransaction(u.p,c=>c.query("SELECT app.save_notification_preferences(1,$1,NULL)",[{...defaults,email:'true'}])),/NOTIFICATION_INVALID/);
 await assert.rejects(withWorkspaceTransaction(u.p,c=>c.query("SELECT app.save_notification_preferences(1,$1,NULL)",[{...defaults,quiet:{start:'22:00',end:'08:00'}}])),/NOTIFICATION_INVALID/);
});
test('two users read independently and cursors reject another identity',async()=>{
 const u=await prospectingUser(),v=await prospectingUser(),p={...v.p,workspaceId:u.p.workspaceId};await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),p.workspaceId,p.userId,'operator']));
 await prefs(u.p);await prefs(p);await event(u.p);process.env.NOTIFICATIONS_DELIVERY_ENABLED='false';await processNotificationTick({limit:100,signal});const a=await listNotifications(u.p),b=await listNotifications(p);assert.equal(a.unread,1);assert.equal(b.unread,1);await readNotification(u.p,a.items[0].id);assert.equal((await listNotifications(p)).unread,1);
 await assert.rejects(withWorkspaceTransaction(p,c=>c.query('SELECT app.notification_claim(now(),$1)',[randomUUID()])),/permission denied/);
});
test('revoked source connection and unverified account email produce no send',async()=>{
 const u=await prospectingUser();await prefs(u.p);const connection=await event(u.p);process.env.NOTIFICATIONS_DELIVERY_ENABLED='false';await processNotificationTick({limit:100,signal});await testAdmin(c=>c.query("UPDATE app.channel_connection SET state='disconnected' WHERE id=$1",[connection.id]));let calls=0;process.env.NOTIFICATIONS_DELIVERY_ENABLED='true';await processNotificationTick({limit:100,signal},{sendEmail:async(v)=>{if(v.to===u.email)calls++;}});assert.equal(calls,0);
 const v=await prospectingUser();await prefs(v.p);await event(v.p);await testAdmin(c=>c.query('UPDATE auth."user" SET "emailVerified"=false WHERE id=$1',[v.p.userId]));await processNotificationTick({limit:100,signal},{sendEmail:async(input)=>{if(input.to===v.email)calls++;}});assert.equal(calls,0);
});
