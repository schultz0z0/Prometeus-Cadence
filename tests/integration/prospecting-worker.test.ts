import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareJob,confirmJob} from '../../src/server/prospecting/service.ts';
import {claimJob,heartbeat} from '../../src/server/prospecting/lease.ts';
import {workerPool,withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {configureProspectingTest,prospectingUser,generationInput,testAdmin,closeProspectingPools,grantTestLease} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
configureProspectingTest();beforeEach(resetRateLimits);after(async()=>{await workerPool().end();await closeProspectingPools();});
process.env.PROSPECTING_GLOBAL_CONCURRENCY='32';
test('worker has minimal grants and serialized claims; expired heartbeat cannot renew',async()=>{
  const {p}=await prospectingUser(),input=generationInput(),review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});
  // Isolate queue competition with a workspace-only test filter, not a production bypass.
  const claims=await Promise.all([claimJob('qa1',p.workspaceId),claimJob('qa2',p.workspaceId)]);
  assert.equal(claims.filter(Boolean).length,1);const lease=claims.find(Boolean)!;assert.equal(lease.jobId,job.id);
  await assert.rejects(()=>workerPool().query('SELECT * FROM auth.session'),/permission denied/);
  await assert.rejects(()=>withWorkspaceTransaction(p,c=>c.query("SELECT app.claim_prospecting_job('app',1,NULL)")),/permission denied/);
  assert.equal(await heartbeat(lease),true);
  await withLeasedTransaction(lease,async c=>{assert.equal((await c.query('SELECT count(*) FROM app.prospecting_job')).rows[0].count,'1');});
  await testAdmin(c=>c.query("UPDATE app.prospecting_job SET lease_until=now()-interval '1 second' WHERE workspace_id=$1 AND id=$2",[p.workspaceId,job.id]));
  assert.equal(await heartbeat(lease),false);
  const resumed=await claimJob('qa3',p.workspaceId);assert.ok(resumed);assert.ok(resumed.fence>lease.fence);
  await assert.rejects(()=>withLeasedTransaction(lease,async()=>{}),{status:409});
});

test('Codex slot is shared across workspaces and can only be released by its token',async()=>{
  async function setup(){const {p}=await prospectingUser(),input=generationInput(),review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});return grantTestLease(p,job.id);}
  const a=await setup(),b=await setup();
  const slot=(lease:typeof a,release=false)=>withLeasedTransaction(lease,async c=>Boolean((await c.query('SELECT app.codex_prospecting_slot($1,$2,$3,$4) AS ok',[lease.jobId,lease.token,lease.fence,release])).rows[0].ok));
  assert.equal(await slot(a),true);assert.equal(await slot(b),false);assert.equal(await slot(b,true),false);assert.equal(await slot(a,true),true);assert.equal(await slot(b),true);assert.equal(await slot(b,true),true);
});
