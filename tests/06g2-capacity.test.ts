import test from 'node:test';import assert from 'node:assert/strict';
import {capacityOffer,capacityFromCode,capacityFromPrice,capacityReductionAllowed,parseSubscriptionItems,skuTitle} from '../src/domain/billing.ts';
const price=(amount:number,interval='month',count=1)=>({id:'price_'+amount,unit_amount:amount,currency:'brl',recurring:{interval,interval_count:count}});
const item=(amount:number,quantity=1,interval='month')=>({id:'si_'+amount,quantity,price:price(amount,interval)});

test('06G.2 add-on offers follow the catalog; a year costs twelve months without the plan discount',()=>{
 assert.deepEqual([capacityOffer('mailboxes','month').amount,capacityOffer('whatsapp','month').amount,capacityOffer('seats','month').amount],[1900,4900,5900]);
 assert.equal(capacityOffer('seats','year').amount,70800);assert.equal(capacityOffer('seats','year').code,'capacity-seats-annual');
 assert.equal(capacityFromCode('capacity-whatsapp-annual')?.unit,'whatsapp');
 for(const bad of ['capacity-linkedin','capacity-','essential','extractions-2000'])assert.equal(capacityFromCode(bad),null,bad);
 assert.equal(capacityFromPrice(4900,'month')?.unit,'whatsapp');assert.equal(capacityFromPrice(58800,'year')?.unit,'whatsapp');
 assert.equal(capacityFromPrice(4900,'year'),null);assert.equal(capacityFromPrice(14900,'month'),null,'LinkedIn is not sold');
 assert.equal(skuTitle('capacity-mailboxes'),'Contas de E-mail');assert.equal(skuTitle('capacity-seats-annual'),'Usuários Extras anual');
});

test('06G.2 a subscription is one plan item plus at most one item per add-on, all in one interval',()=>{
 const ok=parseSubscriptionItems([item(39700),item(4900,2)])!;assert.equal(ok.plan,'essential');assert.equal(ok.item.id,'si_39700');assert.equal(ok.capacity.whatsapp?.quantity,2);assert.equal(ok.total,39700+9800);
 assert.equal(parseSubscriptionItems([item(4900,2),item(89700)])?.plan,'pro','order does not matter');
 assert.equal(parseSubscriptionItems([item(381120,1,'year'),item(22800,1,'year')])?.capacity.mailboxes?.quantity,1);
 for(const bad of [[],[item(4900)],[item(39700),item(89700)],[item(39700),item(4900),item(4900)],[item(39700,2)],[item(39700),item(4900,0)],[item(39700),item(4900,51)],[item(39700),item(100)],[item(39700),item(58800,1,'year')]])
  assert.equal(parseSubscriptionItems(bad),null,JSON.stringify(bad.map(i=>[i.price.unit_amount,i.quantity])));
 assert.equal(parseSubscriptionItems([{...item(39700),price:{...price(39700),currency:'usd'}}]),null);
 assert.equal(parseSubscriptionItems([{...item(39700),price:price(39700,'month',3)}]),null);
});

test('06G.2 capacity in use cannot be reduced away',()=>{
 assert.equal(capacityReductionAllowed({inUse:3,requested:2}),false);
 assert.equal(capacityReductionAllowed({inUse:2,requested:2}),true);assert.equal(capacityReductionAllowed({inUse:0,requested:0}),true);
});
