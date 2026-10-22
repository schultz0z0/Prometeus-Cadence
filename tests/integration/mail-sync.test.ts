import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';import {dispatchPool,closeDispatchPool} from '../../src/server/messaging/worker-db.ts';
import {saveMailbox} from '../../src/server/mail/repository.ts';import {claimMailboxSync,readSyncConfig} from '../../src/server/mail/sync/repository.ts';
import {ingestMailBatch} from '../../src/server/mail/ingestion.ts';
import {runMailboxSync} from '../../src/server/mail/sync/service.ts';
import {ensureSyncGmailAccess} from '../../src/server/mail/sync/repository.ts';
import {startGmailAuthorization,finishGmailAuthorization} from '../../src/server/mail/oauth.ts';
import {gmailApi} from '../fixtures/gmail-api.ts';
import {mailUser,smtpMailboxInput,testAdmin} from './mail-helpers.ts';
import type {MailMessage,SyncLease} from '../../src/domain/mail.ts';
after(async()=>{await getPools().close();await closeDispatchPool();});
async function fixture(){const u=await mailUser(),box=await saveMailbox(u.p,smtpMailboxInput());await testAdmin(async c=>{
 await c.query("UPDATE app.email_mailbox SET send_verified=true,read_verified=true,state='verifying' WHERE workspace_id=$1 AND id=$2",[u.p.workspaceId,box.id]);
 await c.query("UPDATE app.channel_connection SET credentials_verified=true WHERE workspace_id=$1 AND id=$2",[u.p.workspaceId,box.id]);
 await c.query("INSERT INTO app.channel_sender(workspace_id,id,connection_id,provider,channel,address,external_id,identity_scope) VALUES($1,$2,$3,'smtp-imap','EMAIL',$4,$4,'email')",[u.p.workspaceId,randomUUID(),box.id,box.address]);
 });return {u,box};}
const cursor={kind:'imap' as const,path:'INBOX',uidValidity:'9007199254740993999',lastUid:1,watermark:'2026-10-21T12:00:00Z'};
function incoming(id:string,extra:Partial<MailMessage>={}):MailMessage{return {remoteId:id,remoteThreadId:null,rfcMessageId:'<same@example.net>',inReplyTo:null,references:[],from:'contact@example.net',to:['Sales+qa@example.org'],subject:'Igual assunto',text:'Oi',receivedAt:'2026-10-21T12:00:00Z',direction:'inbound',classification:'human',attachments:[],truncated:false,...extra};}
async function lease(f:Awaited<ReturnType<typeof fixture>>):Promise<SyncLease>{const result=await claimMailboxSync(new Date().toISOString(),{workspaceId:f.u.p.workspaceId,mailboxId:f.box.id,limit:1});assert.equal(result.length,1);return result[0];}
test('sync claims are exclusive scoped and stale fenced credentials cannot be read',async()=>{
 const f=await fixture(),l=await lease(f);assert.equal((await claimMailboxSync(new Date().toISOString(),{workspaceId:f.u.p.workspaceId,mailboxId:f.box.id,limit:1})).length,0);
 assert.equal((await readSyncConfig(l)).mailbox.id,f.box.id);
 await assert.rejects(readSyncConfig({...l,token:randomUUID()}));await assert.rejects(dispatchPool().query('SELECT * FROM app.email_sync_cursor'),{code:'42501'});
});
test('committed partial sync deduplicates replay and never marks incomplete mailbox fresh',async()=>{
 const f=await fixture(),l=await lease(f),mail=incoming('uid:1');
 await ingestMailBatch(l,{messages:[mail],next:cursor,complete:false,gap:false});
 const state=await testAdmin(async c=>(await c.query('SELECT sync_state,last_synced_at FROM app.email_mailbox WHERE id=$1',[f.box.id])).rows[0]);assert.equal(state.last_synced_at,null);assert.notEqual(state.sync_state,'ready');
 await testAdmin(c=>c.query("UPDATE app.email_sync_cursor SET next_at=clock_timestamp()-interval '1 second' WHERE mailbox_id=$1",[f.box.id]));const resumed=await lease(f);
 await ingestMailBatch(resumed,{messages:[mail],next:cursor,complete:true,gap:false});
 const count=await testAdmin(c=>c.query('SELECT * FROM app.email_message WHERE mailbox_id=$1',[f.box.id]));assert.equal(count.rowCount,1);
});
test('same subject RFC IDs and contact do not merge distinct threads or different workspaces',async()=>{
 const a=await fixture(),b=await fixture();
 await ingestMailBatch(await lease(a),{messages:[incoming('one'),incoming('two',{rfcMessageId:'<second@example.net>'})],next:cursor,complete:true,gap:false});
 await ingestMailBatch(await lease(b),{messages:[incoming('one')],next:cursor,complete:true,gap:false});
 const rows=await testAdmin(c=>c.query('SELECT workspace_id,count(*)::int AS n FROM app.email_thread GROUP BY workspace_id'));
 assert.equal(rows.rows.find(r=>r.workspace_id===a.u.p.workspaceId).n,2);assert.equal(rows.rows.find(r=>r.workspace_id===b.u.p.workspaceId).n,1);
});
test('truncated incoming content creates visible hold and cursor failure enters recovery',async()=>{
 const f=await fixture();await ingestMailBatch(await lease(f),{messages:[incoming('limited',{truncated:true,classification:'ambiguous'})],next:cursor,complete:true,gap:false});
 const row=await testAdmin(async c=>(await c.query('SELECT sync_state,last_synced_at FROM app.email_mailbox WHERE id=$1',[f.box.id])).rows[0]);assert.equal(row.sync_state,'recovering');assert.equal(row.last_synced_at,null);
 const g=await fixture(),l=await lease(g);
 await runMailboxSync(l,{adapter:{verify:async()=>{throw Error('unused');},sendOnce:async()=>{throw Error('unused');},findSent:async()=>null,readBatch:async()=>{throw Error('IMAP_UIDVALIDITY_CHANGED');}}});
 const recovery=await testAdmin(async c=>(await c.query('SELECT sync_state FROM app.email_mailbox WHERE id=$1',[g.box.id])).rows[0]);assert.equal(recovery.sync_state,'recovering');
});
test('leased Gmail sync refresh shares the mailbox lock and never grants credentials without the fence',async()=>{
 const u=await mailUser(),f=gmailApi('sync-'+randomUUID()+'@example.org');
 Object.assign(process.env,{GMAIL_CLIENT_ID:'fixture.apps.googleusercontent.com',GMAIL_CLIENT_SECRET:'fixture',GMAIL_REDIRECT_URI:'http://127.0.0.1:3210/api/mail-oauth/google/callback'});
 const box=await saveMailbox(u.p,{requestId:randomUUID(),expectedRevision:0,name:'Gmail Sync',provider:'gmail',config:{},credentials:{},signature:''});
 const auth=await startGmailAuthorization(u.p,'session',{id:box.id,expectedRevision:1}),url=new URL(process.env.GMAIL_REDIRECT_URI!);url.searchParams.set('state',new URL(auth.authorizationUrl).searchParams.get('state')!);url.searchParams.set('code','fixture');
 f.flags.expiresIn=0;await finishGmailAuthorization(u.p,'session',url,{fetch:f.fetcher});f.flags.expiresIn=3600;f.flags.omitRefresh=true;f.calls.length=0;
 const claims=await claimMailboxSync(new Date().toISOString(),{workspaceId:u.p.workspaceId,mailboxId:box.id,limit:1});assert.equal(claims.length,1);
 const configs=await Promise.all([ensureSyncGmailAccess(claims[0],{fetch:f.fetcher}),ensureSyncGmailAccess(claims[0],{fetch:f.fetcher})]);
 assert.ok(configs.every(c=>c.credentials.refreshToken==='fixture-refresh'));assert.equal(f.calls.filter(c=>c.url.includes('oauth2.googleapis.com')).length,1);
 await assert.rejects(ensureSyncGmailAccess({...claims[0],fence:claims[0].fence+1},{fetch:f.fetcher}));
});
