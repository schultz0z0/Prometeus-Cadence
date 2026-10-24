import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {billingUser,beginTrial,testAdmin} from './billing-helpers.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {readBilling,startTrial} from '../../src/server/billing/repository.ts';
after(()=>getPools().close());
test('new workspaces have no subscription; owner trial is exactly seven days and cannot restart',async()=>{
 const u=await billingUser();
 const exists=await testAdmin(async c=>(await c.query("SELECT to_regclass('app.billing_account') AS table_name")).rows[0].table_name);assert.ok(exists,'billing storage must exist');
 const initial=await withWorkspaceTransaction(u.p,async c=>(await c.query('SELECT state FROM app.billing_account')).rows[0]);assert.equal(initial.state,'inactive');
 const key=randomUUID(),trial=await beginTrial(u.p,key);assert.equal(trial.state,'trial');
 assert.equal(Date.parse(trial.period_end)-Date.parse(trial.period_start),7*86400000);
 assert.deepEqual(await beginTrial(u.p,key),trial);await assert.rejects(beginTrial(u.p),{code:'TRIAL_ALREADY_USED'});
});
test('billing rows are tenant isolated and app SQL cannot mint credit or rewrite account status',async()=>{
 const a=await billingUser(),b=await billingUser();await beginTrial(a.p);
 await withWorkspaceTransaction(b.p,async c=>{
  assert.equal((await c.query('SELECT * FROM app.billing_account WHERE workspace_id=$1',[a.p.workspaceId])).rowCount,0);
  assert.equal((await c.query("SELECT has_table_privilege(current_user,'app.billing_grant','INSERT') AS allowed")).rows[0].allowed,false);
  assert.equal((await c.query("SELECT has_table_privilege(current_user,'app.billing_account','UPDATE') AS allowed")).rows[0].allowed,false);
 });
});
test('operator cannot start trial even with a stale owner principal',async()=>{
 const u=await billingUser();await testAdmin(c=>c.query('UPDATE auth.member SET role=$1 WHERE "organizationId"=$2 AND "userId"=$3',['operator',u.p.workspaceId,u.p.userId]));
 await assert.rejects(beginTrial(u.p),/FORBIDDEN/);
});
test('billing view reports actual remaining credit and never exposes Stripe credentials',async()=>{
 const u=await billingUser();await startTrial(u.p,randomUUID());const view=await readBilling(u.p);
 assert.equal(view.status,'trial');assert.equal(view.canManage,true);assert.equal(view.balances.find(b=>b.unit==='imports')?.plan,5000);
 assert.equal(JSON.stringify(view).includes('sk_test_'),false);assert.equal(view.capacity?.seats,2);assert.equal(view.usage.seats,1);
});
