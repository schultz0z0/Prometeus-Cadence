import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {startPolling,type PollingEnvironment} from '../src/client/live-refresh.ts';

test('slow requests do not overlap; hidden/offline pauses and disposal cancels late work',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});
 let available=true,wake=()=>{},calls=0,finish=()=>{};const signals:AbortSignal[]=[];
 const env:PollingEnvironment={available:()=>available,now:()=>Date.now(),random:()=>0,subscribe:fn=>{wake=fn;return()=>{wake=()=>{};};},schedule:(fn,ms)=>{const id=setTimeout(fn,ms);return()=>clearTimeout(id);}};
 const stop=startPolling(async signal=>{signals.push(signal);calls++;await new Promise<void>(resolve=>{finish=resolve;});},{intervalMs:5000,environment:env});
 t.mock.timers.tick(5000);await flush();assert.equal(calls,1);
 t.mock.timers.tick(20000);wake();await flush();assert.equal(calls,1);
 available=false;finish();await flush();t.mock.timers.tick(20000);await flush();assert.equal(calls,1);
 available=true;wake();await flush();assert.equal(calls,2);
 stop();assert.equal(signals[1].aborted,true);finish();await flush();t.mock.timers.tick(60000);wake();await flush();assert.equal(calls,2);
});

test('failures back off, recovery restores frequency and focus events cannot cause a request storm',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date']});let calls=0,wake=()=>{};
 const env:PollingEnvironment={available:()=>true,now:()=>Date.now(),random:()=>0,subscribe:fn=>{wake=fn;return()=>{};},schedule:(fn,ms)=>{const id=setTimeout(fn,ms);return()=>clearTimeout(id);}};
 const stop=startPolling(async()=>{if(++calls<3)throw Error('offline');},{intervalMs:5000,environment:env});
 t.mock.timers.tick(5000);await flush();assert.equal(calls,1);
 for(let i=0;i<20;i++)wake();t.mock.timers.tick(9999);await flush();assert.equal(calls,1);
 t.mock.timers.tick(1);await flush();assert.equal(calls,2);
 t.mock.timers.tick(20000);await flush();assert.equal(calls,3);
 t.mock.timers.tick(5000);await flush();assert.equal(calls,4);stop();
});
