import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {parseMessagingOptions} from '../scripts/messaging-options.ts';
import {parseWhatsappSmoke} from '../scripts/whatsapp-smoke-options.ts';
test('messaging scope and finite limits require explicit dispatch; smoke defaults off',()=>{
 assert.equal(parseMessagingOptions([]).allowDispatch,false);assert.equal(parseMessagingOptions([]).maxMessages,1);
 assert.throws(()=>parseMessagingOptions(['--allow-dispatch']),/scope/);
 assert.throws(()=>parseMessagingOptions(['--max-messages','0']));assert.throws(()=>parseMessagingOptions(['--max-messages','101']));
 assert.equal(parseMessagingOptions(['--allow-dispatch','--once','--workspace','w']).workspaceId,'w');
 assert.equal(parseMessagingOptions(['--allow-dispatch','--once','--workspace','w','--message','one']).messageId,'one');
 assert.throws(()=>parseMessagingOptions(['--allow-dispatch','--once','--workspace','w','--message','one','--max-messages','2']));
 assert.deepEqual(parseWhatsappSmoke({},[]),{enabled:false});
 assert.throws(()=>parseWhatsappSmoke({WHATSAPP_SMOKE_ENABLED:'true'},['--confirm']));
});
test('disabled worker has no claims and no provider calls',()=>{
 const r=spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/messaging-worker.ts'],{encoding:'utf8',env:{...process.env,MESSAGING_WORKER_ENABLED:'false'}});
 assert.equal(r.status,0);assert.match(r.stdout,/disabled/);assert.doesNotMatch(r.stdout+r.stderr,/Bearer|apify_api_|postgres:\/\//);
});
test('database failure emits a bounded message without raw credentials or driver error',()=>{
 const unavailable='postgresql://fixture-user:never-print-fixture@127.0.0.1:1/no_database';
 const r=spawnSync(process.execPath,['--conditions=react-server','--experimental-strip-types','scripts/messaging-worker.ts','--allow-dispatch','--once','--workspace','fixture'],{encoding:'utf8',timeout:15000,env:{...process.env,MESSAGING_WORKER_ENABLED:'true',INGRESS_DATABASE_URL:unavailable,DISPATCH_DATABASE_URL:unavailable}});
 assert.equal(r.status,1);assert.match(r.stderr,/Messaging worker stopped/);assert.doesNotMatch(r.stdout+r.stderr,/never-print-fixture|fixture-user|ECONNREFUSED|postgresql:\/\//);
});
