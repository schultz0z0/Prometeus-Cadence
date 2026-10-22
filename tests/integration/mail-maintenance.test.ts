import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mailUser,smtpMailboxInput,testAdmin} from './mail-helpers.ts';import {saveMailbox} from '../../src/server/mail/repository.ts';import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import {pruneMailMetadata} from '../../src/server/mail/maintenance.ts';
import {multiFixture} from './multichannel-helpers.ts';import {claimMailboxSync} from '../../src/server/mail/sync/repository.ts';import {ingestMailBatch} from '../../src/server/mail/ingestion.ts';
after(async()=>{await getPools().close();await closeDispatchPool();});
test('maintenance expires old OAuth material and prunes only old technical metadata within bounds',async()=>{
 const u=await mailUser(),box=await saveMailbox(u.p,smtpMailboxInput()),now=new Date().toISOString(),old=randomUUID(),fresh=randomUUID();
 await testAdmin(async c=>{for(const [id,expired] of [[old,true],[fresh,false]] as const)await c.query("INSERT INTO app.email_oauth_attempt(workspace_id,id,connection_id,user_id,session_hash,state_hash,revision,envelope,expires_at) VALUES($1,$2,$3,$4,'session',$2,1,'{}',$5)",[u.p.workspaceId,id,box.id,u.p.userId,expired?new Date(Date.now()-1000):new Date(Date.now()+600000)]);});
 const result=await pruneMailMetadata(now);assert.equal(result.oauthAttempts,1);
 assert.equal((await testAdmin(c=>c.query('SELECT id FROM app.email_oauth_attempt WHERE id=$1',[old]))).rowCount,0);assert.equal((await testAdmin(c=>c.query('SELECT id FROM app.email_oauth_attempt WHERE id=$1',[fresh]))).rowCount,1);
 await assert.rejects(pruneMailMetadata(new Date(Date.now()+86400000).toISOString()));
});
test('retention keeps message text references dedup cursors and classification decisions',async()=>{
 const f=await multiFixture();await testAdmin(c=>c.query("UPDATE app.email_sync_cursor SET next_at=clock_timestamp()-interval '1 second' WHERE mailbox_id=$1",[f.mailbox.id]));const [lease]=await claimMailboxSync(new Date().toISOString(),{workspaceId:f.u.p.workspaceId,mailboxId:f.mailbox.id,limit:1});assert.ok(lease);
 await ingestMailBatch(lease,{messages:[{remoteId:'retained',remoteThreadId:null,rfcMessageId:'<retained@example.net>',inReplyTo:null,references:[],from:'contact@example.net',to:['Sales+qa@example.org'],subject:'Histórico',text:'Preservar o texto',receivedAt:new Date().toISOString(),direction:'inbound',classification:'human',attachments:[],truncated:false,headers:{'auto-submitted':'no'}}],next:{kind:'imap',path:'INBOX',uidValidity:'1',lastUid:1,watermark:new Date().toISOString()},complete:true,gap:false});
 await testAdmin(c=>c.query("UPDATE app.channel_message SET created_at=clock_timestamp()-interval '91 days' WHERE conversation_id IN(SELECT conversation_id FROM app.email_thread WHERE mailbox_id=$1)",[f.mailbox.id]));
 const before=(await testAdmin(c=>c.query('SELECT classification_evidence FROM app.email_message WHERE mailbox_id=$1',[f.mailbox.id]))).rows[0];assert.ok(before.classification_evidence.headers);
 assert.equal((await pruneMailMetadata(new Date().toISOString())).messages,1);
 const after=(await testAdmin(c=>c.query('SELECT em.*,cm.text FROM app.email_message em JOIN app.channel_message cm ON cm.workspace_id=em.workspace_id AND cm.id=em.message_id WHERE em.mailbox_id=$1',[f.mailbox.id]))).rows[0];assert.equal(after.text,'Preservar o texto');assert.equal(after.rfc_message_id,'<retained@example.net>');assert.equal(after.classification_evidence.headers,undefined);assert.deepEqual(after.classification_evidence.assessment,before.classification_evidence.assessment);
 assert.equal((await pruneMailMetadata(new Date().toISOString())).messages,0);assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.email_sync_cursor WHERE mailbox_id=$1',[f.mailbox.id]))).rowCount,1);
});
