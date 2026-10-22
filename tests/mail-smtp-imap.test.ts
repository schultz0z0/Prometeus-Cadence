import test from 'node:test';import assert from 'node:assert/strict';
import {createSmtpImapAdapter,createMailboxChallenge,matchMailboxChallenge} from '../src/server/mail/providers/smtp-imap.ts';
import {mailTransports,smtpConfig} from './fixtures/mail-transports.ts';import {outgoing,source} from './fixtures/mail-messages.ts';import {parseMail} from '../src/server/mail/mime.ts';
import nodemailer from 'nodemailer';import {mailTestTls} from './fixtures/smtp-server.ts';
test('SMTP and IMAP verify through TLS without sending DATA or changing mailbox flags',async()=>{
 const f=await mailTransports();try{const result=await createSmtpImapAdapter(f.deps).verify(smtpConfig);assert.equal(result.address,'sender@example.org');assert.equal(f.smtp.state.dataCount,0);assert.ok(f.imap.commands.includes('EXAMINE'));assert.ok(f.seen.every(s=>s.host==='93.184.216.34'&&s.servername.endsWith('.example.org')));assert.ok(!f.imap.commands.some(c=>['SELECT','STORE','CLOSE','EXPUNGE','APPEND'].includes(c)));}finally{await f.close();}
});
test('SMTP accepted temporary permanent and lost results never produce an implicit second DATA',async()=>{
 for(const mode of ['accept','temporary','permanent','lost'] as const){const f=await mailTransports();try{f.smtp.state.mode=mode;const adapter=createSmtpImapAdapter(f.deps),result=await adapter.sendOnce(smtpConfig,outgoing);assert.equal(result.kind,mode==='accept'?'accepted':mode==='lost'?'uncertain':'not_accepted');if(result.kind==='not_accepted')assert.equal(result.retryable,mode==='temporary');assert.equal(f.smtp.state.dataCount,1);assert.ok(!f.imap.commands.includes('APPEND'));}finally{await f.close();}}
});
test('SMTP requires STARTTLS and IMAP rejects invalid authentication',async()=>{
 const f=await mailTransports(false,true);try{await assert.rejects(createSmtpImapAdapter(f.deps).verify({...smtpConfig,config:{...smtpConfig.config,smtpPort:587} as typeof smtpConfig.config}));assert.equal(f.smtp.state.dataCount,0);}finally{await f.close();}
 const g=await mailTransports();try{await assert.rejects(createSmtpImapAdapter(g.deps).verify({...smtpConfig,credentials:{...smtpConfig.credentials,imapPassword:'wrong'}}));}finally{await g.close();}
});
test('SMTP own-address proof binds connection revision and requires an incoming nonce',async()=>{
 const challenge=createMailboxChallenge('c',1),mail=await parseMail([Buffer.from('From: sender@example.org\r\nTo: sender@example.org\r\n\r\n'+challenge.text)],source);
 assert.equal(matchMailboxChallenge(mail,{connectionId:'c',revision:1,address:'sender@example.org',hash:challenge.hash,nonce:challenge.nonce}),true);
 assert.equal(matchMailboxChallenge(mail,{connectionId:'c',revision:2,address:'sender@example.org',hash:challenge.hash,nonce:challenge.nonce}),false);
 assert.equal(matchMailboxChallenge({...mail,direction:'outbound'},{connectionId:'c',revision:1,address:'sender@example.org',hash:challenge.hash,nonce:challenge.nonce}),false);
});
test('SMTP refuses a trusted fixture certificate with the wrong hostname before sending',async()=>{
 const f=await mailTransports();try{
  await assert.rejects(createSmtpImapAdapter({...f.deps,smtpTransport:options=>nodemailer.createTransport({...options,host:'127.0.0.1',port:f.smtp.port,tls:{...options.tls,ca:mailTestTls.cert,servername:'wrong.example.org'}})}).verify(smtpConfig));
  assert.equal(f.smtp.state.dataCount,0);
 }finally{await f.close();}
});
