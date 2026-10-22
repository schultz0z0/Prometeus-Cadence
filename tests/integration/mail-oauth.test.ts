import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {getPools} from '../../src/server/db/pool.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {saveMailbox,readMailConfig,listMailboxes} from '../../src/server/mail/repository.ts';
import {startGmailAuthorization,finishGmailAuthorization,withGmailAccess} from '../../src/server/mail/oauth.ts';
import {mailUser,testAdmin} from './mail-helpers.ts';import {gmailApi} from '../fixtures/gmail-api.ts';
after(async()=>getPools().close());
async function fixture(){
 const u=await mailUser(),f=gmailApi('qa-'+randomUUID()+'@example.org');
 process.env.GMAIL_CLIENT_ID='fixture.apps.googleusercontent.com';process.env.GMAIL_CLIENT_SECRET='fixture-secret';process.env.GMAIL_REDIRECT_URI='http://127.0.0.1:3210/api/mail-oauth/google/callback';
 const box=await saveMailbox(u.p,{requestId:randomUUID(),expectedRevision:0,name:'Gmail QA',provider:'gmail',signature:'Equipe',config:{},credentials:{}}),session='session-'+randomUUID();
 const start=await startGmailAuthorization(u.p,session,{id:box.id,expectedRevision:1},{fetch:f.fetcher});
 const callback=new URL(process.env.GMAIL_REDIRECT_URI);callback.searchParams.set('state',new URL(start.authorizationUrl).searchParams.get('state')!);callback.searchParams.set('code','fixture-code');
 return {u,f,box,session,callback};
}
test('OAuth binds one-use state to session and workspace before token exchange',async()=>{
 const f=await fixture(),other=await mailUser();
 await assert.rejects(finishGmailAuthorization(other.p,f.session,f.callback,{fetch:f.f.fetcher}));
 await assert.rejects(finishGmailAuthorization(f.u.p,'other-session',f.callback,{fetch:f.f.fetcher}));
 assert.equal(f.f.calls.length,0);
 const linked=await finishGmailAuthorization(f.u.p,f.session,f.callback,{fetch:f.f.fetcher});assert.match(linked.address??'',/^qa-/);assert.equal(linked.state,'verifying');
 await assert.rejects(finishGmailAuthorization(f.u.p,f.session,f.callback,{fetch:f.f.fetcher}));
 assert.equal(f.f.calls.filter(c=>c.url.includes('oauth2.googleapis.com')).length,1);
 assert.equal(JSON.stringify(await listMailboxes(f.u.p)).includes('fixture-access'),false);
});
test('expired revoked incomplete scopes and rotated connections never persist Gmail tokens',async()=>{
 for(const kind of ['expired','revoked','scopes','rotated']){
  const f=await fixture();
  if(kind==='expired')await testAdmin(c=>c.query("UPDATE app.email_oauth_attempt SET expires_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1",[f.box.id]));
  if(kind==='revoked')await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[f.u.p.workspaceId,f.u.p.userId,'operator']));
  if(kind==='scopes')f.f.flags.missingScope=true;
  if(kind==='rotated')await saveMailbox(f.u.p,{id:f.box.id,requestId:randomUUID(),expectedRevision:1,name:'New revision',provider:'gmail',signature:'',config:{},credentials:{}});
  await assert.rejects(finishGmailAuthorization(f.u.p,f.session,f.callback,{fetch:f.f.fetcher}));
  const rows=await testAdmin(c=>c.query('SELECT verified_account_id FROM app.channel_credential WHERE connection_id=$1',[f.box.id]));assert.ok(rows.rows.every(r=>r.verified_account_id===null));
 }
});
test('concurrent access refreshes once preserves refresh token and invalid_grant requires reconnect',async()=>{
 const f=await fixture();f.f.flags.expiresIn=0;await finishGmailAuthorization(f.u.p,f.session,f.callback,{fetch:f.f.fetcher});
 f.f.flags.expiresIn=3600;f.f.flags.omitRefresh=true;f.f.calls.length=0;
 const tokens=await Promise.all([1,2,3].map(()=>withGmailAccess(f.box.id,async token=>token,{principal:f.u.p,fetch:f.f.fetcher})));
 assert.deepEqual(tokens,['fixture-access','fixture-access','fixture-access']);assert.equal(f.f.calls.filter(c=>c.url.includes('oauth2.googleapis.com')).length,1);
 const current=await withWorkspaceTransaction(f.u.p,c=>readMailConfig(c,f.box.id));assert.equal(current.credentials.refreshToken,'fixture-refresh');
 const broken=await fixture();broken.f.flags.expiresIn=0;await finishGmailAuthorization(broken.u.p,broken.session,broken.callback,{fetch:broken.f.fetcher});broken.f.flags.invalidGrant=true;
 await assert.rejects(withGmailAccess(broken.box.id,async()=>null,{principal:broken.u.p,fetch:broken.f.fetcher}));assert.equal((await listMailboxes(broken.u.p))[0].state,'authorization_required');
});
