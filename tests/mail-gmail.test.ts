import test from 'node:test';import assert from 'node:assert/strict';
import {createGmailAdapter} from '../src/server/mail/providers/gmail.ts';
import {gmailApi} from './fixtures/gmail-api.ts';
import {outgoing} from './fixtures/mail-messages.ts';
import type {MailConfig} from '../src/server/mail/contracts.ts';
const config:MailConfig={mailbox:{id:'c',senderId:'s',provider:'gmail',name:'Gmail',address:'sender@example.org',revision:1,state:'ready',hasSecrets:true,sendVerified:true,readVerified:true,lastSyncedAt:'2026-10-21T12:00:00Z',syncState:'ready',dailyLimit:10,signature:'',lastError:null},config:{},credentials:{accessToken:'fixture-access'},cursor:null};
test('Gmail verifies mailbox identity and sends raw MIME exactly once',async()=>{
 const f=gmailApi(),adapter=createGmailAdapter({fetch:f.fetcher});
 assert.deepEqual(await adapter.verify(config),{address:'sender@example.org',send:true,read:true});
 const result=await adapter.sendOnce(config,outgoing);assert.equal(result.kind,'accepted');
 const call=f.calls.find(c=>c.url.endsWith('/messages/send'));assert.ok(call);const raw=JSON.parse(call.body).raw;assert.match(Buffer.from(raw,'base64url').toString(),/Message-ID:/);
 assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('Gmail lost send and server failure stay uncertain without a second POST',async()=>{
 const f=gmailApi();f.flags.lostSend=true;const result=await createGmailAdapter({fetch:f.fetcher}).sendOnce(config,outgoing);
 assert.deepEqual(result,{kind:'uncertain',code:'GMAIL_SEND_RESULT_MISSING'});assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
 const error=createGmailAdapter({fetch:async()=>Response.json({error:{code:503}},{status:503})});assert.equal((await error.sendOnce(config,outgoing)).kind,'uncertain');
 const quota=createGmailAdapter({fetch:async()=>Response.json({error:{code:429}},{status:429,headers:{'Retry-After':'42'}})});
 const rejected=await quota.sendOnce(config,outgoing);assert.equal(rejected.kind,'not_accepted');if(rejected.kind==='not_accepted')assert.equal(rejected.retryAfterMs,42000);
});
test('Gmail baseline keeps history IDs as strings and absent sent evidence proves nothing',async()=>{
 const f=gmailApi(),adapter=createGmailAdapter({fetch:f.fetcher});const baseline=await adapter.readBatch(config,null,{maxMessages:10,maxPages:1});
 assert.equal(baseline.next.kind,'gmail');if(baseline.next.kind==='gmail')assert.equal(baseline.next.historyId,'9007199254740993999');assert.equal(baseline.complete,true);
 assert.equal(await adapter.findSent(config,outgoing),null);
});
