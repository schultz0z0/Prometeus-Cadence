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
test('oversized Gmail MIME becomes a bounded review placeholder and advances the history checkpoint',async()=>{
 for(const size of [2097153,2097154,4000000]){
  let rawReads=0,metadataReads=0;const adapter=createGmailAdapter({fetch:async url=>{const u=new URL(String(url));if(u.pathname.endsWith('/history'))return Response.json({historyId:'101',history:[{messagesAdded:[{message:{id:'large'}}]}]});if(u.searchParams.get('format')==='metadata'){metadataReads++;return Response.json({id:'large',threadId:'thread-large',sizeEstimate:size,internalDate:'1792663200000',labelIds:['INBOX'],payload:{headers:[{name:'From',value:'contact@example.net'},{name:'To',value:'sender@example.org'},{name:'Subject',value:'Anexo grande'},{name:'Message-ID',value:'<large@example.net>'}]}});}rawReads++;return Response.json({id:'large',threadId:'thread-large',internalDate:'1792663200000',labelIds:['INBOX'],raw:Buffer.alloc(size,65).toString('base64url')});}});
  const result=await adapter.readBatch(config,{kind:'gmail',historyId:'100',pageToken:null,watermark:'2026-10-22T09:00:00Z'},{maxMessages:1,maxPages:1});assert.equal(result.messages.length,1);assert.equal(result.messages[0].truncated,true);assert.equal(result.messages[0].from,'contact@example.net');assert.equal(result.messages[0].rfcMessageId,'<large@example.net>');assert.ok(Buffer.byteLength(result.messages[0].text)<1024);assert.equal(result.complete,true);if(result.next.kind==='gmail')assert.equal(result.next.historyId,'101');assert.equal(rawReads,1);assert.equal(metadataReads,1);
 }
});
