import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareJob,confirmJob,getJob} from '../../src/server/prospecting/service.ts';
import {ingestPage} from '../../src/server/prospecting/ingestion.ts';
import {normalizeCandidate} from '../../src/server/prospecting/normalize.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {configureProspectingTest,prospectingUser,generationInput,grantTestLease,testAdmin,closeProspectingPools} from './prospecting-helpers.ts';
import type {CandidatePage} from '../../src/domain/prospecting.ts';
import {resetRateLimits} from './helpers.ts';
beforeEach(resetRateLimits);
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
configureProspectingTest();after(closeProspectingPools);
async function setup(){const {p}=await prospectingUser(),input=generationInput(),review=await prepareJob(p,input),job=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token}),lease=await grantTestLease(p,job.id);return{p,job,lease};}
function page(receiptId=randomUUID()):CandidatePage{return{receiptId,candidates:[normalizeCandidate({id:'001',name:'Empresa A',phone:'5511999999999'},'MAPS')],nextCursor:'100',exhausted:false,rawCount:1,rejected:[],usage:{provider:'apify',operationId:receiptId,units:{candidates:1},costUsd:null,costKind:'unknown'}};}
test('concurrent ingestion deduplicates strong identity and replay is atomic',async()=>{
  const {p,job,lease}=await setup(),firstPage=page(),secondPage=page();
  const [a,b]=await Promise.all([withWorkspaceTransaction(p,c=>ingestPage(c,lease,firstPage)),withWorkspaceTransaction(p,c=>ingestPage(c,lease,secondPage))]);
  assert.equal(a.inserted+b.inserted,1);assert.equal(a.duplicates+b.duplicates,1);
  assert.deepEqual(await withWorkspaceTransaction(p,c=>ingestPage(c,lease,firstPage)),a);
  const counts=(await getJob(p,job.id)).counts;assert.equal(counts.inserted,1);assert.equal(counts.duplicates,1);
  const other=page();other.candidates=[normalizeCandidate({id:'002',name:'Empresa B',phone:'5511999999999'},'MAPS')];
  assert.equal((await withWorkspaceTransaction(p,c=>ingestPage(c,lease,other))).inserted,1);
  const foreign=await setup();assert.equal((await withWorkspaceTransaction(foreign.p,c=>ingestPage(c,foreign.lease,page()))).inserted,1);
});
test('stale fencing expiry and rollback prevent late writes',async()=>{
  const {p,job,lease}=await setup(),batch=page();
  await assert.rejects(()=>withWorkspaceTransaction(p,c=>ingestPage(c,{...lease,fence:lease.fence-1},batch)),{status:409});
  await assert.rejects(()=>withWorkspaceTransaction(p,async c=>{await ingestPage(c,lease,batch);throw Error('rollback');}));
  assert.equal((await getJob(p,job.id)).counts.inserted,0);
  await testAdmin(c=>c.query("UPDATE app.prospecting_job SET lease_until=now()-interval '1 second' WHERE workspace_id=$1 AND id=$2",[p.workspaceId,job.id]));
  await assert.rejects(()=>withWorkspaceTransaction(p,c=>ingestPage(c,lease,batch)),{status:409});
});

test('workspace dedup keeps the original list while list scope permits a copy; manual identity stays current',async()=>{
  const {p,job,lease}=await setup();await withWorkspaceTransaction(p,c=>ingestPage(c,lease,page()));
  async function another(scope:'list'|'workspace'){
    const input={...generationInput(),dedupScope:scope},review=await prepareJob(p,input);
    const next=await confirmJob(p,{requestId:randomUUID(),input,reviewToken:review.token});
    const granted=await grantTestLease(p,next.id);
    return {next,counts:await withWorkspaceTransaction(p,c=>ingestPage(c,granted,page()))};
  }
  assert.equal((await another('workspace')).counts.duplicates,1);
  assert.equal((await another('list')).counts.inserted,1);
  let snapshot=await readWorkspaceSnapshot(p),lead=snapshot.data.leads.find(l=>l.listId===job.listId)!;
  assert.ok(lead);assert.equal(snapshot.data.leads.length,2);
  await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead:{...lead,cnpj:'00.123.456/0001-90'}}});
  const identities=()=>testAdmin(async c=>(await c.query('SELECT identity FROM app.lead_identity WHERE workspace_id=$1 AND lead_id=$2',[p.workspaceId,lead.id])).rows.map(r=>r.identity));
  assert.ok((await identities()).includes('cnpj:00123456000190'));
  snapshot=await readWorkspaceSnapshot(p);lead=snapshot.data.leads.find(l=>l.id===lead.id)!;
  await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'lead.upsert',lead:{...lead,cnpj:'00.987.654/0001-90'}}});
  assert.equal((await identities()).includes('cnpj:00123456000190'),false);
  assert.ok((await identities()).includes('cnpj:00987654000190'));
});

test('revoked membership rejects ingestion before publication',async()=>{
  const {p,lease}=await setup();
  await testAdmin(c=>c.query('DELETE FROM auth.member WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));
  await assert.rejects(()=>withWorkspaceTransaction(p,c=>ingestPage(c,lease,page())));
  assert.equal(await testAdmin(async c=>Number((await c.query('SELECT count(*) FROM app.lead WHERE workspace_id=$1',[p.workspaceId])).rows[0].count)),0);
});
