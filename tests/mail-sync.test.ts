import test from 'node:test';import assert from 'node:assert/strict';
import {createGmailAdapter} from '../src/server/mail/providers/gmail.ts';
import {assertSyncBatch} from '../src/server/mail/sync/validation.ts';
import {recoverGmailBatch} from '../src/server/mail/sync/gmail.ts';
import {recoverImapBatch} from '../src/server/mail/sync/imap.ts';
import {smtpConfig} from './fixtures/mail-transports.ts';
test('sync batches reject cursor precision loss future times and invalid bounds',()=>{
 const next={kind:'gmail' as const,historyId:'9007199254740993999',pageToken:null,watermark:'2026-10-21T12:00:00Z'};
 assert.doesNotThrow(()=>assertSyncBatch({messages:[],next,complete:true,gap:false}));
 assert.throws(()=>assertSyncBatch({messages:[],next:{...next,historyId:9007199254740992} as any,complete:true,gap:false}));
 assert.throws(()=>assertSyncBatch({messages:[],next:{kind:'imap',path:'INBOX',uidValidity:'1',lastUid:-1,watermark:next.watermark},complete:true,gap:false}));
});
test('Gmail expired history recovers a bounded time window but preserves the visible gap',async()=>{
 const urls:string[]=[];const config={...smtpConfig,mailbox:{...smtpConfig.mailbox,provider:'gmail' as const}};
 const raw=Buffer.from('From: contact@example.net\r\nTo: sender@example.org\r\nMessage-ID: <recovered@example.net>\r\n\r\nResposta').toString('base64url');
 const batch=await recoverGmailBatch(config,{kind:'gmail',historyId:'old',pageToken:null,watermark:'2026-10-21T12:00:00Z'},{fetch:async url=>{const u=new URL(String(url));urls.push(u.toString());return Response.json(u.pathname.endsWith('/profile')?{historyId:'9007199254740994000'}:u.pathname.endsWith('/messages')?{messages:[{id:'recover-one'}]}:{id:'recover-one',raw,internalDate:'1792584000000',labelIds:['INBOX']});}});
 assert.equal(batch.messages[0].text,'Resposta');assert.equal(batch.complete,true);assert.equal(batch.gap,true);assert.ok(new URL(urls.find(u=>new URL(u).pathname.endsWith('/messages'))!).searchParams.get('q')?.includes('after:'));
});
test('IMAP UIDVALIDITY recovery rescans from zero without treating the old UID as current',async()=>{
 const starts:number[]=[];const batch=await recoverImapBatch(smtpConfig,{kind:'imap',path:'INBOX',uidValidity:'old',lastUid:9000,watermark:'2026-10-21T12:00:00Z'},{adapter:{verify:async()=>{throw Error();},sendOnce:async()=>{throw Error();},findSent:async()=>null,readBatch:async(_config,cursor)=>{if(cursor?.kind==='imap')starts.push(cursor.lastUid);return {messages:[],next:{kind:'imap',path:'INBOX',uidValidity:'new',lastUid:1,watermark:'2026-10-21T12:00:00Z'},complete:true,gap:false};}}});
 assert.deepEqual(starts,[0]);assert.equal(batch.gap,true);assert.equal(batch.next.kind,'imap');if(batch.next.kind==='imap')assert.equal(batch.next.uidValidity,'new');
});
test('Gmail partial pages keep starting history while encoding an opaque page token on fixed host',async()=>{
 const urls:string[]=[];const config={...smtpConfig,mailbox:{...smtpConfig.mailbox,provider:'gmail' as const},credentials:{accessToken:'fixture'}};
 const adapter=createGmailAdapter({fetch:async url=>{urls.push(String(url));return Response.json({historyId:'9007199254740994000',history:[],nextPageToken:'https://evil.example/page'});}});
 const cursor={kind:'gmail' as const,historyId:'9007199254740993999',pageToken:null,watermark:'2026-10-21T12:00:00Z'};
 const result=await adapter.readBatch(config,cursor,{maxMessages:10,maxPages:1});assert.equal(result.complete,false);assert.equal(result.next.kind,'gmail');if(result.next.kind==='gmail')assert.equal(result.next.historyId,cursor.historyId);
 await adapter.readBatch(config,result.next,{maxMessages:10,maxPages:1});assert.ok(urls.every(u=>new URL(u).hostname==='gmail.googleapis.com'));assert.equal(new URL(urls[1]).searchParams.get('pageToken'),'https://evil.example/page');
});
test('Gmail history includes authenticated Sent observations for outbox correlation',async()=>{
 const config={...smtpConfig,mailbox:{...smtpConfig.mailbox,provider:'gmail' as const},credentials:{accessToken:'fixture'}};
 const raw=Buffer.from('From: sender@example.org\r\nTo: contact@example.net\r\nMessage-ID: <sent@example.org>\r\n\r\nEnviada').toString('base64url');
 const adapter=createGmailAdapter({fetch:async url=>Response.json(String(url).includes('/history?')?{historyId:'100',history:[{messagesAdded:[{message:{id:'sent-1'}}]}]}:{raw,internalDate:'1792584000000',labelIds:['SENT']})});
 const batch=await adapter.readBatch(config,{kind:'gmail',historyId:'99',pageToken:null,watermark:'2026-10-21T12:00:00Z'},{maxMessages:10,maxPages:1});
 assert.equal(batch.messages.length,1);assert.equal(batch.messages[0].direction,'outbound');
});
test('one large Gmail history record resumes its remaining IDs within the message budget',async()=>{
 const config={...smtpConfig,mailbox:{...smtpConfig.mailbox,provider:'gmail' as const},credentials:{accessToken:'fixture'}},reads:string[]=[];
 const adapter=createGmailAdapter({fetch:async url=>{const u=new URL(String(url));if(u.pathname.endsWith('/history'))return Response.json({historyId:'100',history:[{messagesAdded:['one','two','three'].map(id=>({message:{id}}))}]});const id=u.pathname.split('/').at(-1)!;reads.push(id);return Response.json({raw:Buffer.from('From: contact@example.net\r\nTo: sender@example.org\r\n\r\n'+id).toString('base64url'),internalDate:'1792584000000',labelIds:['INBOX']});}});
 let cursor:any={kind:'gmail',historyId:'99',pageToken:null,watermark:'2026-10-21T12:00:00Z'};
 for(let n=0;n<3;n++){const batch=await adapter.readBatch(config,cursor,{maxMessages:1,maxPages:1});assert.equal(batch.messages.length,1);assert.equal(batch.complete,n===2);assertSyncBatch(batch);cursor=batch.next;}
 assert.deepEqual(reads,['one','two','three']);assert.equal(cursor.historyId,'100');
});
