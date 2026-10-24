import test from 'node:test';import assert from 'node:assert/strict';
import {startOpenwaPolling} from '../src/client/openwa-flow.ts';
import {createChannelClient} from '../src/client/channel-client.ts';import type {OpenwaConnectionView} from '../src/domain/openwa.ts';
const status=(phase:OpenwaConnectionView['phase']='qr_ready')=>({phase,connection:{id:'fixture',revision:1},platformDailyCap:20,platformNewConversationCap:5}) as OpenwaConnectionView;
test('QR polling is bounded, single flight, phase dependent and discards late workspace data',async()=>{
 let time=0,next:(()=>void)|undefined,delay=0,resolve!:(v:any)=>void,qrCalls=0;const images:(string|null)[]=[],errors:unknown[]=[];
 const stop=startOpenwaPolling({connectionId:'fixture',revision:1,readStatus:async()=>status(),readQr:async()=>{qrCalls++;return new Promise(r=>resolve=r);},onStatus:()=>{},onQr:v=>images.push(v),onError:e=>errors.push(e),onExpired:()=>{},now:()=>time,schedule:(fn,ms)=>{next=fn;delay=ms;return()=>{next=undefined;};}});
 await new Promise(r=>setImmediate(r));assert.equal(qrCalls,1);assert.equal(next,undefined);stop();resolve({connectionId:'fixture',revision:1,qrCode:'fixture-old-workspace-qr',phase:'qr_ready',refreshAfterMs:3000});await new Promise(r=>setImmediate(r));assert.equal(images.includes('fixture-old-workspace-qr'),false);assert.equal(next,undefined);assert.deepEqual(errors,[]);
 let expired=false,phase:OpenwaConnectionView['phase']='provisioning';const release=startOpenwaPolling({connectionId:'fixture',revision:1,readStatus:async()=>status(phase),readQr:async()=>{qrCalls++;return {connectionId:'fixture',revision:1,qrCode:null,phase:'qr_ready',refreshAfterMs:0};},onStatus:()=>{},onQr:()=>{},onError:()=>{},onExpired:()=>{expired=true;},now:()=>time,schedule:(fn,ms)=>{next=fn;delay=ms;return()=>{next=undefined;};}});
 await new Promise(r=>setImmediate(r));assert.equal(delay,10000);phase='qr_ready';next!();await new Promise(r=>setImmediate(r));assert.equal(delay,3000);time=600001;next!();await new Promise(r=>setImmediate(r));assert.equal(expired,true);release();
});
test('OpenWA create and reconnect retain command identity across retries without arbitrary remote credentials',async()=>{
 const calls:any[]=[];let lost=true;const client=createChannelClient({workspaceId:'fixture-ws',transport:async(url,init)=>{calls.push({url,body:JSON.parse(String(init?.body)),cache:init?.cache});if(lost){lost=false;throw Error('lost');}return Response.json(status());}}),input={name:'My own number',expectedRevision:0 as const};
 await assert.rejects(client.createOpenwa(input));await client.createOpenwa(input);assert.equal(calls[0].body.requestId,calls[1].body.requestId);assert.deepEqual(Object.keys(calls[1].body).sort(),['expectedRevision','name','requestId']);assert.equal(calls[1].cache,'no-store');client.dispose();
});
