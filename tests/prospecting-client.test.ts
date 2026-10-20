import test from 'node:test';
import assert from 'node:assert/strict';
import {createProspectingClient} from '../src/client/prospecting-client.ts';
const input={kind:'generation' as const,source:'MAPS' as const,destination:{mode:'new' as const,name:'QA'},filters:{term:'dentistas',location:'São Paulo'},limit:5,dedupScope:'workspace' as const};
test('prepare does not create a job and double confirmation shares promise and retry identity',async()=>{
  const calls:{url:string;body:any}[]=[];let fail=true;
  const client=createProspectingClient({workspaceId:'w',transport:async(url,init)=>{calls.push({url:String(url),body:JSON.parse(init!.body as string)});if(String(url).endsWith('/prepare'))return Response.json({token:'proof',input});if(fail){fail=false;throw Error('lost response');}return Response.json({id:'job'});}});
  const review=await client.prepare(input);assert.equal(calls.some(c=>c.url.endsWith('/jobs')),false);
  const a=client.confirm(review),b=client.confirm(review);assert.equal(a,b);await assert.rejects(()=>a);
  await client.confirm(review);assert.equal(calls[1].body.requestId,calls[2].body.requestId);
});
test('dispose ignores late replies and access failures clear the owning surface',async()=>{
  let done!:(value:Response)=>void;
  const client=createProspectingClient({workspaceId:'w',transport:()=>new Promise(resolve=>done=resolve)});
  const pending=client.get('job');client.dispose();done(Response.json({id:'old'}));await assert.rejects(()=>pending);
  let cleared=0;
  const revoked=createProspectingClient({workspaceId:'w',onAccessLost:()=>cleared++,transport:async()=>Response.json({message:'changed',code:'WORKSPACE_CHANGED'},{status:409})});
  await assert.rejects(()=>revoked.list());assert.equal(cleared,1);await assert.rejects(()=>revoked.list());
});
