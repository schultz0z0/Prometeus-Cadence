import test from 'node:test';import assert from 'node:assert/strict';
import {resolveMailEndpoint,pinnedMailSocketOptions} from '../src/server/mail/network.ts';
test('mail destination validation pins public address and original TLS hostname',async()=>{
 let calls=0;const endpoint=await resolveMailEndpoint('smtp.example.org',587,'smtp',{resolve:async()=>{calls++;return [{address:calls===1?'93.184.216.34':'127.0.0.1',family:4}];}});
 assert.deepEqual(pinnedMailSocketOptions(endpoint),{host:'93.184.216.34',port:587,servername:'smtp.example.org',rejectUnauthorized:true,minVersion:'TLSv1.2'});assert.equal(calls,1);
});
test('mail hosts reject internal mapped mixed and special networks without connecting',async()=>{
 for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','::1','::ffff:127.0.0.1','fd00::1','0.0.0.0','192.0.2.1','224.0.0.1'])await assert.rejects(resolveMailEndpoint('mail.example.org',993,'imap',{resolve:async()=>[{address,family:address.includes(':')?6:4}]}));
 await assert.rejects(resolveMailEndpoint('mail.example.org',993,'imap',{resolve:async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]}));
 for(const host of ['localhost','https://mail.example.org','user@mail.example.org','mail.example.org/path','127.0.0.1'])await assert.rejects(resolveMailEndpoint(host,465,'smtp'));
 await assert.rejects(resolveMailEndpoint('mail.example.org',25,'smtp'));await assert.rejects(resolveMailEndpoint('mail.example.org',143,'imap'));
});
