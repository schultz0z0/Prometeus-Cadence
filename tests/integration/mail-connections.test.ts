import test,{after} from 'node:test';import assert from 'node:assert/strict';
import {getPools} from '../../src/server/db/pool.ts';import {saveMailbox} from '../../src/server/mail/repository.ts';import {verifyMailbox} from '../../src/server/mail/connections.ts';
import {mailUser,smtpMailboxInput,testAdmin} from './mail-helpers.ts';import {mailTransports} from '../fixtures/mail-transports.ts';
import {randomUUID} from 'node:crypto';
after(async()=>getPools().close());
test('saving another mailbox revision invalidates ownership proof freshness and active sync lease',async()=>{
 const u=await mailUser(),input=smtpMailboxInput(),box=await saveMailbox(u.p,input);
 await testAdmin(async c=>{await c.query("UPDATE app.email_mailbox SET proof_verified=true,send_verified=true,read_verified=true,baseline_at=clock_timestamp(),last_synced_at=clock_timestamp(),sync_state='ready' WHERE id=$1",[box.id]);await c.query("INSERT INTO app.email_sync_cursor(workspace_id,mailbox_id,cursor,lease_token,lease_until,fence) VALUES($1,$2,'{\"kind\":\"imap\"}','old-lease',clock_timestamp()+interval '90 seconds',10) ON CONFLICT(workspace_id,mailbox_id,folder) DO UPDATE SET cursor=EXCLUDED.cursor,lease_token=EXCLUDED.lease_token,lease_until=EXCLUDED.lease_until,fence=10",[u.p.workspaceId,box.id]);});
 await saveMailbox(u.p,{...input,id:box.id,expectedRevision:1,requestId:randomUUID(),config:{...input.config,imapHost:'new-imap.example.org'}});
 const row=(await testAdmin(c=>c.query('SELECT * FROM app.email_mailbox WHERE id=$1',[box.id]))).rows[0],cursor=(await testAdmin(c=>c.query('SELECT * FROM app.email_sync_cursor WHERE mailbox_id=$1',[box.id]))).rows[0];
 assert.equal(row.proof_verified,false);assert.equal(row.baseline_at,null);assert.equal(row.last_synced_at,null);assert.equal(row.sync_state,'baseline');assert.equal(cursor.cursor,null);assert.equal(cursor.lease_token,null);assert.ok(Number(cursor.fence)>10);
});
test('SMTP login verification does not claim an address or mark campaigns ready without inbox proof',async()=>{
 const u=await mailUser(),box=await saveMailbox(u.p,smtpMailboxInput()),f=await mailTransports();
 try{const verified=await verifyMailbox(u.p,box.id,1,f.deps);assert.equal(verified.sendVerified,true);assert.equal(verified.readVerified,true);assert.equal(verified.state,'verifying');assert.ok(verified.senderId);assert.equal((await testAdmin(c=>c.query('SELECT ready FROM app.channel_sender WHERE id=$1',[verified.senderId]))).rows[0].ready,false);assert.equal(f.smtp.state.dataCount,0);
 const claims=await testAdmin(c=>c.query('SELECT * FROM app.email_address_ownership WHERE workspace_id=$1',[u.p.workspaceId]));assert.equal(claims.rowCount,0);
 }finally{await f.close();}
});
