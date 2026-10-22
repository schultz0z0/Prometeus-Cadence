import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {multiFixture} from './multichannel-helpers.ts';import {testAdmin} from './mail-helpers.ts';
import {prepareMailReconciliation} from '../../src/server/messaging/email-reconciliation.ts';
import {claimMailboxSync} from '../../src/server/mail/sync/repository.ts';import {ingestMailBatch} from '../../src/server/mail/ingestion.ts';import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';import {claimDispatch,leaseArgs} from '../../src/server/messaging/lease.ts';import {dispatchOne} from '../../src/server/messaging/dispatch.ts';import {dispatchPool,closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {getPools} from '../../src/server/db/pool.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';import type {MailAdapter} from '../../src/server/mail/providers/contracts.ts';
after(async()=>{await getPools().close();await closeDispatchPool();await closeIngressPool();});
const fake=(sendOnce:MailAdapter['sendOnce']):MailAdapter=>({verify:async()=>{throw Error('not used');},readBatch:async()=>{throw Error('not used');},findSent:async()=>null,sendOnce});
async function queued(){const f=await multiFixture(true),review=await preparePublication(f.u.p,f.input);assert.deepEqual(review.blockers,[]);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material});const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100,f.u.p.workspaceId);const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);return {...f,now,lease};}
test('email timeout after acceptance retains one reservation and never repeats the POST',async()=>{
 const f=await queued();let count=0;
 await dispatchOne(f.lease,{now:()=>f.now,mailAdapter:fake(async(_config,send)=>{count++;assert.match(send.rfcMessageId,/^</);return {kind:'uncertain',code:'LOST_AFTER_ACCEPTANCE'};})});
 assert.equal(count,1);assert.equal(await claimDispatch(f.now,{workspaceId:f.u.p.workspaceId}),null);
 const rows=await testAdmin(c=>c.query('SELECT state FROM app.message_outbox WHERE message_id=$1',[f.lease.messageId]));assert.equal(rows.rows[0].state,'uncertain');
 const usage=await testAdmin(c=>c.query("SELECT event FROM app.message_usage_ledger WHERE message_id=$1",[f.lease.messageId]));assert.deepEqual(usage.rows.map(r=>r.event),['reserve']);
});
test('email SQL barrier catches consent, sync and limit changes after reading a lease',async()=>{
 for(const mutation of ['consent','sync','limits','role']){
  const f=await queued(),ctx=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS ctx',leaseArgs(f.lease))).rows[0].ctx;
  await testAdmin(async c=>{if(mutation==='consent')await c.query('DELETE FROM app.consent_evidence WHERE identity_id=$1',[f.emailIdentity]);if(mutation==='sync')await c.query("UPDATE app.email_mailbox SET last_synced_at=clock_timestamp()-interval '301 seconds' WHERE id=$1",[f.mailbox.id]);if(mutation==='limits')await c.query("UPDATE app.messaging_channel_limits SET daily_limit=1 WHERE workspace_id=$1 AND channel='EMAIL'",[f.u.p.workspaceId]);if(mutation==='role')await c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']);});
  const gate=(await dispatchPool().query('SELECT app.begin_message_dispatch($1,$2,$3,$4,$5,$6,$7) AS gate',[f.lease.workspaceId,f.lease.messageId,f.lease.attemptId,f.lease.token,f.lease.fence,ctx.guard,f.now])).rows[0].gate;assert.equal(gate.allowed,false,mutation);
 }
});
test('proven temporary email rejection stops after three sends and stable RFC identity',async()=>{
 const f=await queued();let count=0,rfc='';const adapter=fake(async(_config,send)=>{count++;if(rfc)assert.equal(send.rfcMessageId,rfc);rfc=send.rfcMessageId;return {kind:'not_accepted',code:'SMTP_451',retryable:true,retryAfterMs:30000};});
 let now=f.now,lease=f.lease;
 for(let attempt=0;attempt<3;attempt++){await dispatchOne(lease,{now:()=>now,mailAdapter:adapter});if(attempt<2){now=new Date(Date.parse(now)+240000).toISOString();await testAdmin(c=>c.query('UPDATE app.email_mailbox SET last_synced_at=$2 WHERE id=$1',[f.mailbox.id,now]));const next=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(next);lease=next;}}
 assert.equal(count,3);assert.equal(await claimDispatch(new Date(Date.parse(now)+240000).toISOString(),{workspaceId:f.u.p.workspaceId}),null);
});
test('empty Sent search cannot authorize accepted reconciliation or a resend',async()=>{
 const f=await queued();await dispatchOne(f.lease,{now:()=>f.now,mailAdapter:fake(async()=>({kind:'uncertain',code:'LOST'}))});
 await assert.rejects(prepareMailReconciliation(f.u.p,f.lease.messageId,{resolution:'accepted',remoteId:'remote-1',evidence:'The administrator looked at the provider delivery logs carefully.',reference:'https://smtp.example.org/logs/1',proofKind:'provider-log',verifiedByUser:true},{adapter:fake(async()=>{throw Error('must not send');})}),{status:409});
 assert.equal(await claimDispatch(f.now,{workspaceId:f.u.p.workspaceId}),null);
});
test('two email cadences share a mailbox channel quota under concurrent workers',async()=>{
 const f=await multiFixture(true);await testAdmin(c=>c.query("UPDATE app.messaging_channel_limits SET daily_limit=1 WHERE workspace_id=$1 AND channel='EMAIL'",[f.u.p.workspaceId]));
 const second=randomUUID();await testAdmin(c=>c.query('INSERT INTO app.cadence(workspace_id,id,list_id,payload) VALUES($1,$2,$3,$4)',[f.u.p.workspaceId,second,f.cadence.listId,{...f.cadence,id:second}]));
 for(const cadenceId of [f.cadence.id,second]){const input={...f.input,cadenceId},review=await preparePublication(f.u.p,input);assert.deepEqual(review.blockers,[]);await confirmPublication(f.u.p,{...input,requestId:randomUUID(),reviewToken:review.token,material:review.material});}
 const now=new Date(f.now.getTime()+120000).toISOString();await materializeDueMessages(now,100,f.u.p.workspaceId);
 const a=await claimDispatch(now,{workspaceId:f.u.p.workspaceId}),b=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(a&&b);let posts=0;
 const adapter=fake(async()=>{posts++;return {kind:'accepted',remoteId:'email-'+randomUUID(),acceptedAt:now};});await Promise.all([a,b].map(lease=>dispatchOne(lease,{now:()=>now,mailAdapter:adapter})));assert.equal(posts,1);
});
test('authenticated Sent observation supersedes negative evidence without a duplicate message or POST',async()=>{
 const f=await queued();let posts=0;let sent:any;
 await dispatchOne(f.lease,{now:()=>f.now,mailAdapter:fake(async(_config,send)=>{posts++;sent=send;return {kind:'uncertain',code:'LOST'};})});
 await withWorkspaceTransaction(f.u.p,c=>c.query('SELECT app.admin_reconcile_message($1,$2,$3,NULL,$4)',[f.lease.messageId,f.lease.attemptId,'not_accepted',{evidence:'Manually checked provider logs, before the Sent folder eventually became consistent.',verifiedByUser:true}]));
 const leases=await claimMailboxSync(new Date(Date.now()+1000).toISOString(),{workspaceId:f.u.p.workspaceId,mailboxId:f.mailbox.id,limit:1});assert.equal(leases.length,1);
 const mail={remoteId:'remote-sent-1',remoteThreadId:'thread-1',rfcMessageId:sent.rfcMessageId,inReplyTo:null,references:[],from:sent.address,to:[sent.to],subject:sent.content.subject,text:sent.content.text,receivedAt:f.now,direction:'outbound' as const,classification:'human' as const,attachments:[],truncated:false};
 const batch={messages:[mail],next:{kind:'imap' as const,path:'INBOX',uidValidity:'1',lastUid:1,watermark:f.now},complete:true,gap:false};
 await ingestMailBatch(leases[0],batch);
 const rows=await testAdmin(c=>c.query('SELECT state,remote_id FROM app.message_outbox WHERE message_id=$1',[f.lease.messageId]));assert.equal(rows.rows[0].state,'accepted');assert.equal(rows.rows[0].remote_id,'remote-sent-1');
 const count=await testAdmin(c=>c.query("SELECT count(*) FROM app.channel_message WHERE connection_id=$1 AND direction='outbound'",[f.mailbox.id]));assert.equal(Number(count.rows[0].count),1);assert.equal(posts,1);
 const usage=await testAdmin(c=>c.query("SELECT count(*) FROM app.message_usage_ledger WHERE message_id=$1 AND event='consume'",[f.lease.messageId]));assert.equal(Number(usage.rows[0].count),1);
});
test('a confirmed EMAIL WhatsApp EMAIL sequence dispatches each frozen channel after acceptance',async()=>{
 const f=await multiFixture(),review=await preparePublication(f.u.p,f.input);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material});
 process.env.CHANNEL_PUBLIC_BASE_URL='https://hooks.example';let mailCount=0,waCount=0;
 const base=Date.now();
 for(const [index,days]of [0,3,8].entries()){
  const now=new Date(base+days*86400000+120000).toISOString();
  await testAdmin(c=>c.query('UPDATE app.email_mailbox SET last_synced_at=$2 WHERE id=$1',[f.mailbox.id,now]));
  assert.equal(await materializeDueMessages(now,100,f.u.p.workspaceId),1);
  const lease=await claimDispatch(now,{workspaceId:f.u.p.workspaceId});assert.ok(lease);
  await dispatchOne(lease,{now:()=>now,mailAdapter:fake(async(_config,send)=>{mailCount++;assert.equal(send.to,f.lead.email);return {kind:'accepted',remoteId:'mail-'+index,acceptedAt:now};}),adapter:{...f.adapter,sendOnce:async()=>{waCount++;return {kind:'accepted',remoteId:'wamid.mixed.'+index,acceptedAt:now};}}});
  const row=(await testAdmin(c=>c.query('SELECT state FROM app.message_outbox WHERE message_id=$1',[lease.messageId]))).rows[0];assert.equal(row.state,'accepted');
  assert.equal(await materializeDueMessages(now,100,f.u.p.workspaceId),0);
 }
 assert.equal(mailCount,2);assert.equal(waCount,1);
});
