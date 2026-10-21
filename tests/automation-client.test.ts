import test from 'node:test';import assert from 'node:assert/strict';
import {createAutomationClient} from '../src/client/automation-client.ts';
import type {AutomationActionReview} from '../src/domain/automation-runtime.ts';
const review={action:'run-once',expectedRevision:2,token:'proof'} as AutomationActionReview;
test('automation action retry retains identity; revision edits and conflicts do not auto-submit',async()=>{
 const bodies:any[]=[];let fail=true;
 const client=createAutomationClient({workspaceId:'a',transport:async(_url,init)=>{assert.equal(new Headers(init!.headers).get('x-cadence-workspace'),'a');bodies.push(JSON.parse(init!.body as string));if(fail)throw Error('lost');return Response.json({id:'occ'});}});
 const a=client.confirm('auto',review),b=client.confirm('auto',review);assert.equal(a,b);await assert.rejects(a);fail=false;await client.confirm('auto',review);assert.equal(bodies[0].requestId,bodies[1].requestId);
 await client.confirm('auto',{...review,expectedRevision:3,token:'new'});assert.notEqual(bodies[1].requestId,bodies[2].requestId);
 let calls=0;const conflict=createAutomationClient({workspaceId:'a',transport:async()=>{calls++;return Response.json({message:'Mudou'},{status:409});}});await assert.rejects(()=>conflict.confirm('auto',review),{status:409});assert.equal(calls,1);
});
test('automation access loss disposes all requests and discards late results',async()=>{
 let lost=false;const client=createAutomationClient({workspaceId:'a',onAccessLost:()=>lost=true,transport:async()=>Response.json({message:'Sem acesso'},{status:403})});await assert.rejects(()=>client.list(),{status:403});assert.ok(lost);await assert.rejects(()=>client.prepare('a','activate',1));
 let finish!:(r:Response)=>void;const late=createAutomationClient({workspaceId:'b',transport:()=>new Promise(r=>finish=r)}),pending=late.occurrences('a');late.dispose();finish(Response.json({items:[],nextCursor:null}));await assert.rejects(pending);
});
