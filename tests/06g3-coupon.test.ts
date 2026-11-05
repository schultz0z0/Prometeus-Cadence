import test from 'node:test';import assert from 'node:assert/strict';
import {couponCode,couponAmount} from '../src/domain/billing.ts';

test('06G.3 a code is normalized, or refused',()=>{
 assert.equal(couponCode(' bem-vindo_10 '),'BEM-VINDO_10');
 for(const bad of ['','ab',' ','a'.repeat(41),'tem espaço','a;drop',"x'y"])assert.equal(couponCode(bad),null,bad);
});

test('06G.3 the discount comes from the provider coupon and never leaves a total below the minimum',()=>{
 const percent=(percent_off:number)=>({valid:true,percent_off,amount_off:null,currency:null});
 assert.equal(couponAmount(9700,percent(10)),8730);assert.equal(couponAmount(2700,percent(33.5)),1795);
 assert.equal(couponAmount(9700,{valid:true,percent_off:null,amount_off:1000,currency:'brl'}),8700);
 assert.equal(couponAmount(9700,percent(100)),null,'free is refused');assert.equal(couponAmount(9700,{valid:true,percent_off:null,amount_off:9660,currency:'brl'}),null,'below R$ 0,50');
 assert.equal(couponAmount(9700,{valid:true,percent_off:null,amount_off:1000,currency:'usd'}),null,'another currency');
 assert.equal(couponAmount(9700,{valid:false,percent_off:10,amount_off:null,currency:null}),null,'invalid at the provider');
 assert.equal(couponAmount(9700,{valid:true,percent_off:null,amount_off:null,currency:null}),null,'no discount');
 assert.equal(couponAmount(9700,percent(-5)),null);assert.equal(couponAmount(9700,{valid:true,percent_off:null,amount_off:-5,currency:'brl'}),null);
});
