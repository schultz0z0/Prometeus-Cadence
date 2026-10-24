import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyStripeEvent} from '../src/server/billing/signature.ts';
import {createStripeAdapter} from '../src/server/billing/stripe.ts';
import {billingConfig} from '../src/server/billing/config.ts';
const secret='whsec_fixture',now=1792800000;
const bytes=Buffer.from(JSON.stringify({id:'evt_fixture',type:'checkout.session.completed',created:now,livemode:false,data:{object:{id:'cs_test_fixture',customer:'cus_fixture'}}}));
const signature=(b:Uint8Array=bytes,time=now)=>'t='+time+',v1='+createHmac('sha256',secret).update(time+'.').update(b).digest('hex');
test('Stripe signature authenticates exact bytes and accepts any matching v1 digest',()=>{
 assert.equal(verifyStripeEvent(bytes,signature()+',v1='+'0'.repeat(64),secret,now).id,'evt_fixture');
 assert.throws(()=>verifyStripeEvent(Buffer.concat([bytes,Buffer.from(' ')]),signature(),secret,now));
 assert.throws(()=>verifyStripeEvent(bytes,signature(),secret,now+301));
 assert.throws(()=>verifyStripeEvent(bytes,'t='+now+',v1=abc',secret,now));
 const live=Buffer.from(bytes.toString().replace('"livemode":false','"livemode":true'));
 assert.throws(()=>verifyStripeEvent(live,signature(live),secret,now));
});
test('Stripe transport pins host version idempotency and server-computed Checkout totals',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];
 const adapter=createStripeAdapter(async(input,init)=>{calls.push({url:String(input),init:init!});return Response.json({id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',livemode:false});},billingConfig({STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:secret,BETTER_AUTH_URL:'http://127.0.0.1:3210'}));
 await adapter.createCheckout({customer:'cus_fixture',sku:'essential',workspaceId:'workspace-fixture',operationId:'operation-fixture'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'https://api.stripe.com/v1/checkout/sessions');
 const h=new Headers(calls[0].init.headers);assert.equal(h.get('Stripe-Version'),'2026-09-30.endive');assert.equal(h.get('Idempotency-Key'),'billing:operation-fixture:checkout');
 const p=new URLSearchParams(String(calls[0].init.body));assert.equal(p.get('line_items[0][price_data][unit_amount]'),'39700');assert.equal(p.get('mode'),'subscription');assert.equal(p.has('subscription_data[trial_period_days]'),false);
 assert.equal(p.get('success_url'),'http://127.0.0.1:3210/settings/plan?billing=return');
});
test('network uncertainty never silently retries a financial POST',async()=>{
 let calls=0;const adapter=createStripeAdapter(async()=>{calls++;throw Error('lost response');},billingConfig({STRIPE_SECRET_KEY:'sk_test_fixture'}));
 await assert.rejects(adapter.createCheckout({customer:'cus_fixture',sku:'imports-5000',workspaceId:'w',operationId:'op'}),/incerto/i);assert.equal(calls,1);
});
test('downgrade refuses a foreign schedule and recovers only this operation owned phases',async()=>{
 let posts=0;const sub={id:'sub_fixture',schedule:'sub_sched_existing',items:{data:[{price:{id:'price_pro'},quantity:1,current_period_start:100,current_period_end:200}]}},schedule:any={id:'sub_sched_existing',subscription:'sub_fixture',status:'active',end_behavior:'release',metadata:{cadence_operation:'someone-else'},current_phase:{start_date:100,end_date:200},phases:[{start_date:100,end_date:200,items:[{price:'price_pro',quantity:1}]}]};
 const adapter=createStripeAdapter(async(_input,init)=>{if(init?.method==='POST')posts++;return Response.json(schedule);},billingConfig({STRIPE_SECRET_KEY:'sk_test_fixture'}));
 await assert.rejects(adapter.downgrade(sub,'price_essential','op_fixture'));assert.equal(posts,0);
 schedule.metadata.cadence_operation='op_fixture';await adapter.downgrade(sub,'price_essential','op_fixture');assert.equal(posts,1);
 schedule.phases.push({start_date:200,end_date:300,items:[{price:'price_foreign',quantity:1}]});await assert.rejects(adapter.downgrade(sub,'price_essential','op_fixture'));assert.equal(posts,1);
});
