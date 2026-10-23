import test from 'node:test';import assert from 'node:assert/strict';
import {NextRequest} from 'next/server.js';
import {gmailCallbackUrl} from '../src/server/mail/callback-url.ts';
import {gmailAuthorizationNotice} from '../src/client/mail-copy.ts';
const registered='http://127.0.0.1:3210/api/mail-oauth/google/callback';
test('only a matching loopback Host restores NextRequest normalized localhost to the registered OAuth origin',()=>{
 const incoming=registered+'?state=fixture-state&code=fixture-code',request=new NextRequest(incoming,{headers:{host:'127.0.0.1:3210'}});
 assert.equal(new URL(request.url).hostname,'localhost');assert.equal(gmailCallbackUrl(request,registered).toString(),incoming);
 assert.equal(gmailCallbackUrl(new Request(incoming),registered).toString(),incoming);
 for(const host of ['localhost:3210','evil.example','127.0.0.1:9999','127.0.0.1:3210.evil.example'])assert.throws(()=>gmailCallbackUrl(new NextRequest(incoming,{headers:{host,'x-forwarded-host':'127.0.0.1:3210'}}),registered));
 for(const url of ['http://localhost:9999/api/mail-oauth/google/callback','https://localhost:3210/api/mail-oauth/google/callback','http://evil.example:3210/api/mail-oauth/google/callback','http://localhost:3210/other'])assert.throws(()=>gmailCallbackUrl(new Request(url,{headers:{host:'127.0.0.1:3210'}}),registered));
 assert.throws(()=>gmailCallbackUrl(new Request('http://localhost:3210/api/mail-oauth/google/callback'),registered));
 assert.throws(()=>gmailCallbackUrl(new Request('https://localhost/api/mail-oauth/google/callback',{headers:{host:'app.example'}}),'https://app.example/api/mail-oauth/google/callback'));
});
test('OAuth return status has visible safe feedback and ignores unrecognized query values',()=>{
 assert.equal(gmailAuthorizationNotice('failed')?.kind,'error');assert.match(gmailAuthorizationNotice('failed')!.message,/Google|autorização/);assert.equal(gmailAuthorizationNotice('connected')?.kind,'success');assert.equal(gmailAuthorizationNotice(null),null);assert.equal(gmailAuthorizationNotice('<script>secret-code</script>'),null);
});
