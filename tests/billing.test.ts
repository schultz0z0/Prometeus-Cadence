import test from 'node:test';
import assert from 'node:assert/strict';
import {getPlan,getSku,trialEnd,billingCatalog,monthlyWindow} from '../src/domain/billing.ts';
import {billingConfig} from '../src/server/billing/config.ts';

test('billing catalog preserves monthly prices and distinct commercial units',()=>{
 assert.equal(getPlan('essential').amount,39700);assert.equal(getPlan('pro').amount,89700);
 assert.deepEqual([getPlan('essential').allowances.extractions,getPlan('pro').allowances.extractions],[5000,8000]);
 assert.deepEqual([getPlan('essential').allowances.imports,getPlan('pro').allowances.imports],[5000,15000]);
 assert.deepEqual([getPlan('essential').capacity.seats,getPlan('pro').capacity.seats],[2,3]);
 assert.equal(getSku('extractions-2000').amount,9700);assert.equal(getSku('imports-5000').quantity,5000);
 assert.equal(getSku('enrichment-50').available,false);assert.throws(()=>getSku('seat-lifetime'));
 assert.equal(billingCatalog().plans.every(p=>p.cycle==='month'),true);
});
test('trial lasts exactly seven days and rejects invalid clocks',()=>{
 assert.equal(trialEnd('2026-10-24T03:00:00Z'),'2026-10-31T03:00:00.000Z');
 assert.throws(()=>trialEnd('invalid'));
});
test('monthly quota windows clamp without drifting from the original anniversary',()=>{
 assert.deepEqual(monthlyWindow('2024-01-31T15:00:00Z','2024-02-29T16:00:00Z'),{start:'2024-02-29T15:00:00.000Z',end:'2024-03-31T15:00:00.000Z'});
 assert.deepEqual(monthlyWindow('2024-01-31T15:00:00Z','2024-03-01T00:00:00Z'),{start:'2024-02-29T15:00:00.000Z',end:'2024-03-31T15:00:00.000Z'});
});
test('sandbox configuration rejects live keys and arbitrary return origins',()=>{
 assert.equal(billingConfig({}).configured,false);
 assert.throws(()=>billingConfig({STRIPE_SECRET_KEY:'sk_live_forbidden'}));
 const c=billingConfig({STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',BETTER_AUTH_URL:'http://127.0.0.1:3210'});
 assert.equal(c.configured,true);assert.equal(c.apiVersion,'2026-09-30.endive');assert.equal(c.origin,'http://127.0.0.1:3210');
 assert.throws(()=>billingConfig({STRIPE_SECRET_KEY:'sk_test_fixture',BETTER_AUTH_URL:'javascript:alert(1)'}));
});
