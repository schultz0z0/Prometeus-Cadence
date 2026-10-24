import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeConfig,runSerialLoop} from '../scripts/runtime-core.ts';

test('invalid frequency/budget cannot start an unbounded runtime',()=>{
 for(const value of ['0','-1','1.5','NaN','99999999'])assert.throws(()=>runtimeConfig({RUNTIME_DISPATCH_MS:value}),/RUNTIME_DISPATCH_MS/);
 assert.throws(()=>runtimeConfig({RUNTIME_SYNC_MESSAGES:'101'}),/RUNTIME_SYNC_MESSAGES/);
 assert.throws(()=>runtimeConfig({RUNTIME_SYNC_BOXES:'0'}),/RUNTIME_SYNC_BOXES/);
});
test('billing reconciliation has a permanent bounded lane',()=>{
 assert.equal(runtimeConfig({}).billingMs,5000);assert.equal(runtimeConfig({}).billingBatch,5);
 assert.throws(()=>runtimeConfig({RUNTIME_BILLING_MS:'4999'}),/RUNTIME_BILLING_MS/);
 assert.throws(()=>runtimeConfig({RUNTIME_BILLING_BATCH:'11'}),/RUNTIME_BILLING_BATCH/);
});
test('serial runtime recovers with backoff and shuts down without another tick',async()=>{
 const controller=new AbortController(),delays:number[]=[];let calls=0,running=false;
 await runSerialLoop(async()=>{assert.equal(running,false);running=true;try{if(++calls<3)throw Error('database unavailable');}finally{running=false;}},{signal:controller.signal,intervalMs:2000,random:()=>0,sleep:async ms=>{delays.push(ms);if(delays.length===4)controller.abort();}});
 assert.equal(calls,4);assert.deepEqual(delays,[4000,8000,2000,2000]);
});
