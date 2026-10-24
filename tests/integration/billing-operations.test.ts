import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {billingUser,beginTrial,testAdmin} from './billing-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {prepareBilling,confirmBilling,processBillingOperation} from '../../src/server/billing/operations.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {createStripeAdapter} from '../../src/server/billing/stripe.ts';
import {billingConfig} from '../../src/server/billing/config.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
after(async()=>{await closeBillingPool();await getPools().close();});
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'});
function stripeFixture(loseCheckout=false){
 let lost=false,customers=0,checkouts=0;const responses=new Map<string,any>();
 const adapter=createStripeAdapter(async(input,init)=>{
  const url=new URL(String(input)),key=new Headers(init?.headers).get('Idempotency-Key')!,form=new URLSearchParams(String(init?.body));
  if(responses.has(key))return Response.json(responses.get(key));
  const obj=url.pathname.endsWith('/customers')?{id:'cus_'+(++customers)+'_'+randomUUID().replaceAll('-',''),livemode:false}:url.pathname.endsWith('/checkout/sessions')?{id:'cs_test_'+(++checkouts)+'_'+randomUUID().replaceAll('-',''),livemode:false,url:'https://checkout.stripe.com/c/pay/cs_test_fixture',metadata:Object.fromEntries(['workspace_id','operation_id','sku','catalog_version'].map(k=>[k,form.get('metadata['+k+']')])),customer:form.get('customer'),status:'open',payment_status:'unpaid'}:null;
  if(!obj)throw Error('Unexpected fixture endpoint');responses.set(key,obj);if(loseCheckout&&url.pathname.endsWith('/checkout/sessions')&&!lost){lost=true;throw Error('response lost');}return Response.json(obj);
 },billingConfig());return {adapter,counts:()=>({customers,checkouts})};
}
test('reviewed checkout is replay safe and does not grant access before payment',async()=>{
 const u=await billingUser(),f=stripeFixture();const review=await prepareBilling(u.p,{kind:'checkout',sku:'essential'}),requestId=randomUUID();
 const op=await confirmBilling(u.p,{requestId,review},{adapter:f.adapter});assert.equal(op.state,'awaiting_payment');assert.ok(op.url);
 assert.deepEqual(await confirmBilling(u.p,{requestId,review},{adapter:f.adapter}),op);assert.deepEqual(f.counts(),{customers:1,checkouts:1});assert.equal((await readBilling(u.p)).status,'inactive');
 await assert.rejects(confirmBilling(u.p,{requestId,review:{...review,sku:'pro'}},{adapter:f.adapter}));
});
test('concurrent subscription purchases cannot create a second active checkout',async()=>{
 const u=await billingUser(),review=await prepareBilling(u.p,{kind:'checkout',sku:'essential'}),f=stripeFixture();
 const results=await Promise.allSettled([confirmBilling(u.p,{requestId:randomUUID(),review},{adapter:f.adapter}),confirmBilling(u.p,{requestId:randomUUID(),review},{adapter:f.adapter})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(f.counts().checkouts,1);
});
test('accepted checkout with lost response recovers same remote intent on retry',async()=>{
 const u=await billingUser(),f=stripeFixture(true),review=await prepareBilling(u.p,{kind:'checkout',sku:'essential'});
 const op=await confirmBilling(u.p,{requestId:randomUUID(),review},{adapter:f.adapter});assert.equal(op.state,'uncertain');
 await processBillingOperation(op.id,f.adapter);assert.equal((await readBilling(u.p)).operations[0].state,'awaiting_payment');assert.equal(f.counts().checkouts,1);
});
test('uncertain operation older than provider idempotency window never retries POST',async()=>{
 const u=await billingUser(),f=stripeFixture(true),review=await prepareBilling(u.p,{kind:'checkout',sku:'essential'});
 const op=await confirmBilling(u.p,{requestId:randomUUID(),review},{adapter:f.adapter});
 await testAdmin(c=>c.query("UPDATE app.billing_operation SET created_at=now()-interval '25 hours' WHERE id=$1",[op.id]));
 await processBillingOperation(op.id,f.adapter);assert.equal((await readBilling(u.p)).operations[0].state,'uncertain');assert.equal(f.counts().checkouts,1);
});
test('prepaid purchase requires valid subscription and unavailable enrichment cannot be sold',async()=>{
 const u=await billingUser();await assert.rejects(prepareBilling(u.p,{kind:'checkout',sku:'imports-5000'}),/assinatura|teste/i);
 await beginTrial(u.p);await assert.rejects(prepareBilling(u.p,{kind:'checkout',sku:'enrichment-50'}),/disponível/i);
 const review=await prepareBilling(u.p,{kind:'checkout',sku:'imports-5000'});assert.equal(review.amount,2700);assert.match(review.effects.join(' '),/única/i);
});
test('customer creation retries frozen parameters after lost response even if contact was edited',async()=>{
 const u=await billingUser();let created=false,lost=false;const bodies:string[]=[];
 const adapter=createStripeAdapter(async(input,init)=>{
  const path=new URL(String(input)).pathname;
  if(path.endsWith('/customers')){bodies.push(String(init?.body));if(created&&bodies.at(-1)!==bodies[0])return Response.json({error:'idempotency_error'},{status:400});created=true;if(!lost){lost=true;throw Error('response lost');}return Response.json({id:'cus_frozen',livemode:false});}
  if(path.endsWith('/checkout/sessions'))return Response.json({id:'cs_test_frozen',url:'https://checkout.stripe.com/c/pay/cs_test_frozen',livemode:false});
  if(path.endsWith('/cus_frozen'))return Response.json({id:'cus_frozen',livemode:false});throw Error('Unexpected endpoint');
 },billingConfig());
 const review=await prepareBilling(u.p,{kind:'checkout',sku:'essential'}),op=await confirmBilling(u.p,{requestId:randomUUID(),review},{adapter});assert.equal(op.state,'uncertain');
 await testAdmin(c=>c.query("UPDATE app.billing_account SET contact='{\"email\":\"changed@example.com\",\"phone\":null}',revision=revision+1 WHERE workspace_id=$1",[u.p.workspaceId]));
 await processBillingOperation(op.id,adapter);assert.equal((await readBilling(u.p)).operations.find(x=>x.id===op.id)?.state,'awaiting_payment');assert.equal(bodies[0],bodies[1]);
 await processBillingOperation(undefined,adapter);assert.equal((await readBilling(u.p)).operations.some(x=>x.kind==='contact'&&x.state==='completed'),true);
});
