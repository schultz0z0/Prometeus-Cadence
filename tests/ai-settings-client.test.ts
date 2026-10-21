import test from 'node:test';import assert from 'node:assert/strict';import {createProspectingClient} from '../src/client/prospecting-client.ts';
const policy={revision:1,mode:'auto' as const,conventionalProvider:'codex-local' as const,jevEnabled:false};
test('AI policy save is explicit, concurrent-safe and retries the same request after lost response',async()=>{
 const bodies:any[]=[];let fail=true;const client=createProspectingClient({workspaceId:'a',transport:async(url,init)=>{bodies.push(JSON.parse(init!.body as string));if(fail)throw Error('network');return Response.json(policy);}});
 assert.equal(bodies.length,0);const a=client.saveAiPolicy({...policy,revision:0}),b=client.saveAiPolicy({...policy,revision:0});assert.equal(a,b);await assert.rejects(a);fail=false;await client.saveAiPolicy({...policy,revision:0});assert.equal(bodies.length,2);assert.equal(bodies[0].requestId,bodies[1].requestId);assert.equal(bodies[0].expectedRevision,0);
});
test('preparing AI connection does not confirm it and explicit confirmation retries without a second identity',async()=>{
 const paths:string[]=[],bodies:any[]=[];let fail=true;const review={draft:{sampleId:'sample'},token:'proof',expiresAt:'',route:null,usage:[],blockers:[]};
 const client=createProspectingClient({workspaceId:'a',transport:async(url,init)=>{paths.push(String(url));if(String(url).endsWith('/prepare'))return Response.json(review);bodies.push(JSON.parse(init!.body as string));if(fail)throw Error('network');return Response.json({id:'job'});}});
 const r=await client.prepareAiTest();assert.deepEqual(paths,['/api/prospecting/ai/test/prepare']);const a=client.confirmAiTest(r),b=client.confirmAiTest(r);assert.equal(a,b);await assert.rejects(a);fail=false;assert.equal((await client.confirmAiTest(r)).id,'job');assert.equal(bodies[0].requestId,bodies[1].requestId);
});
test('AI policy conflict never auto-retries and a disposed workspace rejects late settings',async()=>{
 let calls=0;const client=createProspectingClient({workspaceId:'a',transport:async()=>{calls++;return Response.json({message:'Changed',code:'AI_POLICY_CHANGED'},{status:409});}});await assert.rejects(()=>client.saveAiPolicy(policy),{status:409});assert.equal(calls,1);
 let complete!:(r:Response)=>void;const late=createProspectingClient({workspaceId:'b',transport:()=>new Promise(resolve=>complete=resolve)});const pending=late.aiSettings();late.dispose();complete(Response.json({policy}));await assert.rejects(pending);
});
