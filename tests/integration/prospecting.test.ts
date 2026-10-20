import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareJob,confirmJob,getJob,cancelJob} from '../../src/server/prospecting/service.ts';
import {prospectingRequest} from '../../src/server/prospecting/http.ts';
import {configureProspectingTest,prospectingUser,generationInput,countRows,closeProspectingPools} from './prospecting-helpers.ts';
import {base,resetRateLimits} from './helpers.ts';
beforeEach(resetRateLimits);
configureProspectingTest(); after(closeProspectingPools);
test('prepare is pure and concurrent confirmation creates one job list and reservation',async()=>{
  const {p}=await prospectingUser(), input=generationInput();
  const review=await prepareJob(p,input);
  assert.deepEqual(review.blockers,[]);
  assert.equal(await countRows('prospecting_job',p.workspaceId),0);
  assert.equal(await countRows('list',p.workspaceId),0);
  assert.equal(await countRows('usage_ledger',p.workspaceId),0);
  const body={requestId:randomUUID(),input,reviewToken:review.token};
  const [a,b]=await Promise.all([confirmJob(p,body),confirmJob(p,body)]);
  assert.equal(a.id,b.id); assert.equal(a.state,'queued');
  assert.equal(await countRows('prospecting_job',p.workspaceId),1);
  assert.equal(await countRows('list',p.workspaceId),1);
  assert.equal(await countRows('usage_ledger',p.workspaceId),1);
  await assert.rejects(()=>confirmJob(p,{...body,input:{...input,limit:6}}),{status:409});
  assert.equal((await confirmJob(p,body)).id,a.id);
  const cancelled=await cancelJob(p,a.id);assert.equal(cancelled.state,'cancelled');
});
test('jobs reject another workspace stale headers changed reviews and disabled providers',async()=>{
  const a=await prospectingUser(), b=await prospectingUser(),input=generationInput();
  const review=await prepareJob(a.p,input);
  await assert.rejects(()=>confirmJob(b.p,{requestId:randomUUID(),input,reviewToken:review.token}),{status:409});
  const job=await confirmJob(a.p,{requestId:randomUUID(),input,reviewToken:review.token});
  await assert.rejects(()=>getJob(b.p,job.id),{status:404});
  const headers=new Headers(a.headers);headers.set('x-cadence-workspace',b.p.workspaceId);
  const response=await prospectingRequest(new Request(base+'/api/prospecting/jobs',{headers}), 'list');
  assert.equal(response.status,409);
  const safe=await (await prospectingRequest(new Request(base+'/api/prospecting/jobs',{headers:a.headers}),'list')).text();
  assert.equal(safe.includes(process.env.APIFY_TOKEN!),false);assert.equal(safe.includes('lease_token'),false);
  const old=process.env.PROSPECTING_ENABLED;process.env.PROSPECTING_ENABLED='false';
  try {const r=await prepareJob(a.p,input);assert.ok(r.blockers.length);await assert.rejects(()=>confirmJob(a.p,{requestId:randomUUID(),input,reviewToken:r.token}));}
  finally{process.env.PROSPECTING_ENABLED=old;}
});

test('budget rejection rolls back destination and cancellation releases the reservation',async()=>{
  const {p}=await prospectingUser(),input=generationInput();
  const old=process.env.PROSPECTING_WORKSPACE_DAILY_UNITS;
  process.env.PROSPECTING_WORKSPACE_DAILY_UNITS=JSON.stringify({candidates:5,apifyRuns:1,apolloPages:10,jevCalls:1000,codexCalls:10});
  try {
    const firstReview=await prepareJob(p,input);
    const first=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:firstReview.token});
    const secondReview=await prepareJob(p,input);
    await assert.rejects(()=>confirmJob(p,{requestId:randomUUID(),input,reviewToken:secondReview.token}),{status:429});
    assert.equal(await countRows('list',p.workspaceId),1);
    assert.equal(await countRows('prospecting_job',p.workspaceId),1);
    await cancelJob(p,first.id);
    const thirdReview=await prepareJob(p,input);
    const next=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:thirdReview.token});
    assert.equal(next.state,'queued');
    await cancelJob(p,next.id);
  } finally {process.env.PROSPECTING_WORKSPACE_DAILY_UNITS=old;}
});

test('profile and workspace changes invalidate an unused review',async()=>{
  const {p}=await prospectingUser(),input=generationInput();
  const review=await prepareJob(p,input);
  const old=process.env.APIFY_MAPS_BUILD; process.env.APIFY_MAPS_BUILD='different-build';
  try {await assert.rejects(()=>confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token}),{status:409});}
  finally {process.env.APIFY_MAPS_BUILD=old;}
  const next=await prepareJob(p,input);
  await confirmJob(p,{requestId:randomUUID(),input,reviewToken:next.token});
  await assert.rejects(()=>confirmJob(p,{requestId:randomUUID(),input,reviewToken:next.token}),{status:409});
});
