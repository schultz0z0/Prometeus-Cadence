import test,{after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPlanningFixture} from './planning-helpers.ts';
import {closeProspectingPools,testAdmin} from './prospecting-helpers.ts';
import {resetRateLimits} from './helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {executeWorkspaceCommand,readWorkspaceSnapshot} from '../../src/server/workspaces/commands.ts';
import {readApprovedContext,readContextState} from '../../src/server/context/repository.ts';
import {saveProduct} from '../../src/server/context/products.ts';
import {contextRequest} from '../../src/server/context/http.ts';
beforeEach(resetRateLimits);after(closeProspectingPools);
const profile={name:'Agenda',offer:'Organização de consultas',idealCustomer:'Clínicas',differentiators:'Agenda integrada',socialProof:'',sources:'Manual'};
test('latest draft does not replace the approved context consumed by jobs',async()=>{
 const {p}=await createPlanningFixture();let snapshot=await readWorkspaceSnapshot(p);
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'context.approve',profile:{...snapshot.data.companyProfile,name:'Empresa',offer:'Aprovada',idealCustomer:'Clínicas'}}});
 snapshot=await readWorkspaceSnapshot(p);
 await executeWorkspaceCommand(p,{requestId:randomUUID(),expectedRevision:snapshot.revision,command:{type:'context.saveDraft',profile:{...snapshot.data.companyProfile,offer:'Rascunho novo'}}});
 const state=await readContextState(p);assert.equal(state.draft.version,2);assert.equal(state.draft.offer,'Rascunho novo');assert.equal(state.approved?.version,1);assert.equal(state.approved?.offer,'Aprovada');
 assert.equal((await withWorkspaceTransaction(p,readApprovedContext))?.version,1);
});
test('product save approve archive and lost-response retries preserve versions and tenant isolation',async()=>{
 const {p}=await createPlanningFixture();
 const body={requestId:randomUUID(),expectedRevision:0,action:'save-draft' as const,profile};
 const [first,again]=await Promise.all([saveProduct(p,body),saveProduct(p,body)]);assert.equal(first.id,again.id);assert.equal(first.revision,1);assert.equal(first.approved,null);
 const approved=await saveProduct(p,{requestId:randomUUID(),id:first.id,expectedRevision:1,action:'approve'});assert.equal(approved.approved?.offer,profile.offer);assert.equal(approved.approved?.version,2);
 const draft=await saveProduct(p,{requestId:randomUUID(),id:first.id,expectedRevision:2,action:'save-draft',profile:{...profile,offer:'Em revisão'}});assert.equal(draft.approved?.offer,profile.offer);
 assert.equal((await saveProduct(p,body)).revision,1);
 await assert.rejects(()=>saveProduct(p,{...body,profile:{...profile,offer:'Outro corpo'}}),{status:409});
 await assert.rejects(()=>saveProduct(p,{requestId:randomUUID(),id:first.id,expectedRevision:1,action:'approve'}),{status:409});
 const b=await createPlanningFixture();await assert.rejects(()=>saveProduct(b.p,{requestId:randomUUID(),id:first.id,expectedRevision:3,action:'approve'}),{status:404});assert.equal((await readContextState(b.p)).products.length,0);
 const archived=await saveProduct(p,{requestId:randomUUID(),id:first.id,expectedRevision:3,action:'archive'});assert.equal(archived.archived,true);assert.equal(archived.approved?.version,2);
 assert.equal((await readContextState(p)).products[0].draft.offer,'Em revisão');
 assert.equal(await testAdmin(async c=>(await c.query('SELECT count(*) FROM app.product_profile_version WHERE workspace_id=$1 AND product_id=$2',[p.workspaceId,first.id])).rows[0].count),'4');
});
test('operator cannot manage products and arbitrary AI source references cannot assert provenance',async()=>{
 const {p}=await createPlanningFixture();
 await assert.rejects(()=>saveProduct(p,{requestId:randomUUID(),expectedRevision:0,action:'save-draft',profile,sourceJobId:'foreign-job'}),{status:409});
 await testAdmin(c=>c.query('UPDATE auth.member SET role=\'operator\' WHERE "organizationId"=$1 AND "userId"=$2',[p.workspaceId,p.userId]));
 await assert.rejects(()=>saveProduct(p,{requestId:randomUUID(),expectedRevision:0,action:'save-draft',profile}),{status:403});
});
test('context HTTP binds the active workspace and product writes require the trusted origin',async()=>{
 const {p,headers}=await createPlanningFixture();
 const get=await contextRequest(new Request('http://127.0.0.1:3210/api/context',{headers}),'get');assert.equal(get.status,200);assert.deepEqual((await get.json()).products,[]);assert.equal(get.headers.get('cache-control'),'no-store');
 const wrong=new Headers(headers);wrong.set('x-cadence-workspace','foreign');assert.equal((await contextRequest(new Request('http://127.0.0.1:3210/api/context',{headers:wrong}),'get')).status,409);
 wrong.set('origin','https://foreign.example');assert.equal((await contextRequest(new Request('http://127.0.0.1:3210/api/context/products',{method:'POST',headers:wrong,body:'{}'}),'save-product')).status,403);
});
