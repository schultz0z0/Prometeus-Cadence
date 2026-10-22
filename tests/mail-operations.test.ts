import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {parseMailSyncOptions,mailSyncEnabled} from '../scripts/mail-sync-options.ts';
import {parseEmailSmoke,validateSmokeReview} from '../scripts/email-smoke-options.ts';
import {parseMessagingOptions} from '../scripts/messaging-options.ts';
import {runMailSyncTick} from '../src/server/mail/sync/worker.ts';
test('mail sync requires both gates and a finite explicit scope',()=>{
 assert.equal(mailSyncEnabled({},parseMailSyncOptions([])),false);assert.equal(mailSyncEnabled({MAIL_SYNC_ENABLED:'true'},parseMailSyncOptions([])),false);
 assert.throws(()=>parseMailSyncOptions(['--allow-sync']));assert.throws(()=>parseMailSyncOptions(['--workspace','a','--workspace','b']));assert.throws(()=>parseMailSyncOptions(['--workspace','a','--all-workspaces']));assert.throws(()=>parseMailSyncOptions(['--mailbox','b']));assert.throws(()=>parseMailSyncOptions(['--max-mailboxes','11']));assert.throws(()=>parseMailSyncOptions(['--max-messages','101']));
 assert.equal(mailSyncEnabled({MAIL_SYNC_ENABLED:'true'},parseMailSyncOptions(['--allow-sync','--workspace','w','--mailbox','b','--once'])),true);
 assert.equal(parseMessagingOptions([]).allowSync,false);assert.equal(parseMessagingOptions(['--allow-dispatch','--allow-sync','--once','--workspace','w']).allowSync,true);
});
test('sync tick makes no claims while disabled and uses one lease per bounded mailbox',async()=>{
 let claims=0,reads=0;const seen:string[]=[];const deps={enabled:false,claim:async(_now:string,scope:any)=>{claims++;assert.equal(scope.limit,1);return [{workspaceId:'w',mailboxId:claims===1?'one':'two',token:'t',fence:1,revision:1,expiresAt:''}];},run:async(lease:any,budget:any)=>{reads++;seen.push(lease.mailboxId);assert.equal(budget.maxMessages,20);assert.equal(budget.maxPages,5);return {messages:20,complete:false,gap:false};}};
 const options={now:'2026-10-22T12:00:00Z',workspaceId:'w',maxMailboxes:2,maxMessages:20,allowSync:true};
 assert.equal((await runMailSyncTick(options,deps)).disabled,true);assert.equal(claims,0);
 const result=await runMailSyncTick(options,{...deps,enabled:true});assert.equal(claims,2);assert.equal(reads,2);assert.deepEqual(seen,['one','two']);assert.equal(result.pending,2);assert.equal(result.complete,0);assert.doesNotMatch(JSON.stringify(result),/token|text|address|secret/);
 await assert.rejects(runMailSyncTick({...options,maxMailboxes:11},{...deps,enabled:true}));
});
test('mail smoke defaults skipped and binds confirm to the same reviewed input and request identity',()=>{
 assert.deepEqual(parseEmailSmoke({},[]),{enabled:false});assert.throws(()=>parseEmailSmoke({EMAIL_SMOKE_ENABLED:'true'},['--confirm']));
 const env={EMAIL_SMOKE_ENABLED:'true',SMOKE_WORKSPACE_ID:'w',SMOKE_CONNECTION_ID:'b',SMOKE_COOKIE:'fixture',SMOKE_TEST_EMAIL:'own@example.net',EMAIL_SMOKE_ALLOWLIST:'["own@example.net"]',EMAIL_SMOKE_INPUT_FILE:'fixture.json'};
 const options=parseEmailSmoke(env,['--prepare']);assert.equal(options.enabled,true);assert.throws(()=>parseEmailSmoke({...env,SMOKE_URL:'https://external.example'},['--confirm']));
 const saved={workspaceId:'w',mailboxId:'b',hash:'h',requestId:'stable',review:{blockers:[],expiresAt:'2026-10-22T13:00:00Z'}};
 assert.equal(validateSmokeReview(saved,{workspaceId:'w',mailboxId:'b',hash:'h',requestId:'stable'},Date.parse('2026-10-22T12:00:00Z')),true);
 assert.throws(()=>validateSmokeReview(saved,{workspaceId:'w',mailboxId:'b',hash:'changed',requestId:'stable'},Date.parse('2026-10-22T12:00:00Z')));
});
test('default sync and smoke commands are disabled without network or raw errors',()=>{
 for(const file of ['scripts/mail-sync-worker.ts','scripts/smoke-email.ts']){
  const r=spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types',file],{encoding:'utf8',timeout:15000,env:{...process.env,MAIL_SYNC_ENABLED:'false',EMAIL_SMOKE_ENABLED:'false'}});
  assert.equal(r.status,0);assert.match(r.stdout,/disabled|skipped/i);assert.doesNotMatch(r.stdout+r.stderr,/Bearer|postgresql:|apify_api_/);
 }
});
