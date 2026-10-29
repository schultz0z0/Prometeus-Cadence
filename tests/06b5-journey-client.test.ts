import test from 'node:test';import assert from 'node:assert/strict';
import {createProspectingClient} from '../src/client/prospecting-client.ts';
import type {JourneyReview} from '../src/domain/prospecting-journey.ts';
test('a lost journey confirmation reuses its idempotency key and workspace scope on retry',async()=>{
 const bodies:any[]=[],headers:any[]=[];let lost=true;const client=createProspectingClient({workspaceId:'qa-workspace',transport:async(path,options)=>{assert.equal(path,'/api/prospecting/journeys');bodies.push(JSON.parse(String(options?.body)));headers.push(options?.headers);if(lost){lost=false;throw Error('Lost response');}return Response.json({id:'same-journey'});}});
 const review:JourneyReview={input:{brief:'Clínicas',location:'Rio',limit:10},token:'reviewed',expiresAt:'2030-01-01',basisHash:'proof',blockers:[],warnings:[],usage:[],effects:[]};
 await assert.rejects(client.confirmJourney(review),/Lost response/);assert.equal((await client.confirmJourney(review)).id,'same-journey');assert.equal(bodies[0].requestId,bodies[1].requestId);assert.equal(headers[0]['x-cadence-workspace'],'qa-workspace');assert.equal(bodies[0].action,'confirm');client.dispose();await assert.rejects(client.journey('foreign'),/workspace/);
});
