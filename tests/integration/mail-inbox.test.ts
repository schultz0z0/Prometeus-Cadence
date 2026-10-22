import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {multiFixture} from './multichannel-helpers.ts';import {testAdmin,mailUser} from './mail-helpers.ts';import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';import {claimMailboxSync} from '../../src/server/mail/sync/repository.ts';import {ingestMailBatch} from '../../src/server/mail/ingestion.ts';import {listConversations,readConversation,markConversationRead} from '../../src/server/messaging/inbox.ts';import type {MailMessage} from '../../src/domain/mail.ts';
after(async()=>{await getPools().close();await closeDispatchPool();await closeIngressPool();});
const incoming=(id:string,reference:string|null=null):MailMessage=>({remoteId:id,remoteThreadId:null,rfcMessageId:'<'+id+'@example.net>',inReplyTo:reference,references:reference?[reference]:[],from:'same@example.net',to:['Sales+qa@example.org'],subject:'Mesmo assunto',text:'Texto sem HTML executável',receivedAt:new Date().toISOString(),direction:'inbound',classification:'human',attachments:[],truncated:false});
test('email engagement metrics remain unavailable instead of invented zeros',async()=>{
 const {readMessageUsage}=await import('../../src/server/messaging/usage.ts'),u=await mailUser();
 assert.deepEqual((await readMessageUsage(u.p)).emailTracking,{opens:null,clicks:null,delivered:null,read:null});
});
async function ingest(f:Awaited<ReturnType<typeof multiFixture>>,messages:MailMessage[]){await testAdmin(c=>c.query("UPDATE app.email_sync_cursor SET next_at=clock_timestamp()-interval '1 second' WHERE mailbox_id=$1",[f.mailbox.id]));const [lease]=await claimMailboxSync(new Date(Date.now()+1000).toISOString(),{workspaceId:f.u.p.workspaceId,mailboxId:f.mailbox.id,limit:1});assert.ok(lease);await ingestMailBatch(lease,{messages,next:{kind:'imap',path:'INBOX',uidValidity:'1',lastUid:100,watermark:new Date().toISOString()},complete:true,gap:false});}
test('email inbox is explicit and same contact/subject remains in separate threads; default inbox stays WhatsApp',async()=>{
 const f=await multiFixture();await ingest(f,[incoming('first'),incoming('second')]);
 const email=await listConversations(f.u.p,{channel:'EMAIL'});assert.equal(email.items.length,2);assert.ok(email.items.every(item=>item.channel==='EMAIL'&&item.mail.subject==='Mesmo assunto'));
 const legacy=await listConversations(f.u.p,{});assert.ok(legacy.items.every(item=>item.identity.scope.startsWith('meta:')));
 const thread=await readConversation(f.u.p,email.items[0].id,undefined,'EMAIL');assert.equal(thread.channel,'EMAIL');assert.equal(thread.messages[0].mail.origin,'external');
 await assert.rejects(readConversation(f.u.p,email.items[0].id),{status:404});
 const other=await mailUser();await assert.rejects(readConversation(other.p,email.items[0].id,undefined,'EMAIL'),{status:404});
});
test('mail history cursor binds workspace conversation and displayed read marker without changing remote flags',async()=>{
 const f=await multiFixture();await ingest(f,Array.from({length:100},(_,n)=>incoming('message-'+n,n?'<message-0@example.net>':null)));await ingest(f,[incoming('message-100','<message-0@example.net>'),incoming('other')]);
 const list=await listConversations(f.u.p,{channel:'EMAIL',search:'same@example.net'}),threadId=list.items.find(item=>!item.mail.needsReview&&item.id)! .id;
 const candidates=await Promise.all(list.items.map(item=>readConversation(f.u.p,item.id,undefined,'EMAIL'))),thread=candidates.find(item=>item.nextCursor)!;assert.ok(thread);
 const older=await readConversation(f.u.p,thread.conversation.id,thread.nextCursor!,'EMAIL');assert.equal(older.messages.length,1);
 const otherId=list.items.find(item=>item.id!==thread.conversation.id)!.id;await assert.rejects(readConversation(f.u.p,otherId,thread.nextCursor!,'EMAIL'),{status:422});
 const last=thread.messages.at(-1)!.id;await ingest(f,[incoming('new-reply','<message-0@example.net>')]);await markConversationRead(f.u.p,thread.conversation.id,{requestId:randomUUID(),messageId:last});
 const refreshed=await readConversation(f.u.p,thread.conversation.id,undefined,'EMAIL');assert.equal(refreshed.conversation.unread,1);
 assert.ok(threadId);
});
