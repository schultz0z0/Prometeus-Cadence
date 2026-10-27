import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPlanningFixture,planningStorageJob as emptyStorageJob} from './planning-helpers.ts';
import {configurePlatformAiTest} from './platform-ai-helpers.ts';
import {saveAiPolicy} from '../../src/server/prospecting/ai/settings.ts';
import {conventionalConfig} from '../../src/server/prospecting/ai/config.ts';
import {grantTestLease,closeProspectingPools,testAdmin,countRows} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {withWorkspaceTransaction,withContextTransaction} from '../../src/server/db/transaction.ts';
import {workerPool} from '../../src/server/prospecting/worker-db.ts';
import {savePlanningEvidence} from '../../src/server/planning/evidence.ts';
import {savePlanningProposal,readPlanningProposal} from '../../src/server/planning/repository.ts';
import {planningSources} from '../planning-fixtures.ts';
import type {JobLease} from '../../src/domain/prospecting.ts';
import type {PlanningProposal} from '../../src/domain/planning.ts';
beforeEach(resetRateLimits);after(closeProspectingPools);
const worker=<T>(lease:JobLease,fn:Parameters<typeof withWorkspaceTransaction<T>>[1])=>withContextTransaction(workerPool(),{workspaceId:lease.workspaceId,userId:lease.actorId,role:'operator',sessionId:'worker'},fn);
async function planningStorageJob(p:Parameters<typeof emptyStorageJob>[0]){
 await configurePlatformAiTest(p);Object.assign(process.env,{OPENAI_API_KEY:'fixture',OPENAI_MODEL:'fixture'});
 const policy=await saveAiPolicy(p,{requestId:randomUUID(),expectedRevision:0,policy:{mode:'conventional-only',conventionalProvider:'openai',jevEnabled:false}}),job=await emptyStorageJob(p);
 await testAdmin(c=>c.query('UPDATE app.prospecting_job SET checkpoint=$2 WHERE id=$1',[job.id,{execution:{aiRoute:{policyRevision:policy.revision,mode:'conventional-only',effectiveMode:'conventional',decisionProvider:'openai',conventional:conventionalConfig(p.workspaceId).conventional.openai.route}}}]));return job;
}
function proposal(jobId:string):PlanningProposal{return {task:'context_read',contractVersion:'planning-v1',jobId,base:{contextVersion:0,productVersion:null,workspaceRevision:0},evidenceIds:['page_1'],recommendedOptionId:null,fields:{offer:{value:'Clínicas',quote:'Atendemos clínicas.',evidenceIds:['page_1']}}};}

test('planning persists without domain objects and legacy jobs still require a list',async()=>{
  const {p}=await createPlanningFixture(),job=await planningStorageJob(p);
  assert.equal(job.listId,null);assert.equal(job.kind,'planning');assert.equal(job.task,'context_read');assert.equal(job.source,'AI');
  assert.equal(await countRows('list',p.workspaceId),0);
  await assert.rejects(()=>withWorkspaceTransaction(p,c=>c.query("INSERT INTO app.prospecting_job(workspace_id,id,actor_id,request_id,body_hash,kind,source,state,input,profile_version) VALUES($1,$2,$3,$4,'x','generation','MAPS','queued','{}','x')",[p.workspaceId,randomUUID(),p.userId,randomUUID()])),e=>(e as {code:string}).code==='23514');
});
test('only a fenced worker can publish immutable planning evidence and proposals; another workspace cannot read them',async()=>{
  const {p}=await createPlanningFixture(),job=await planningStorageJob(p),lease=await grantTestLease(p,job.id),sources=planningSources(),result=proposal(job.id);
  await assert.rejects(()=>withWorkspaceTransaction(p,c=>savePlanningEvidence(c,lease,sources)),/permission denied/);
  await assert.rejects(()=>worker({...lease,fence:0},c=>savePlanningEvidence(c,{...lease,fence:0},sources)),{status:409});
  await assert.rejects(()=>worker(lease,c=>c.query('INSERT INTO app.planning_evidence(workspace_id,job_id,id,body_hash,payload) VALUES($1,$2,$3,$4,$5)',[p.workspaceId,job.id,'forged','x',sources[0]])),/row-level security/);
  await worker(lease,async c=>{await savePlanningEvidence(c,lease,sources);await savePlanningProposal(c,lease,result);});
  assert.deepEqual(await readPlanningProposal(p,job.id),result);
  const before=await testAdmin(async c=>(await c.query('SELECT created_at FROM app.planning_proposal WHERE workspace_id=$1 AND job_id=$2',[p.workspaceId,job.id])).rows[0].created_at.toISOString());
  await worker(lease,async c=>{await savePlanningEvidence(c,lease,sources);await savePlanningProposal(c,lease,result);});
  assert.equal(await testAdmin(async c=>(await c.query('SELECT created_at FROM app.planning_proposal WHERE workspace_id=$1 AND job_id=$2',[p.workspaceId,job.id])).rows[0].created_at.toISOString()),before);
  await assert.rejects(()=>worker(lease,c=>savePlanningProposal(c,lease,{...result,base:{...result.base,contextVersion:1}})),{status:409});
  await assert.rejects(()=>worker(lease,c=>savePlanningEvidence(c,lease,[{...sources[0],text:'changed'}])),{status:409});
  const b=await createPlanningFixture();await assert.rejects(()=>readPlanningProposal(b.p,job.id),{status:404});
  await assert.rejects(()=>withWorkspaceTransaction(p,c=>c.query('UPDATE app.planning_proposal SET payload=$1 WHERE job_id=$2',[result,job.id])),/permission denied/);
  await assert.rejects(()=>worker({...lease,token:'stale'},c=>savePlanningProposal(c,{...lease,token:'stale'},result)),{status:409});
});
test('rollback cannot leave a partial proposal or evidence pack',async()=>{
  const {p}=await createPlanningFixture(),job=await planningStorageJob(p),lease=await grantTestLease(p,job.id);
  await assert.rejects(()=>worker(lease,async c=>{await savePlanningEvidence(c,lease,planningSources());await savePlanningProposal(c,lease,proposal(job.id));throw Error('rollback');}));
  await assert.rejects(()=>readPlanningProposal(p,job.id),{status:404});
  assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.planning_evidence WHERE workspace_id=$1 AND job_id=$2',[p.workspaceId,job.id])).rows[0].count),'0');
});
