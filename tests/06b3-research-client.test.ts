import test from 'node:test';
import assert from 'node:assert/strict';
import {createResearchClient} from '../src/client/research-client.ts';
test('research confirmation keeps its request ID after a lost response and isolates workspace transports',async()=>{
 const bodies:any[]=[],headers:string[]=[];let lost=true;
 const transport=(async(_url:any,init:any)=>{bodies.push(JSON.parse(init.body));headers.push(new Headers(init.headers).get('x-cadence-workspace')!);if(lost){lost=false;throw Error('Lost response');}return Response.json({id:'job'});}) as typeof fetch;
 const review={input:{leadIds:['a'],sourceKinds:['website'] as ('website')[],maxPagesPerCompany:3},token:'signed',expiresAt:'',basisHash:'',blockers:[],warnings:[]};
 const client=createResearchClient({workspaceId:'one',transport});await assert.rejects(client.confirm(review));await client.confirm(review);
 assert.equal(bodies[0].requestId,bodies[1].requestId);assert.deepEqual(headers,['one','one']);
 const other=createResearchClient({workspaceId:'two',transport});await other.confirm(review);assert.notEqual(bodies[2].requestId,bodies[0].requestId);assert.equal(headers[2],'two');client.dispose();other.dispose();
});
test('disposed research clients reject reads without contacting the old workspace',async()=>{
 let calls=0;const client=createResearchClient({workspaceId:'old',transport:(async()=>{calls++;return Response.json(null);}) as typeof fetch});client.dispose();await assert.rejects(client.latest('a'));assert.equal(calls,0);
});
