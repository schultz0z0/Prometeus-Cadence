import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {billingUser,beginTrial,testAdmin,creditFixture} from './billing-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {getPools} from '../../src/server/db/pool.ts';
after(()=>getPools().close());
test('concurrent reservations cannot spend the same credits twice',async()=>{
 const u=await billingUser();await beginTrial(u.p);
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET quantity=3 WHERE workspace_id=$1 AND unit='imports'",[u.p.workspaceId]));
 const reserve=(key:string)=>withWorkspaceTransaction(u.p,c=>c.query("SELECT app.billing_reserve($1,'imports',2)",[key]));
 const results=await Promise.allSettled([reserve(randomUUID()),reserve(randomUUID())]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((results.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code,'BILLING_QUOTA');
});
test('plan allocation precedes prepaid balance; consume and release are idempotent',async()=>{
 const u=await billingUser();await beginTrial(u.p);
 await testAdmin(c=>c.query("UPDATE app.billing_grant SET quantity=2 WHERE workspace_id=$1 AND unit='imports'",[u.p.workspaceId]));const pack=await creditFixture(u.p.workspaceId,'imports',5);
 const reservation=randomUUID(),receipt=randomUUID();
 await withWorkspaceTransaction(u.p,async c=>{
  await c.query("SELECT app.billing_reserve($1,'imports',4)",[reservation]);
  await c.query("SELECT app.billing_consume($1,'imports',3,$2)",[receipt,reservation]);
  await c.query("SELECT app.billing_consume($1,'imports',3,$2)",[receipt,reservation]);
  await c.query('SELECT app.billing_release($1)',[reservation]);await c.query('SELECT app.billing_release($1)',[reservation]);
  const rows=(await c.query("SELECT id,spent,held FROM app.billing_grant WHERE unit='imports'")).rows;
  assert.equal(Number(rows.find(r=>r.id===pack).spent),1);assert.equal(rows.reduce((n,r)=>n+Number(r.spent),0),3);assert.equal(rows.reduce((n,r)=>n+Number(r.held),0),0);
 });
});
test('expired trial denies new work but a received result consumes its existing reservation',async()=>{
 const u=await billingUser();await beginTrial(u.p);const key=randomUUID();
 await withWorkspaceTransaction(u.p,c=>c.query("SELECT app.billing_reserve($1,'imports',2)",[key]));
 await testAdmin(c=>c.query("UPDATE app.billing_account SET period_end=now()-interval '1 second' WHERE workspace_id=$1",[u.p.workspaceId]));
 await assert.rejects(withWorkspaceTransaction(u.p,c=>c.query("SELECT app.billing_reserve($1,'imports',1)",[randomUUID()])),{code:'BILLING_REQUIRED'});
 await withWorkspaceTransaction(u.p,c=>c.query("SELECT app.billing_consume($1,'imports',1,$2)",[randomUUID(),key]));
});
