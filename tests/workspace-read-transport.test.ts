import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceTransport} from '../src/client/workspace-transport.ts';
import {createWorkspaceRepository} from '../src/client/workspace-repository.ts';
import {emptyWorkspace} from '../src/domain/empty-workspace.ts';
test('identical GETs share a pending read per workspace instance but POSTs never share',async()=>{
 let calls=0,finish=()=>{};
 const transport=async()=>{calls++;await new Promise<void>(r=>{finish=r;});return Response.json({ok:true});};
 const api=createWorkspaceTransport({workspaceId:'a',transport});
 const first=api.request('/api/fixture'),second=api.request('/api/fixture');assert.equal(calls,1);finish();await Promise.all([first,second]);
 const postApi=createWorkspaceTransport({workspaceId:'a',transport:async()=>{calls++;return Response.json({ok:true});}});
 await Promise.all([postApi.request('/api/fixture',{}),postApi.request('/api/fixture',{})]);assert.equal(calls,3);
 await Promise.all([api.request('/api/different'),postApi.request('/api/fixture')].map(async(p,i)=>{if(!i)finish();return p;}));
});
test('failed GET can be retried and independent workspace transports never share',async()=>{
 let calls=0;const transport=async()=>{if(++calls===1)throw Error('offline');return Response.json({ok:true});};
 const a=createWorkspaceTransport({workspaceId:'a',transport}),b=createWorkspaceTransport({workspaceId:'b',transport});
 await assert.rejects(a.request('/api/fixture'));await Promise.all([a.request('/api/fixture'),b.request('/api/fixture')]);assert.equal(calls,3);
});
test('dirty external refresh keeps the original snapshot and concurrent refresh coalesces',async()=>{
 const initial={workspaceId:'a',revision:0,data:emptyWorkspace(),capabilities:['data.write']};
 let calls=0,finish=()=>{};
 const repo=createWorkspaceRepository(initial,async()=>{calls++;await new Promise<void>(r=>{finish=r;});return Response.json({...initial,revision:1});},{hasEdits:()=>true});
 const before=repo.snapshot(),first=repo.refresh(),second=repo.refresh();assert.equal(calls,1);finish();await Promise.all([first,second]);
 assert.equal(repo.snapshot(),before);assert.equal(repo.access().kind,'conflict');
});
test('mutation invalidates older GETs instead of reusing stale coalesced data',async()=>{
 let finish!:(r:Response)=>void,gets=0;
 const api=createWorkspaceTransport({workspaceId:'a',transport:async(_path,init)=>{
  if(init?.method==='POST')return Response.json({saved:true});
  if(++gets===1)return new Promise<Response>(r=>{finish=r;});return Response.json({revision:2});
 }});
 const old=api.request('/api/fixture'),rejected=assert.rejects(old,/consulta|dados/i);
 await api.request('/api/fixture',{});
 const current=api.request('/api/fixture');
 finish(Response.json({revision:1}));await rejected;
 assert.deepEqual(await current,{revision:2});assert.equal(gets,2);
});
test('disposal aborts pending reads and does not publish the old workspace response',async()=>{
 let finish!:(r:Response)=>void,signal:AbortSignal|undefined;
 const api=createWorkspaceTransport({workspaceId:'a',transport:async(_p,init)=>{signal=init?.signal as AbortSignal;return new Promise<Response>(r=>{finish=r;});}});
 const pending=api.request('/api/fixture');api.dispose();assert.equal(signal?.aborted,true);
 finish(Response.json({private:'old workspace'}));await assert.rejects(pending,/workspace anterior/);
});
test('a GET started during a POST cannot replace a post-commit reload',async()=>{
 let finishPost!:(r:Response)=>void,finishGet!:(r:Response)=>void,gets=0;
 const api=createWorkspaceTransport({workspaceId:'a',transport:async(_path,init)=>{
  if(init?.method==='POST')return new Promise<Response>(r=>{finishPost=r;});
  if(++gets===1)return new Promise<Response>(r=>{finishGet=r;});return Response.json({revision:2});
 }});
 const post=api.request('/api/fixture',{}),old=api.request('/api/fixture'),rejected=assert.rejects(old,/consulta|dados/i);
 finishPost(Response.json({saved:true}));await post;
 const current=api.request('/api/fixture');finishGet(Response.json({revision:1}));await rejected;
 assert.deepEqual(await current,{revision:2});assert.equal(gets,2);
});
test('a stalled read has a deadline and releases its slot for a subsequent retry',{timeout:25000},async()=>{
 let calls=0;
 const api=createWorkspaceTransport({workspaceId:'a',transport:async(_path,init)=>{
  if(++calls>1)return Response.json({recovered:true});
  const signal=init!.signal!;return new Promise<Response>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }});
 const keepAlive=setTimeout(()=>{},20000);
 try{await assert.rejects(api.request('/api/fixture'),(e:Error)=>e.name==='TimeoutError');assert.deepEqual(await api.request('/api/fixture'),{recovered:true});}
 finally{clearTimeout(keepAlive);api.dispose();}
});
