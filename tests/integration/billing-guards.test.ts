import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {billingUser,beginTrial,testAdmin} from './billing-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
import {identityAction} from '../../src/server/workspaces/service.ts';
import {configureProspectingTest,generationInput,grantTestLease} from './prospecting-helpers.ts';
import {prepareJob,confirmJob} from '../../src/server/prospecting/service.ts';
import {withLeasedTransaction} from '../../src/server/prospecting/worker-db.ts';
import {performStep} from '../../src/server/prospecting/journal.ts';
import {ingestPage} from '../../src/server/prospecting/ingestion.ts';
after(async()=>{await closeBillingPool();const {workerPool}=await import('../../src/server/prospecting/worker-db.ts');await workerPool().end();await getPools().close();});
async function addLead(p:any,id:string){return withWorkspaceTransaction(p,async c=>{await c.query("INSERT INTO app.list VALUES($1,'list','Billing') ON CONFLICT DO NOTHING",[p.workspaceId]);await c.query("INSERT INTO app.lead VALUES($1,$2,'list',$3) ON CONFLICT(workspace_id,id) DO UPDATE SET payload=EXCLUDED.payload",[p.workspaceId,id,{id,listId:'list',name:'QA',source:'MANUAL'}]);});}
test('direct SQL lead insertion requires entitlement; concurrent imports consume once and edits do not debit',async()=>{
 const u=await billingUser();await assert.rejects(addLead(u.p,'no-plan'),{code:'BILLING_REQUIRED'});await beginTrial(u.p);
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET quantity=1 WHERE workspace_id=$1 AND unit='imports'",[u.p.workspaceId]));
 const result=await Promise.allSettled([addLead(u.p,'a'),addLead(u.p,'b')]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
 const saved=await withWorkspaceTransaction(u.p,async c=>(await c.query('SELECT id FROM app.lead')).rows[0].id);
 await addLead(u.p,saved);assert.equal((await readBilling(u.p)).balances.find(x=>x.unit==='imports')?.consumed,1);
});
test('channel and pending-seat capacity is serialized in the database, including before trial',async()=>{
 const u=await billingUser();
 const connection=()=>withWorkspaceTransaction(u.p,c=>c.query("INSERT INTO app.channel_connection(workspace_id,id,provider,name,public_id,identifiers,created_by) VALUES($1,$2,'meta','QA',$2,'{}',$3)",[u.p.workspaceId,randomUUID(),u.p.userId]));
 const results=await Promise.allSettled([connection(),connection(),connection()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,2);assert.equal((results.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code,'BILLING_CAPACITY');
 await identityAction(u.headers,{type:'invite',email:'first@cadence.example',role:'operator'});
 await assert.rejects(identityAction(u.headers,{type:'invite',email:'second@cadence.example',role:'operator'}),/capacidade|BILLING_CAPACITY/i);
});
test('generation reserves commercial quota, expired subscription denies the next provider call but keeps its hold',async()=>{
 configureProspectingTest();const u=await billingUser();await beginTrial(u.p);
 const input=generationInput(),review=await prepareJob(u.p,input),job=await confirmJob(u.p,{requestId:randomUUID(),input,reviewToken:review.token});
 assert.equal((await readBilling(u.p)).balances.find(x=>x.unit==='extractions')?.reserved,5);
 const lease=await grantTestLease(u.p,job.id);await testAdmin(c=>c.query("UPDATE app.billing_account SET period_end=now()-interval '1 second' WHERE workspace_id=$1",[u.p.workspaceId]));let calls=0;
 await assert.rejects(performStep(lease,'new-expense','apify',{apifyRuns:1},async()=>{calls++;return {};}),/teste|assinatura|BILLING_REQUIRED/i);assert.equal(calls,0);
 const hold=await withLeasedTransaction(lease,async c=>(await c.query("SELECT sum(held)::int AS n FROM app.billing_allocation WHERE key=$1",['job:'+job.id])).rows[0].n);assert.equal(hold,5);
 const receipt=randomUUID();await withLeasedTransaction(lease,c=>ingestPage(c,lease,{receiptId:receipt,candidates:[{sourceRef:'late-result',name:'Already received',phone:'5511998877665'}],rejected:[],rawCount:1,nextCursor:null,exhausted:true,usage:{provider:'apify',operationId:receipt,units:{candidates:1},costUsd:null,costKind:'unknown'}}));
 assert.equal((await readBilling(u.p)).balances.find(x=>x.unit==='extractions')?.consumed,1);
});
test('activating another cadence above capacity fails without truncating stored drafts',async()=>{
 const u=await billingUser();await beginTrial(u.p);
 await testAdmin(async c=>{await c.query("INSERT INTO app.list VALUES($1,'capacity','Capacity')",[u.p.workspaceId]);await c.query("INSERT INTO app.cadence(workspace_id,id,list_id,payload) SELECT $1,'active-'||n,'capacity',jsonb_build_object('id','active-'||n,'listId','capacity','status','active') FROM generate_series(1,100) n",[u.p.workspaceId]);});
 await assert.rejects(withWorkspaceTransaction(u.p,c=>c.query("INSERT INTO app.cadence VALUES($1,'over','capacity','{\"id\":\"over\",\"listId\":\"capacity\",\"status\":\"active\"}')",[u.p.workspaceId])),{code:'BILLING_CAPACITY'});
 assert.equal((await readBilling(u.p)).usage.cadences,100);
});
