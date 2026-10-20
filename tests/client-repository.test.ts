import test from 'node:test';import assert from 'node:assert/strict';import {createWorkspaceRepository,runAction} from '../src/client/workspace-repository.ts';import {emptyWorkspace} from '../src/domain/empty-workspace.ts';
const initial=()=>({workspaceId:'a',revision:0,data:emptyWorkspace(),capabilities:['data.write']});
test('rejected async mutation does not toast success or navigate',async()=>{const notices:string[]=[];const ok=await runAction(async()=>{throw Error('offline');},m=>notices.push(m),'Saved');assert.equal(ok,false);assert.ok(!notices.includes('Saved'));});
test('retry after network failure reuses request id; snapshot publishes only after success',async()=>{
 const requests:any[]=[];let fail=true;const repo=createWorkspaceRepository(initial(),async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);if(fail)throw Error('offline');return Response.json({snapshot:{...initial(),revision:1,data:{...emptyWorkspace(),templates:[body.command.template]}}});});
 const t={id:'t',name:'Draft',body:'Hello',channel:'EMAIL' as const,tags:[]};await assert.rejects(repo.saveTemplate(t));assert.equal(repo.getSnapshot().templates.length,0);fail=false;await repo.saveTemplate(t);assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(repo.getSnapshot().templates.length,1);
});
test('conflict refreshes base without blind retry; disposed workspace ignores late responses',async()=>{
 let writes=0;const repo=createWorkspaceRepository(initial(),async(_url,init)=>{if(init?.method==='POST'){writes++;return Response.json({message:'Conflict'},{status:409});}return Response.json({...initial(),revision:4});});await assert.rejects(repo.deleteTemplate('t'));assert.equal(writes,1);assert.equal(repo.snapshot().revision,4);
 let release!:(r:Response)=>void;const other=createWorkspaceRepository(initial(),()=>new Promise(r=>{release=r;}));const pending=other.saveTemplate({id:'t',name:'Draft',body:'Text',channel:'EMAIL',tags:[]});await new Promise(r=>setImmediate(r));other.dispose();release(Response.json({snapshot:{...initial(),revision:5}}));await assert.rejects(pending);assert.equal(other.snapshot().revision,0);
});
