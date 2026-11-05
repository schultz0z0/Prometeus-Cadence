import test from 'node:test';import assert from 'node:assert/strict';
import {getSku,getPlan,planFromPrice,planChange,billingCatalog} from '../src/domain/billing.ts';

test('06G.1 annual SKUs: 20% off, same allowances, the monthly offers unchanged',()=>{
 const e=getSku('essential-annual'),p=getSku('pro-annual');
 assert.ok('cycle' in e&&'cycle' in p);
 assert.equal(e.amount,381120);assert.equal(p.amount,861120);assert.equal(e.cycle,'year');assert.equal(e.planCode,'essential');
 assert.deepEqual(e.allowances,getPlan('essential').allowances,'the franchise is per month in both cycles');
 assert.equal(getPlan('essential').amount,39700);assert.equal(getPlan('pro').cycle,'month');
 assert.deepEqual(billingCatalog().annualPlans.map(x=>x.code),['essential-annual','pro-annual']);
 assert.throws(()=>getPlan('pro-annual'),/Plano inválido/,'getPlan stays the monthly base offer');
});
test('06G.1 a Stripe price maps to a plan only with the exact amount and interval',()=>{
 assert.deepEqual(planFromPrice(381120,'year'),{plan:'essential',interval:'year',sku:'essential-annual'});
 assert.deepEqual(planFromPrice(89700,'month'),{plan:'pro',interval:'month',sku:'pro'});
 assert.equal(planFromPrice(39700,'year'),null);assert.equal(planFromPrice(381120,'month'),null);assert.equal(planFromPrice(100,'month'),null);
});
test('06G.1 changes: upgrade now, downgrade or cycle change at renewal, never both at once',()=>{
 assert.equal(planChange('essential','month','pro'),'upgrade');assert.equal(planChange('essential','year','pro-annual'),'upgrade');
 assert.equal(planChange('pro','month','essential'),'downgrade');assert.equal(planChange('pro','year','essential-annual'),'downgrade');
 assert.equal(planChange('pro','month','pro-annual'),'downgrade','cycle change waits for the renewal');assert.equal(planChange('pro','year','pro'),'downgrade');
 assert.equal(planChange('essential','month','pro-annual'),null);assert.equal(planChange('pro','year','essential'),null);
 assert.equal(planChange('pro','month','pro'),null,'same plan and cycle');assert.equal(planChange('pro','month','extractions-2000'),null);
});
