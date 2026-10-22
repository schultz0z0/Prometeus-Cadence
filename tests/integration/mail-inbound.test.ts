import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {multiFixture} from './multichannel-helpers.ts';import {testAdmin} from './mail-helpers.ts';
import {webhookRequest} from '../../src/server/channels/webhooks.ts';
import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';
import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';import {materializeDueMessages} from '../../src/server/messaging/outbox.ts';import {claimMailboxSync} from '../../src/server/mail/sync/repository.ts';import {ingestMailBatch} from '../../src/server/mail/ingestion.ts';import {recordEmailConsent} from '../../src/server/messaging/consent.ts';import {prepareMailReply,confirmMailReply} from '../../src/server/messaging/email-replies.ts';import type {MailMessage} from '../../src/domain/mail.ts';
after(async()=>{await getPools().close();await closeDispatchPool();await closeIngressPool();});
async function fixture(){const f=await multiFixture(),review=await preparePublication(f.u.p,f.input),publication=await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material});await materializeDueMessages(new Date(Date.now()+120000).toISOString(),100,f.u.p.workspaceId);const m=(await testAdmin(c=>c.query('SELECT m.*,cm.conversation_id FROM app.email_message m JOIN app.channel_message cm ON cm.workspace_id=m.workspace_id AND cm.id=m.message_id WHERE m.mailbox_id=$1',[f.mailbox.id]))).rows[0];assert.ok(m);return {...f,publication,message:m};}
function incoming(f:Awaited<ReturnType<typeof fixture>>,overrides:Partial<MailMessage>={}):MailMessage{return {remoteId:randomUUID(),remoteThreadId:null,rfcMessageId:'<'+randomUUID()+'@example.net>',inReplyTo:f.message.rfc_message_id,references:[f.message.rfc_message_id],from:f.lead.email!,to:[f.mailbox.address!],subject:'Re: Olá',text:'Podemos conversar',receivedAt:new Date().toISOString(),direction:'inbound',classification:'human',attachments:[],truncated:false,...overrides};}
async function ingest(f:Awaited<ReturnType<typeof fixture>>,messages:MailMessage[]){await testAdmin(c=>c.query("UPDATE app.email_sync_cursor SET next_at=clock_timestamp()-interval '1 second' WHERE mailbox_id=$1",[f.mailbox.id]));const leases=await claimMailboxSync(new Date(Date.now()+1000).toISOString(),{workspaceId:f.u.p.workspaceId,mailboxId:f.mailbox.id,limit:1});assert.equal(leases.length,1);await ingestMailBatch(leases[0],{messages,next:{kind:'imap',path:'INBOX',uidValidity:'1',lastUid:1,watermark:new Date().toISOString()},complete:true,gap:false});}
const state=async(f:Awaited<ReturnType<typeof fixture>>)=>(await testAdmin(c=>c.query('SELECT state FROM app.cadence_enrollment WHERE publication_id=$1',[f.publication.id]))).rows[0].state;
test('human mail reply stops the explicitly linked mixed enrollment without granting WhatsApp consent',async()=>{
 const f=await fixture(),before=(await testAdmin(c=>c.query('SELECT count(*) FROM app.consent_evidence WHERE identity_id=$1',[f.identity]))).rows[0].count;
 await ingest(f,[incoming(f)]);assert.equal(await state(f),'stopped');
 const after=(await testAdmin(c=>c.query('SELECT count(*) FROM app.consent_evidence WHERE identity_id=$1',[f.identity]))).rows[0].count;assert.equal(after,before);
 const outbox=(await testAdmin(c=>c.query('SELECT state FROM app.message_outbox WHERE message_id=$1',[f.message.message_id]))).rows[0];assert.equal(outbox.state,'cancelled');
});
test('automatic replies and incompatible thread or From never stop another conversation',async()=>{
 for(const type of ['automatic','other-from','other-thread']){
  const f=await fixture();await ingest(f,[incoming(f,type==='automatic'?{headers:{'auto-submitted':'auto-replied'}}:type==='other-from'?{from:'other@example.net'}:{inReplyTo:'<other@example.net>',references:['<other@example.net>']})]);assert.equal(await state(f),'active',type);
  const out=(await testAdmin(c=>c.query("SELECT count(*) FROM app.message_outbox WHERE workspace_id=$1",[f.u.p.workspaceId]))).rows[0].count;assert.equal(Number(out),1);
 }
});
test('uncorrelated DSN never suppresses; five distinct linked hard bounces pause the mailbox persistently',async()=>{
 const f=await fixture(),reports:MailMessage[]=[];
 const dsn=(rfc:string)=>incoming(f,{from:'mailer-daemon@example.org',inReplyTo:null,references:[],text:'Delivery failed',deliveryStatus:'Original-Message-ID: '+rfc+'\r\nFinal-Recipient: rfc822; '+f.lead.email+'\r\nAction: failed\r\nStatus: 5.1.1'});
 await ingest(f,[dsn('<forged@example.org>')]);assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.contact_suppression WHERE identity_id=$1',[f.emailIdentity]))).rowCount,0);
 for(let n=0;n<5;n++){
  const mid=n===0?f.message.message_id:randomUUID(),rfc=n===0?f.message.rfc_message_id:'<'+mid+'@example.org>';
  if(n>0)await testAdmin(async c=>{
   await c.query("INSERT INTO app.channel_message(workspace_id,id,connection_id,sender_id,identity_id,conversation_id,channel,direction,text,purpose,state) VALUES($1,$2,$3,$4,$5,$6,'EMAIL','outbound','Fixture','campaign','accepted')",[f.u.p.workspaceId,mid,f.mailbox.id,f.mailSenderId,f.emailIdentity,f.message.conversation_id]);
   await c.query("INSERT INTO app.email_message(workspace_id,message_id,mailbox_id,thread_id,rfc_message_id,subject,from_address,to_addresses,origin,classification) SELECT workspace_id,$2,mailbox_id,thread_id,$3,subject,from_address,to_addresses,'app','human' FROM app.email_message WHERE message_id=$1",[f.message.message_id,mid,rfc]);
  });else await testAdmin(c=>c.query("UPDATE app.channel_message SET state='accepted' WHERE id=$1",[mid]));
  reports.push(dsn(rfc));
 }
 await ingest(f,reports);await ingest(f,reports);
 const box=(await testAdmin(c=>c.query('SELECT bounce_paused FROM app.email_mailbox WHERE id=$1',[f.mailbox.id]))).rows[0];assert.equal(box.bounce_paused,true);
 assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.contact_suppression WHERE identity_id=$1',[f.emailIdentity]))).rowCount,1);
 const events=(await testAdmin(c=>c.query('SELECT count(*) FROM app.email_bounce WHERE mailbox_id=$1',[f.mailbox.id]))).rows[0];assert.equal(Number(events.count),5);
});
test('email consent binds the current lead address and manual reply stays in its reviewed thread',async()=>{
 const f=await fixture();
 await assert.rejects(recordEmailConsent(f.u.p,{requestId:randomUUID(),leadId:f.lead.id,address:'wrong@example.net',purpose:'campaign',source:'QA',occurredAt:new Date().toISOString(),evidence:'Explicit address authorization'}),{status:409});
 await ingest(f,[incoming(f)]);
 const body={messageId:randomUUID(),content:{kind:'email' as const,subject:'Re: '+f.message.subject,text:'Obrigado pelo retorno',signature:'Equipe QA'}},review=await prepareMailReply(f.u.p,f.message.conversation_id,body);assert.deepEqual(review.blockers,[]);
 const command={...body,requestId:randomUUID(),reviewToken:review.token},reply=await confirmMailReply(f.u.p,f.message.conversation_id,command);assert.deepEqual(await confirmMailReply(f.u.p,f.message.conversation_id,command),reply);
 assert.equal(reply.conversationId,f.message.conversation_id);
 const metadata=(await testAdmin(c=>c.query('SELECT in_reply_to FROM app.email_message WHERE message_id=$1',[reply.id]))).rows[0];assert.ok(metadata.in_reply_to);
});
test('unthreaded opt-out stops mixed follow-ups while a WhatsApp reply leaves an in-flight email honest',async()=>{
 const f=await fixture();await ingest(f,[incoming(f,{inReplyTo:null,references:[],text:'SAIR'})]);assert.equal(await state(f),'stopped');
 const g=await fixture();await testAdmin(c=>c.query("UPDATE app.message_outbox SET state='dispatching' WHERE message_id=$1",[g.message.message_id]));
 await webhookRequest(g.request({messages:[{id:'wamid.'+randomUUID(),from:g.lead.phone!.slice(1),timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Quero conversar'}}]}),g.publicId,'meta');
 assert.equal(await state(g),'stopped');assert.equal((await testAdmin(c=>c.query('SELECT state FROM app.message_outbox WHERE message_id=$1',[g.message.message_id]))).rows[0].state,'dispatching');
});
test('soft bounce holds only the enrollment and a new human mail thread can receive a reviewed reply',async()=>{
 const f=await fixture();await testAdmin(c=>c.query("UPDATE app.channel_message SET state='uncertain' WHERE id=$1",[f.message.message_id]));
 await ingest(f,[incoming(f,{from:'mailer-daemon@example.org',deliveryStatus:'Original-Message-ID: '+f.message.rfc_message_id+'\r\nFinal-Recipient: rfc822; '+f.lead.email+'\r\nAction: delayed\r\nStatus: 4.2.2'})]);assert.equal(await state(f),'blocked');assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.contact_suppression WHERE identity_id=$1',[f.emailIdentity]))).rowCount,0);
 const g=await fixture(),mail=incoming(g,{from:'new@example.net',inReplyTo:null,references:[],subject:'Dúvida sobre o serviço'});await ingest(g,[mail]);
 const conv=(await testAdmin(c=>c.query('SELECT conversation_id FROM app.channel_message WHERE connection_id=$1 AND remote_id=$2',[g.mailbox.id,mail.remoteId]))).rows[0].conversation_id;
 const body={messageId:randomUUID(),content:{kind:'email' as const,subject:'Re: Dúvida sobre o serviço',text:'Vamos conversar',signature:'Equipe QA'}},review=await prepareMailReply(g.u.p,conv,body);assert.deepEqual(review.blockers,[]);await confirmMailReply(g.u.p,conv,{...body,requestId:randomUUID(),reviewToken:review.token});assert.equal(await state(g),'active');
});
