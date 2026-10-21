import test from 'node:test';import assert from 'node:assert/strict';import {parseSmokeOptions,parseWorkerOptions} from '../scripts/prospecting-smoke-options.ts';import {spawnSync} from 'node:child_process';
test('smoke defaults to skipped and invalid cost or scope cannot authorize dispatch',()=>{
 assert.deepEqual(parseSmokeOptions([]),{live:false});
 const r=spawnSync(process.execPath,['scripts/smoke-prospecting.mjs'],{encoding:'utf8',timeout:5000});assert.equal(r.status,0);assert.match(r.stdout,/SKIPPED/);
 const args=['--live','--source','CODEX','--workspace','qa','--limit','1','--budget-units','1'];assert.equal(parseSmokeOptions(args).live,true);
 for(const bad of [args.map(x=>x==='CODEX'?'UNKNOWN':x),args.map(x=>x==='1'?'2':x),[...args,'--unknown'],args.slice(0,-2)])assert.throws(()=>parseSmokeOptions(bad));
 assert.throws(()=>parseSmokeOptions(args.map(x=>x==='CODEX'?'OPENAI':x)));assert.equal(parseSmokeOptions([...args.map(x=>x==='CODEX'?'OPENAI':x),'--confirm-provider-cost']).live,true);
 assert.deepEqual(parseWorkerOptions(['--once','--workspace','qa']),{once:true,workspaceId:'qa'});assert.throws(()=>parseWorkerOptions(['--workspace']));assert.throws(()=>parseWorkerOptions(['--unknown']));
});
