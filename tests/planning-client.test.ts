import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlanningClient} from '../src/client/planning-client.ts';
import {createContextClient} from '../src/client/context-client.ts';
import type {PlanningReview,PlanningSelectionReview} from '../src/domain/planning.ts';
const review:PlanningReview={input:{kind:'planning',task:'audience_plan',description:'Clínicas',channel:'whatsapp',timezone:'UTC'},token:'proof',expiresAt:'',profileVersion:'fixture',usage:[],blockers:[],warnings:[],base:{contextVersion:1,productVersion:null,workspaceRevision:1},productId:null};
test('prepare never confirms and lost analysis response retries the same identity without another flight',async()=>{
 const paths:string[]=[],bodies:any[]=[];let fail=true;
 const client=createPlanningClient({workspaceId:'a',transport:async(url,init)=>{paths.push(String(url));assert.equal(new Headers(init!.headers).get('x-cadence-workspace'),'a');if(String(url).endsWith('/prepare'))return Response.json(review);bodies.push(JSON.parse(init!.body as string));if(fail)throw Error('lost');return Response.json({id:'job'});}});
 const prepared=await client.prepare(review.input);assert.deepEqual(paths,['/api/planning/prepare']);
 const a=client.confirm(prepared),b=client.confirm(prepared);assert.equal(a,b);await assert.rejects(a);fail=false;assert.equal((await client.confirm(prepared)).id,'job');assert.equal(bodies[0].requestId,bodies[1].requestId);
});
test('selection retry preserves edits and conflicts never re-prepare or auto-submit',async()=>{
 const bodies:any[]=[];let fail=true;
 const client=createPlanningClient({workspaceId:'a',transport:async(_url,init)=>{bodies.push(JSON.parse(init!.body as string));if(fail)throw Error('lost');return Response.json({revision:2,listId:'list'});}});
 const selection:PlanningSelectionReview={optionId:'option_1',edits:{title:'Minha edição'},token:'proof',expiresAt:'',effects:[],blockers:[]};
 await assert.rejects(()=>client.confirmSelection('job',selection));fail=false;await client.confirmSelection('job',selection);assert.equal(bodies[0].requestId,bodies[1].requestId);assert.deepEqual(bodies[1].edits,{title:'Minha edição'});
 let calls=0;const conflict=createPlanningClient({workspaceId:'a',transport:async()=>{calls++;return Response.json({message:'Mudou'},{status:409});}});await assert.rejects(()=>conflict.confirm(review),{status:409});assert.equal(calls,1);
});
test('revoked access aborts workspace requests and disposed context drops late results',async()=>{
 let signal:AbortSignal|undefined,lost=false;
 const client=createPlanningClient({workspaceId:'a',onAccessLost:()=>lost=true,transport:async(_url,init)=>{signal=init!.signal!;return Response.json({message:'Sem acesso'},{status:403});}});
 await assert.rejects(()=>client.get('job'),{status:403});assert.equal(lost,true);assert.equal(signal?.aborted,true);await assert.rejects(()=>client.prepare(review.input));
 let finish!:(r:Response)=>void;const context=createContextClient({workspaceId:'b',transport:()=>new Promise(resolve=>finish=resolve)}),pending=context.get();context.dispose();finish(Response.json({products:[]}));await assert.rejects(pending);
});
