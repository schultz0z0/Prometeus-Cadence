import test from 'node:test';import assert from 'node:assert/strict';
import {createGmailAuthorization,gmailOAuthSettings} from '../src/server/mail/oauth-protocol.ts';
test('Gmail authorization binds offline PKCE without modifying application login',()=>{
 const env={GMAIL_CLIENT_ID:'fixture.apps.googleusercontent.com',GMAIL_CLIENT_SECRET:'fixture-secret',GMAIL_REDIRECT_URI:'http://127.0.0.1:3210/api/mail-oauth/google/callback'};
 const data=createGmailAuthorization(gmailOAuthSettings(env));const url=new URL(data.authorizationUrl);
 assert.equal(url.hostname,'accounts.google.com');assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('state'),data.state);assert.equal(data.state.length,43);assert.equal(url.searchParams.get('code_challenge'),data.challenge);
 assert.match(url.searchParams.get('scope')??'',/gmail.readonly/);assert.match(url.searchParams.get('scope')??'',/gmail.send/);assert.doesNotMatch(data.authorizationUrl,/fixture-secret/);
 assert.throws(()=>gmailOAuthSettings({...env,GMAIL_REDIRECT_URI:'http://external.example/api/mail-oauth/google/callback'}));
 assert.throws(()=>gmailOAuthSettings({...env,GMAIL_CLIENT_SECRET:''}));
});
