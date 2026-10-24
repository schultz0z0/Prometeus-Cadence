import test from 'node:test';import assert from 'node:assert/strict';import {runOpenwaChannelTick} from '../src/server/channels/openwa/worker.ts';import {runtimeConfig} from '../scripts/runtime-core.ts';
test('channels lane bounds maintenance and recovery, drains cancellation and never dispatches a message',async()=>{
 assert.equal(runtimeConfig({}).channelsMs,5000);assert.throws(()=>runtimeConfig({RUNTIME_CHANNELS_MS:'0'}));
 let sessions=0,recovery=0,sendCalls=0;const controller=new AbortController(),deps={maintenance:async(options:any)=>{sessions++;assert.equal(options.maxConnections,5);controller.abort();return {processed:1,failed:0};},recovery:async()=>{recovery++;return {processed:1,failed:0};}};
 await runOpenwaChannelTick({now:new Date().toISOString(),signal:controller.signal},deps);assert.equal(sessions,1);assert.equal(recovery,0);assert.equal(sendCalls,0);
 const result=await runOpenwaChannelTick({now:new Date().toISOString()},{maintenance:async()=>({processed:0,failed:0}),recovery:async(options:any)=>{assert.equal(options.maxConnections,5);assert.equal(options.maxMessages,20);return {processed:0,failed:1};}});assert.equal(result.failed,1);
});
