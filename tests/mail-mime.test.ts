import test from 'node:test';import assert from 'node:assert/strict';
import {composeMail,parseMail} from '../src/server/mail/mime.ts';
import {matchMailThread} from '../src/server/mail/threading.ts';
import {outgoing,source,rawMail,attachments} from './fixtures/mail-messages.ts';
test('email composition freezes explicit sender recipient subject RFC id and text signature',async()=>{
 const bytes=await composeMail(outgoing);const mime=bytes.toString();
 assert.match(mime,/From: sender@example.org/);assert.match(mime,/To: contact@example.net/);assert.match(mime,/d47c98f1-0e58-4e94-ae59-9e543631e117@cadence.example.org/);
 assert.match(mime,/Equipe/);assert.doesNotMatch(mime,/Bcc:|Cc:/);
 await assert.rejects(composeMail({...outgoing,content:{...outgoing.content,subject:'Hi\r\nBcc: bad@example.org'}}));
 await assert.rejects(composeMail({...outgoing,to:'x@example.org,y@example.org'}));
});
test('campaign unsubscribe header targets the actual anonymous one-click API route',async()=>{
 const mime=(await composeMail({...outgoing,purpose:'campaign',unsubscribeUrl:'https://hooks.example/unsubscribe/'+'a'.repeat(43)})).toString();
 assert.match(mime.replace(/\r\n[ \t]+/g,''),/List-Unsubscribe:\s*<https:\/\/hooks.example\/api\/mail-unsubscribe\/[a]+\/one-click>/);
});
test('received HTML stays inert text and attachment metadata is bounded',async()=>{
 const html=await parseMail(rawMail('Content-Type: text/html; charset=utf-8\r\n\r\n<p>Olá</p><script>steal()</script><img src="https://evil.example/pixel">'),source);
 assert.match(html.text,/Olá/);assert.doesNotMatch(html.text,/<script|<img|steal\(\)/);assert.equal(html.from,'sender@example.org');
 const hundred=await parseMail(rawMail(attachments(100)),source);assert.equal(hundred.attachments.length,100);assert.equal(hundred.truncated,false);
 const over=await parseMail(rawMail(attachments(101)),source);assert.equal(over.attachments.length,100);assert.equal(over.truncated,true);assert.equal(over.classification,'ambiguous');
});
test('oversized MIME stops consuming stream and exposes a limited incoming message',async()=>{
 let consumed=0;async function* input(){yield Buffer.from('From: sender@example.org\r\nTo: contact@example.net\r\nSubject: Big\r\n\r\n');for(let i=0;i<100;i++){consumed++;yield Buffer.alloc(65536,65);}}
 const message=await parseMail(input(),source);assert.equal(message.truncated,true);assert.equal(message.classification,'ambiguous');assert.ok(consumed<100);assert.ok(Buffer.byteLength(message.text)<=65536);
});
test('thread references require matching sender and conflicting evidence remains ambiguous',async()=>{
 const mail=await parseMail(rawMail('In-Reply-To: <parent@example.org>\r\n\r\nOi'),source);
 const candidates=[{id:'a',rfcMessageId:'<parent@example.org>',remoteThreadId:null,contact:'sender@example.org',subject:'Test'}];
 assert.deepEqual(matchMailThread(mail,candidates),{kind:'matched',id:'a'});
 assert.deepEqual(matchMailThread({...mail,from:'other@example.org'},candidates),{kind:'ambiguous'});
 assert.deepEqual(matchMailThread({...mail,inReplyTo:null,references:[]},candidates),{kind:'new'});
 assert.deepEqual(matchMailThread(mail,[...candidates,{...candidates[0],id:'b'}]),{kind:'ambiguous'});
});
test('delivery status MIME retains only bounded classification evidence for bounce handling',async()=>{
 const body='Auto-Submitted: auto-replied\r\nContent-Type: multipart/report; report-type=delivery-status; boundary="dsn"\r\n\r\n--dsn\r\nContent-Type: text/plain\r\n\r\nDelivery failed\r\n--dsn\r\nContent-Type: message/delivery-status\r\n\r\nFinal-Recipient: rfc822; contact@example.net\r\nAction: failed\r\nStatus: 5.1.1\r\n\r\n--dsn--\r\n';
 const mail=await parseMail(rawMail(body),source);
 assert.equal(mail.headers?.['auto-submitted'],'auto-replied');assert.match(mail.deliveryStatus??'',/Final-Recipient: rfc822; contact@example.net/);
});
