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
test('held email thread requires scoped admin acknowledgement of the current history and fresh sync before reviewed reply',async()=>{
 const {acknowledgeMailThread}=await import('../../src/server/mail/thread-review.ts'),{withWorkspaceTransaction}=await import('../../src/server/db/transaction.ts');
 const f=await fixture();await ingest(f,[incoming(f,{truncated:true})]);
 // A subsequent complete human message does not silently clear the prior hold.
 await ingest(f,[incoming(f)]);const id=f.message.conversation_id,body={messageId:randomUUID(),content:{kind:'email' as const,subject:'Re: '+f.message.subject,text:'Obrigado pelo retorno',signature:'Equipe QA'}};
 assert.ok((await prepareMailReply(f.u.p,id,body)).blockers.includes('EMAIL_THREAD_REVIEW_REQUIRED'));
 const latest=async()=>(await testAdmin(c=>c.query('SELECT id FROM app.channel_message WHERE conversation_id=$1 ORDER BY message_order DESC LIMIT 1',[id]))).rows[0].id as string;
 const command={requestId:randomUUID(),expectedRevision:1,lastMessageId:await latest(),acknowledge:true as const,reason:'Revisei a mensagem completa na caixa original e a identidade do contato.'};
 const other=await fixture();await assert.rejects(acknowledgeMailThread(other.u.p,id,command),{status:404});
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']));await assert.rejects(acknowledgeMailThread(f.u.p,id,command),{status:403});await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'owner']));
 await ingest(f,[incoming(f)]);await assert.rejects(acknowledgeMailThread(f.u.p,id,command),{status:409});
 const current={...command,requestId:randomUUID(),lastMessageId:await latest()};await acknowledgeMailThread(f.u.p,id,current);await acknowledgeMailThread(f.u.p,id,current);
 assert.ok((await prepareMailReply(f.u.p,id,body)).blockers.includes('SENDER_UNAVAILABLE'));
 await withWorkspaceTransaction(f.u.p,c=>c.query('SELECT app.resume_mailbox($1,$2,$3)',[f.mailbox.id,1,'Revisei a lacuna e vou sincronizar novamente antes da retomada.']));
 await ingest(f,[]);const review=await prepareMailReply(f.u.p,id,body);assert.deepEqual(review.blockers,[]);await confirmMailReply(f.u.p,id,{...body,requestId:randomUUID(),reviewToken:review.token});
 assert.equal((await testAdmin(c=>c.query('SELECT count(*) FROM app.email_thread_review WHERE conversation_id=$1',[id]))).rows[0].count,'1');
 await ingest(f,[incoming(f,{truncated:true})]);assert.ok((await prepareMailReply(f.u.p,id,{...body,messageId:randomUUID()})).blockers.includes('EMAIL_THREAD_REVIEW_REQUIRED'));
});
test('returned original DSN MIME headers correlate exact recipient before suppressing or holding enrollment',async()=>{
 const {parseMail}=await import('../../src/server/mail/mime.ts');
 for(const hard of [true,false]){
  const f=await fixture();await testAdmin(c=>c.query("UPDATE app.channel_message SET state='accepted' WHERE id=$1",[f.message.message_id]));
  const raw='From: mailer-daemon@example.org\r\nTo: '+f.mailbox.address+'\r\nMessage-ID: <dsn-'+randomUUID()+'@example.org>\r\nSubject: Delivery report\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="dsn"\r\n\r\n--dsn\r\nContent-Type: text/plain\r\n\r\nDelivery report\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; mx.example.org\r\n\r\nFinal-Recipient: rfc822; '+f.lead.email+'\r\nAction: '+(hard?'failed':'delayed')+'\r\nStatus: '+(hard?'5.1.1':'4.2.2')+'\r\n\r\n--dsn\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: '+f.message.rfc_message_id+'\r\nFrom: '+f.mailbox.address+'\r\nTo: '+f.lead.email+'\r\n\r\n--dsn--\r\n';
  const mail=await parseMail([Buffer.from(raw)],{remoteId:randomUUID(),remoteThreadId:null,direction:'inbound',receivedAt:new Date().toISOString()});await ingest(f,[mail]);
  assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.contact_suppression WHERE identity_id=$1',[f.emailIdentity]))).rowCount,hard?1:0);assert.equal((await testAdmin(c=>c.query('SELECT kind FROM app.email_bounce WHERE mailbox_id=$1',[f.mailbox.id]))).rows[0].kind,hard?'hard-bounce':'soft-bounce');
 }
});
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
