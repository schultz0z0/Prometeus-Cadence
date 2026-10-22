import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {publicationFixture} from './messaging-helpers.ts';import {testAdmin,smtpMailboxInput} from './mail-helpers.ts';
import {saveMailbox} from '../../src/server/mail/repository.ts';import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';
import {prepareChannelTest,confirmChannelTest} from '../../src/server/messaging/replies.ts';
import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';import type {PublicationInputV2} from '../../src/domain/cadence-runtime.ts';
after(async()=>{await getPools().close();await closeDispatchPool();await closeIngressPool();});
import {multiFixture} from './multichannel-helpers.ts';
test('aggregate rendered email size including Unicode subject signature and footer is blocked before publication',async()=>{
 const f=await multiFixture(true);await testAdmin(c=>c.query("UPDATE app.email_mailbox SET signature=$2 WHERE id=$1",[f.mailbox.id,'S'.repeat(100)]));
 for(const text of ['A'.repeat(65500),'é'.repeat(32750)]){
  const input={...f.input,steps:{...f.input.steps,first:{...f.input.steps.first,content:{kind:'email' as const,subject:'Assunto',text,signature:'S'.repeat(100)}}}},review=await preparePublication(f.u.p,input);
  assert.ok(review.blockers.some(b=>b.includes('EMAIL_TEXT_INVALID')));await assert.rejects(confirmPublication(f.u.p,{...input,requestId:randomUUID(),reviewToken:review.token,material:review.material}),{status:409});
 }
 assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.cadence_publication WHERE workspace_id=$1',[f.u.p.workspaceId]))).rowCount,0);
});

test('email-only publication needs no telephone and creates exactly one immutable enrollment on confirm',async()=>{
 const f=await multiFixture(true),review=await preparePublication(f.u.p,f.input);assert.deepEqual(review.blockers,[]);assert.equal(review.snapshot.version,2);assert.match(review.snapshot.recipients[0].steps.first.preview,/contact|Podemos/);assert.match(review.snapshot.recipients[0].steps.first.preview,/unsubscribe/);
 const before=await testAdmin(c=>c.query('SELECT * FROM app.cadence_publication WHERE workspace_id=$1',[f.u.p.workspaceId]));assert.equal(before.rowCount,0);
 const command={...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material};const publication=await confirmPublication(f.u.p,command);assert.deepEqual(await confirmPublication(f.u.p,command),publication);
 const saved=await testAdmin(c=>c.query('SELECT * FROM app.cadence_enrollment WHERE publication_id=$1',[publication.id]));assert.equal(saved.rowCount,1);assert.equal(saved.rows[0].identity_id,null);
 const now=new Date(f.now.getTime()+120000).toISOString();assert.equal(await materializeDueMessages(now,100,f.u.p.workspaceId),1);assert.equal(await materializeDueMessages(now,100,f.u.p.workspaceId),0);
});
test('mixed publication freezes per-step senders and blocks missing email authorization',async()=>{
 const f=await multiFixture(),review=await preparePublication(f.u.p,f.input);assert.deepEqual(review.blockers,[]);assert.equal(review.snapshot.recipients[0].steps.second.sender.id,f.sender.id);assert.equal(review.snapshot.recipients[0].steps.first.sender.id,f.mailSenderId);
 await testAdmin(c=>c.query('DELETE FROM app.consent_evidence WHERE identity_id=$1',[f.emailIdentity]));
 const blocked=await preparePublication(f.u.p,f.input);assert.ok(blocked.blockers.some(b=>b.includes('EMAIL_AUTHORIZATION_REQUIRED')));
 await assert.rejects(confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material}),{status:409});
});
test('mailbox signature or recipient changes invalidate a publication review',async()=>{
 const f=await multiFixture(true),review=await preparePublication(f.u.p,f.input);
 await saveMailbox(f.u.p,{...smtpMailboxInput(),id:f.mailbox.id,expectedRevision:1,requestId:randomUUID(),signature:'Outra assinatura',credentials:{smtpPassword:'',imapPassword:''}});
 await assert.rejects(confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material}),{status:409});
});
test('legacy reviewed WhatsApp test still creates a conversation for a newly authorized contact',async()=>{
 const f=await publicationFixture(),input={senderId:f.sender.id,phone:'+5541977777777',content:{...f.input.bindings.second,variables:{'body.1':'Contato QA'}},consent:{source:'fixture',occurredAt:new Date().toISOString(),evidence:'Owned authorized fixture recipient'}};
 const review=await prepareChannelTest(f.u.p,f.connection.id,input);assert.deepEqual(review.blockers,[]);
 const result=await confirmChannelTest(f.u.p,f.connection.id,{...input,requestId:randomUUID(),reviewToken:review.token});assert.equal(result.state,'pending');
});
test('mixed sequence never skips a predecessor and anchors the next channel to acceptance',async()=>{
 const f=await multiFixture(),review=await preparePublication(f.u.p,f.input),publication=await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material});
 const tick=new Date(f.now.getTime()+120000).toISOString();assert.equal(await materializeDueMessages(tick,100,f.u.p.workspaceId),1);
 assert.equal(await materializeDueMessages(new Date(f.now.getTime()+10*86400000).toISOString(),100,f.u.p.workspaceId),0);
 const first=(await testAdmin(c=>c.query('SELECT * FROM app.message_outbox WHERE publication_id=$1',[publication.id]))).rows[0];assert.equal(first.prepared_send.channel,'EMAIL');assert.match(first.prepared_send.rfcMessageId,/^<.+@example.org>$/);
 const accepted=new Date(f.now.getTime()+86400000).toISOString();
 await testAdmin(async c=>{await c.query("UPDATE app.message_outbox SET state='accepted',accepted_at=$2 WHERE message_id=$1",[first.message_id,accepted]);await c.query("UPDATE app.channel_message SET state='accepted' WHERE id=$1",[first.message_id]);await c.query('UPDATE app.cadence_enrollment SET next_step=1,last_accepted_at=$2,schedule_pending=true WHERE publication_id=$1',[publication.id,accepted]);});
 assert.equal(await materializeDueMessages(accepted,100,f.u.p.workspaceId),0);
 assert.equal(await materializeDueMessages(new Date(Date.parse(accepted)+3*86400000).toISOString(),100,f.u.p.workspaceId),1);
 const second=(await testAdmin(c=>c.query('SELECT * FROM app.message_outbox WHERE publication_id=$1 AND step_index=1',[publication.id]))).rows[0];assert.equal(second.prepared_send.channel,'WHATSAPP');assert.equal(second.sender_id,f.sender.id);
 assert.ok(second.next_at.getTime()>=Date.parse(accepted)+2*86400000);
});
test('email recipient, sender limit and workspace revision changes require a fresh review',async()=>{
 for(const mutation of ['recipient','sender','limits','revision']){
  const f=await multiFixture(true),review=await preparePublication(f.u.p,f.input);
  await testAdmin(async c=>{
   if(mutation==='recipient')await c.query("UPDATE app.lead SET payload=jsonb_set(payload,'{email}','\"other@example.net\"') WHERE id=$1",[f.lead.id]);
   if(mutation==='sender')await c.query('UPDATE app.channel_sender SET daily_limit=9 WHERE id=$1',[f.mailSenderId]);
   if(mutation==='limits')await c.query("UPDATE app.messaging_channel_limits SET daily_limit=9 WHERE workspace_id=$1 AND channel='EMAIL'",[f.u.p.workspaceId]);
   if(mutation==='revision')await c.query('UPDATE app.workspace_meta SET revision=revision+1 WHERE workspace_id=$1',[f.u.p.workspaceId]);
  });
  await assert.rejects(confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material}),{status:409});
 }
});
