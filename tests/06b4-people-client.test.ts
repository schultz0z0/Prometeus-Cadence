import test from 'node:test';import assert from 'node:assert/strict';
import {createResearchClient} from '../src/client/research-client.ts';
test('a lost people application response retries the same operation in its workspace; disposal closes old reads',async()=>{
 const bodies:any[]=[],scopes:string[]=[],paths:string[]=[];let lost=true;
 const transport=(async(url:any,init:any)=>{paths.push(String(url));scopes.push(new Headers(init.headers).get('x-cadence-workspace')!);bodies.push(init.body?JSON.parse(init.body):null);if(lost){lost=false;throw Error('Lost response');}return Response.json({applied:1});}) as typeof fetch;
 const review={input:{caseId:'case',personIds:['person'],expectedRevision:4},token:'reviewed',expiresAt:'',blockers:[],warnings:[],basisHash:'hash'},first=createResearchClient({workspaceId:'one',transport});
 await assert.rejects(first.applyPeople(review));assert.deepEqual(await first.applyPeople(review),{applied:1});assert.equal(bodies[0].requestId,bodies[1].requestId);assert.deepEqual(scopes,['one','one']);assert.ok(paths.every(p=>p==='/api/research/case/people'));assert.equal(bodies[1].action,'confirm-apply');
 const second=createResearchClient({workspaceId:'two',transport});await second.applyPeople(review);assert.equal(scopes[2],'two');assert.notEqual(bodies[2].requestId,bodies[0].requestId);
 first.dispose();const calls=paths.length;await assert.rejects(first.people('case'));await assert.rejects(first.latestPeople('lead'));assert.equal(paths.length,calls);second.dispose();
});
