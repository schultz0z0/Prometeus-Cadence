import test,{after} from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mailboxHttp,gmailCallbackHttp,mailUnsubscribeHttp} from '../../src/server/mail/http.ts';import {diagnoseMailDomain} from '../../src/server/mail/diagnostics.ts';
import {dispatchPool} from '../../src/server/messaging/worker-db.ts';import {leaseArgs} from '../../src/server/messaging/lease.ts';
import {mailUser,smtpMailboxInput,testAdmin} from './mail-helpers.ts';import {multiFixture} from './multichannel-helpers.ts';import {base} from './helpers.ts';import {getPools} from '../../src/server/db/pool.ts';import {closeDispatchPool} from '../../src/server/messaging/worker-db.ts';import {closeIngressPool} from '../../src/server/channels/ingress-db.ts';import {preparePublication,confirmPublication} from '../../src/server/messaging/publication.ts';import {saveMailbox} from '../../src/server/mail/repository.ts';import {mailTransports} from '../fixtures/mail-transports.ts';import {createSmtpImapAdapter} from '../../src/server/mail/providers/smtp-imap.ts';import {claimMailboxSync} from '../../src/server/mail/sync/repository.ts';import {runMailboxSync} from '../../src/server/mail/sync/service.ts';import {ingestMailBatch} from '../../src/server/mail/ingestion.ts';import {dispatchOne} from '../../src/server/messaging/dispatch.ts';import {claimDispatch} from '../../src/server/messaging/lease.ts';
after(async()=>{await getPools().close();await closeDispatchPool();await closeIngressPool();});
const req=(headers:Headers,path:string,body?:unknown)=>new Request(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
test('test mail rejects aggregate rendered content before queuing and thread acknowledgement is POST-only',async()=>{
 const f=await multiFixture(true),{prepareMailTest}=await import('../../src/server/mail/tests.ts'),{messagingRequestHandler}=await import('../../src/server/messaging/http.ts');
 const input={mode:'test' as const,messageId:randomUUID(),expectedRevision:1,to:f.lead.email!,content:{kind:'email' as const,subject:'S'.repeat(200),text:'A'.repeat(65500),signature:'Equipe QA'},consent:{source:'QA',occurredAt:new Date().toISOString(),evidence:'Autorização explícita para o próprio teste'}};
 const review=await prepareMailTest(f.u.p,f.mailbox.id,input);assert.ok(review.blockers.includes('EMAIL_TEXT_INVALID'));
 const response=await messagingRequestHandler(req(f.u.headers,'/api/messaging/conversations/'+randomUUID()+'/email-review'),{resource:'conversations',id:randomUUID(),action:'email-review'});assert.equal(response.status,404);
});
test('mail HTTP enforces session origin workspace role schema bounds and redacts credentials',async()=>{
 const u=await mailUser(),path='/api/mailboxes';assert.equal((await mailboxHttp(new Request(base+path),{})).status,401);
 const evil=req(u.headers,path,smtpMailboxInput());evil.headers.set('origin','https://evil.example');assert.equal((await mailboxHttp(evil,{})).status,403);
 const stale=req(u.headers,path);stale.headers.set('x-cadence-workspace',randomUUID());assert.equal((await mailboxHttp(stale,{})).status,409);
 const oversized=req(u.headers,path,{});oversized.headers.set('content-length','2097153');assert.equal((await mailboxHttp(oversized,{})).status,413);
 assert.equal((await mailboxHttp(req(u.headers,path,{...smtpMailboxInput(),extra:true}),{})).status,422);
 const saved=await mailboxHttp(req(u.headers,path,smtpMailboxInput()),{});assert.equal(saved.status,200);const box=await saved.json();
 const detail=await mailboxHttp(req(u.headers,path+'/'+box.id),{id:box.id});assert.equal(detail.status,200);assert.doesNotMatch(await detail.text(),/fixture-smtp-password|fixture-imap-password|ciphertext|refreshToken/);
 const other=await mailUser();assert.equal((await mailboxHttp(req(other.headers,path+'/'+box.id),{id:box.id})).status,404);
 await testAdmin(c=>c.query('UPDATE auth.member SET role=$3 WHERE "organizationId"=$1 AND "userId"=$2',[u.p.workspaceId,u.p.userId,'operator']));assert.equal((await mailboxHttp(req(u.headers,path,smtpMailboxInput()),{})).status,403);
});
test('unsubscribe GET is read-only; explicit POST is anonymous idempotent and one-click accepts only its form',async()=>{
 const f=await multiFixture(true),review=await preparePublication(f.u.p,f.input);await confirmPublication(f.u.p,{...f.input,requestId:randomUUID(),reviewToken:review.token,material:review.material});
 const token=review.snapshot.recipients[0].steps.first.unsubscribe!.url.split('/').at(-1)!,path='/api/mail-unsubscribe/'+token;
 assert.equal((await mailUnsubscribeHttp(new Request(base+path),token,'browser')).status,200);
 assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.contact_suppression WHERE identity_id=$1',[f.emailIdentity]))).rowCount,0);
 assert.equal((await mailUnsubscribeHttp(new Request(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{}'}),token,'browser')).status,422);
 for(let n=0;n<2;n++)assert.equal((await mailUnsubscribeHttp(new Request(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{"confirm":true}'}),token,'browser')).status,200);
 assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.contact_suppression WHERE identity_id=$1',[f.emailIdentity]))).rowCount,1);
 const form=new Request(base+path+'/one-click',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});
 assert.equal((await mailUnsubscribeHttp(form,token,'one-click')).status,200);
 assert.equal((await mailUnsubscribeHttp(new Request(base+path+'/one-click',{method:'POST',body:'confirm=true'}),token,'one-click')).status,422);
 const invalid=await mailUnsubscribeHttp(new Request(base+path,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:'{"confirm":true}'}),'invalid','browser');assert.equal(invalid.status,200);assert.doesNotMatch(await invalid.text(),/@|identity|token/i);
});
test('Google callback requires the same session and returns no authorization data on failure',async()=>{
 const u=await mailUser();process.env.GMAIL_CLIENT_ID='fixture-client';process.env.GMAIL_CLIENT_SECRET='fixture-secret';process.env.GMAIL_REDIRECT_URI=base+'/api/mail-oauth/google/callback';
 const path='/api/mail-oauth/google/callback?state='+'a'.repeat(43)+'&code=secret-code';
 const result=await gmailCallbackHttp(req(u.headers,path));assert.ok(result.status===303||result.status===400);assert.doesNotMatch((result.headers.get('location')??'')+await result.text(),/secret-code|fixture-secret|state=/);
});
test('real NextRequest loopback normalization preserves the registered Google callback and saves authorization',async()=>{
 const {NextRequest}=await import('next/server.js'),{gmailApi}=await import('../fixtures/gmail-api.ts'),{startGmailAuthorization}=await import('../../src/server/mail/oauth.ts');
 const u=await mailUser(),provider=gmailApi('callback-'+randomUUID()+'@example.org');Object.assign(process.env,{GMAIL_CLIENT_ID:'fixture-client',GMAIL_CLIENT_SECRET:'fixture-secret',GMAIL_REDIRECT_URI:base+'/api/mail-oauth/google/callback'});
 const box=await saveMailbox(u.p,{requestId:randomUUID(),expectedRevision:0,provider:'gmail',name:'Next callback',signature:'Equipe',config:{},credentials:{}}),started=await startGmailAuthorization(u.p,u.p.sessionId,{id:box.id,expectedRevision:1});
 const callback=new URL(process.env.GMAIL_REDIRECT_URI!);callback.searchParams.set('state',new URL(started.authorizationUrl).searchParams.get('state')!);callback.searchParams.set('code','fixture-code-never-expose');
 const headers=new Headers(u.headers);headers.delete('origin');headers.set('host',new URL(base).host);headers.set('referer','https://accounts.google.com/');headers.set('sec-fetch-site','cross-site');headers.set('sec-fetch-mode','navigate');
 const request=new NextRequest(callback,{headers});assert.equal(new URL(request.url).hostname,'localhost');
 const response=await gmailCallbackHttp(request,{fetch:provider.fetcher});assert.equal(new URL(response.headers.get('location')!).searchParams.get('oauth'),'connected');assert.doesNotMatch(response.headers.get('location')!,/fixture-code|state=|token=/);
 const stored=(await testAdmin(c=>c.query('SELECT c.revision,c.credentials_verified,m.address,m.state FROM app.channel_connection c JOIN app.email_mailbox m ON m.workspace_id=c.workspace_id AND m.id=c.id WHERE c.id=$1',[box.id]))).rows[0];assert.equal(stored.revision,'2');assert.equal(stored.credentials_verified,true);assert.equal(stored.state,'verifying');assert.match(stored.address,/^callback-/);assert.equal(provider.calls.filter(call=>call.url.includes('oauth2.googleapis.com')).length,1);
});
test('DNS observations never claim authentication and DKIM requires an explicit selector',async()=>{
 const f=await multiFixture(true),queries:string[]=[];const resolve=async(name:string)=>{queries.push(name);return [[name.startsWith('_dmarc')?'v=DMARC1; p=none':'v=spf1 -all']];};
 const result=await diagnoseMailDomain(f.u.p,f.mailbox.id,undefined,{resolveTxt:resolve});assert.equal(result.spf,'observed');assert.equal(result.dkim,'unverified');assert.equal(result.alignment,'unverified');assert.ok(queries.every(q=>!q.includes('_domainkey')));
});
test('reviewed recovery acknowledgement preserves stale freshness until a new successful sync',async()=>{
 const f=await multiFixture(true);await testAdmin(c=>c.query("UPDATE app.email_mailbox SET sync_gap=true,sync_state='recovering',state='attention',bounce_paused=true,last_synced_at=clock_timestamp()-interval '1 day' WHERE id=$1",[f.mailbox.id]));
 const path='/api/mailboxes/'+f.mailbox.id+'/resume',params={id:f.mailbox.id,action:'resume'},body={requestId:randomUUID(),expectedRevision:1,acknowledge:true,reason:'Revisei o histórico da caixa e os motivos das devoluções manualmente.'};
 assert.equal((await mailboxHttp(req(f.u.headers,path,{...body,acknowledge:false}),params)).status,422);
 assert.equal((await mailboxHttp(req(f.u.headers,path,body),params)).status,200);assert.equal((await mailboxHttp(req(f.u.headers,path,body),params)).status,200);
 const box=(await testAdmin(c=>c.query('SELECT * FROM app.email_mailbox WHERE id=$1',[f.mailbox.id]))).rows[0];assert.equal(box.state,'verifying');assert.equal(box.sync_state,'baseline');assert.equal(box.bounce_paused,false);assert.ok(box.last_synced_at.getTime()<Date.now()-3600000);
});
test('SMTP ownership proof is reviewed queued once and only becomes owned after an authenticated incoming nonce',async()=>{
 const u=await mailUser(),box=await saveMailbox(u.p,smtpMailboxInput()),f=await mailTransports();
 try{
  const action=(name:string,body:unknown)=>mailboxHttp(req(u.headers,'/api/mailboxes/'+box.id+'/'+name,body),{id:box.id,action:name},{transport:f.deps});
  assert.equal((await action('verify',{requestId:randomUUID(),expectedRevision:1})).status,200);
  const detail=await (await mailboxHttp(req(u.headers,'/api/mailboxes/'+box.id),{id:box.id})).json();assert.ok(detail.mailbox.senderId);
  assert.equal((await action('limits',{requestId:randomUUID(),expectedRevision:1,limitsRevision:0,channelRevision:0,workspaceDailyLimit:5,channelDailyLimit:5,senderDailyLimit:5,minIntervalSeconds:1,maxIntervalSeconds:1})).status,200);
  const leases=await claimMailboxSync(new Date(Date.now()+1000).toISOString(),{workspaceId:u.p.workspaceId,mailboxId:box.id,limit:1});await runMailboxSync(leases[0],{adapter:createSmtpImapAdapter(f.deps)});
  const input={messageId:randomUUID(),expectedRevision:1,mode:'proof'},prepared=await action('test-prepare',input);assert.equal(prepared.status,200);const review=await prepared.json();assert.deepEqual(review.blockers,[]);assert.equal(f.smtp.state.dataCount,0);
  const command={...input,requestId:randomUUID(),reviewToken:review.token,material:review.material};assert.equal((await action('test-confirm',command)).status,200);assert.equal((await action('test-confirm',command)).status,200);
  const lease=await claimDispatch(new Date(Date.now()+1000).toISOString(),{workspaceId:u.p.workspaceId,messageId:input.messageId});assert.ok(lease);
  const context=(await dispatchPool().query('SELECT app.read_message_dispatch($1,$2,$3,$4) AS ctx',leaseArgs(lease))).rows[0].ctx;assert.equal(context.mailboxProof,true,JSON.stringify({blocker:context.blocker,proof:context.mailboxProof,box:context.mailbox?.state}));
  await dispatchOne(lease,{now:()=>new Date().toISOString(),mailAdapter:createSmtpImapAdapter(f.deps)});
  const outcome=(await testAdmin(c=>c.query('SELECT state,blocked_code FROM app.message_outbox WHERE message_id=$1',[input.messageId]))).rows[0];assert.equal(f.smtp.state.dataCount,1,JSON.stringify(outcome));
  assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.email_address_ownership WHERE connection_id=$1',[box.id]))).rowCount,0);
  await testAdmin(c=>c.query("UPDATE app.email_sync_cursor SET next_at=clock_timestamp()-interval '1 second' WHERE mailbox_id=$1",[box.id]));const next=(await claimMailboxSync(new Date(Date.now()+1000).toISOString(),{workspaceId:u.p.workspaceId,mailboxId:box.id,limit:1}))[0];
  await ingestMailBatch(next,{messages:[{remoteId:'self-proof',remoteThreadId:null,rfcMessageId:review.snapshot.rfcMessageId,inReplyTo:null,references:[],from:box.address!,to:[box.address!],subject:review.snapshot.content.subject,text:review.snapshot.content.text,receivedAt:new Date().toISOString(),direction:'inbound',classification:'human',attachments:[],truncated:false}],next:{kind:'imap',path:'INBOX',uidValidity:'1',lastUid:1,watermark:new Date().toISOString()},complete:true,gap:false});
  assert.equal((await testAdmin(c=>c.query('SELECT * FROM app.email_address_ownership WHERE connection_id=$1',[box.id]))).rowCount,1);
 }finally{await f.close();}
});
