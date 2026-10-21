import test from 'node:test';
import assert from 'node:assert/strict';
import {createChannelClient} from '../src/client/channel-client.ts';

test('verify and template sync never confirm tests; saving blank secrets passes them unchanged',async()=>{
 const calls:{url:string;body:any}[]=[];
 const client=createChannelClient({workspaceId:'workspace-a',transport:async(url,init)=>{
  assert.equal(new Headers(init?.headers).get('x-cadence-workspace'),'workspace-a');
  calls.push({url:String(url),body:init?.body?JSON.parse(String(init.body)):null});return Response.json({id:'connection',revision:2});
 }});
 await client.verify('connection',1);await client.syncTemplates('connection',2);
 await client.save({provider:'meta',expectedRevision:1,id:'connection',name:'Meta',identifiers:{appId:'1',wabaId:'2',phoneNumberId:'3'},credentials:{accessToken:'',appSecret:''}});
 assert.equal(calls.filter(c=>c.url.endsWith('/test-confirm')).length,0);
 assert.deepEqual(calls[2].body.credentials,{accessToken:'',appSecret:''});
});

test('test confirmation is explicit, single flight and keeps request identity after lost response',async()=>{
 const bodies:any[]=[],urls:string[]=[];let fail=true;
 const client=createChannelClient({workspaceId:'a',transport:async(url,init)=>{
  urls.push(String(url));if(String(url).endsWith('/test-prepare'))return Response.json({token:'review',snapshot:{},preview:'Olá',blockers:[],expiresAt:''});
  bodies.push(JSON.parse(String(init?.body)));if(fail)throw Error('lost');return Response.json({id:'queued',state:'pending'});
 }});
 const prepared=await client.prepareTest('connection',{senderId:'sender',phone:'+5541999999999',content:{kind:'text',text:'Olá'}});
 assert.equal(urls.length,1);const a=client.confirmTest(prepared),b=client.confirmTest(prepared);assert.equal(a,b);await assert.rejects(a);
 fail=false;await client.confirmTest(prepared);assert.equal(bodies[0].requestId,bodies[1].requestId);assert.equal(bodies[1].reviewToken,'review');
 assert.equal(bodies[1].phone,'+5541999999999');
});

test('dispose aborts requests and discards responses from the old workspace',async()=>{
 let resolve!:(r:Response)=>void,signal:AbortSignal|null|undefined;
 const client=createChannelClient({workspaceId:'old',transport:async(_url,init)=>{signal=init?.signal;return new Promise(r=>resolve=r);}});
 const pending=client.list();client.dispose();assert.equal(signal?.aborted,true);resolve(Response.json([]));await assert.rejects(pending,/workspace anterior/);
 await assert.rejects(()=>client.list(),/workspace mudou/);
});
