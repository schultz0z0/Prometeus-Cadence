import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {billingUser,testAdmin,beginTrial} from './billing-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
import {createStripeAdapter} from '../../src/server/billing/stripe.ts';
import {billingConfig} from '../../src/server/billing/config.ts';
import {receiveBillingEvent,processBillingEvent} from '../../src/server/billing/events.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {BILLING_VERSION} from '../../src/domain/billing.ts';
import {prepareBilling,confirmBilling} from '../../src/server/billing/operations.ts';
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'});
after(async()=>{await closeBillingPool();await getPools().close();});
function event(type:string,obj:any,id='evt_'+randomUUID().replaceAll('-','')){const bytes=Buffer.from(JSON.stringify({id,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object:obj}})),t=Math.floor(Date.now()/1000);return {bytes,header:`t=${t},v1=`+createHmac('sha256','whsec_fixture').update(t+'.').update(bytes).digest('hex'),id};}
async function fixture(){
 const u=await billingUser(),customer='cus_'+randomUUID().replaceAll('-',''),subid='sub_'+randomUUID().replaceAll('-',''),now=Math.floor(Date.now()/1000),pi='pi_'+randomUUID().replaceAll('-','');
 await testAdmin(c=>c.query('UPDATE app.billing_account SET customer_id=$2 WHERE workspace_id=$1',[u.p.workspaceId,customer]));
 const price={id:'price_essential',unit_amount:39700,currency:'brl',recurring:{interval:'month',interval_count:1}};
 const invoice:any={id:'in_fixture',customer,currency:'brl',status:'paid',amount_paid:39700,amount_due:39700,amount_remaining:0,billing_reason:'subscription_create',created:now,parent:{subscription_details:{subscription:subid}},lines:{data:[{amount:39700,quantity:1,pricing:{price_details:{price:'price_essential'}},period:{start:now,end:now+2592000}}],has_more:false},payments:{data:[{status:'paid',payment:{type:'payment_intent',payment_intent:pi}}],has_more:false},hosted_invoice_url:'https://invoice.stripe.com/i/fixture'};
 const sub:any={id:subid,customer,status:'active',metadata:{workspace_id:u.p.workspaceId,catalog_version:BILLING_VERSION},items:{data:[{id:'si_fixture',quantity:1,price,current_period_start:now,current_period_end:now+2592000}],has_more:false},latest_invoice:invoice.id,cancel_at_period_end:false};
 let refunded=false;const sessions=new Map<string,any>();
 const mutations:{path:string;form:URLSearchParams}[]=[];
 const adapter=createStripeAdapter(async (input,init)=>{const path=new URL(String(input)).pathname,form=new URLSearchParams(String(init?.body));
  if(init?.method==='POST'){
   mutations.push({path,form});
   if(path.endsWith('/create_preview'))return Response.json({id:'upcoming_fixture',currency:'brl',amount_due:25000});
   if(path.endsWith('/'+subid)){sub.pending_update={expires_at:now+3600};return Response.json(sub);}
   if(path.endsWith('/subscription_schedules'))return Response.json({id:'sub_sched_fixture'});
   if(path.endsWith('/sub_sched_fixture'))return Response.json({id:'sub_sched_fixture'});
   throw Error('Unexpected POST '+path);
  }
  if(path.endsWith('/prices'))return Response.json({data:[{id:'price_target',unit_amount:new URL(String(input)).searchParams.get('lookup_keys[0]')?.endsWith('pro')?89700:39700,currency:'brl',recurring:{interval:'month',interval_count:1}}]});
  if(path.endsWith('/'+subid))return Response.json(sub);
  if(path.endsWith('/'+invoice.id))return Response.json(invoice);
  if(path.includes('/checkout/sessions/'))return Response.json(sessions.get(path.split('/').at(-1)!));
  if(path.includes('/payment_intents/'))return Response.json({id:path.split('/').at(-1),status:'succeeded',currency:'brl',latest_charge:{id:'ch_fixture',refunded,amount_refunded:refunded?39700:0,disputed:false}});
  if(path.includes('/charges/'))return Response.json({id:'ch_fixture',customer,payment_intent:pi,refunded:true,amount_refunded:39700,disputed:false});
  if(path.includes('/disputes/'))return Response.json({id:'dp_fixture',charge:'ch_fixture'});
  throw Error('Unexpected GET '+path);
 },billingConfig());
 return {u,customer,subid,pi,sub,invoice,adapter,sessions,mutations,setRefund:()=>{refunded=true;}};
}
async function deliver(f:Awaited<ReturnType<typeof fixture>>,type:string,obj:any){const e=event(type,obj);await receiveBillingEvent(e.bytes,e.header);await processBillingEvent(e.id,f.adapter);return e;}
test('unpaid invoice and forged webhook cannot grant access; paid renewal grants once despite replay/out-of-order',async()=>{
 const f=await fixture();f.invoice.status='open';f.invoice.amount_paid=0;f.invoice.amount_remaining=39700;
 await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});assert.notEqual((await readBilling(f.u.p)).status,'active');
 const bad=event('invoice.paid',{id:f.invoice.id,customer:f.customer});await assert.rejects(receiveBillingEvent(bad.bytes,bad.header+'x'));
 f.invoice.status='paid';f.invoice.amount_paid=39700;f.invoice.amount_remaining=0;
 const paid=await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});await receiveBillingEvent(paid.bytes,paid.header);await processBillingEvent(paid.id,f.adapter);
 await deliver(f,'customer.subscription.updated',{id:f.subid,customer:f.customer});
 const v=await readBilling(f.u.p);assert.equal(v.status,'active');assert.equal(v.balances.find(x=>x.unit==='extractions')?.plan,5000);
 const grants=await testAdmin(c=>c.query("SELECT count(*)::int AS n FROM app.billing_grant WHERE workspace_id=$1 AND source='plan' AND unit='extractions'",[f.u.p.workspaceId]));assert.equal(grants.rows[0].n,1);
 f.sub.cancel_at_period_end=true;await deliver(f,'customer.subscription.updated',{id:f.subid,customer:f.customer});assert.equal((await readBilling(f.u.p)).cancelAtPeriodEnd,true);assert.equal((await readBilling(f.u.p)).status,'active');
});
test('prepaid checkout requires a verified paid session and grants only once',async()=>{
 const f=await fixture();await beginTrial(f.u.p);const op=randomUUID(),session='cs_test_fixture';
 await testAdmin(c=>c.query("INSERT INTO app.billing_operation(workspace_id,id,request_id,actor_id,body_hash,kind,sku,expected_revision,state,customer_id,remote_id) VALUES($1,$2,$2,$3,'hash','checkout','imports-5000',0,'awaiting_payment',$4,$5)",[f.u.p.workspaceId,op,f.u.p.userId,f.customer,session]));
 const value:any={id:session,customer:f.customer,mode:'payment',status:'complete',payment_status:'unpaid',currency:'brl',amount_total:2700,payment_intent:f.pi,metadata:{workspace_id:f.u.p.workspaceId,operation_id:op,sku:'imports-5000',catalog_version:BILLING_VERSION},line_items:{data:[{quantity:1,amount_total:2700}],has_more:false}};f.sessions.set(session,value);
 await deliver(f,'checkout.session.completed',{id:session,customer:f.customer});assert.equal((await readBilling(f.u.p)).balances.find(x=>x.unit==='imports')?.purchased,0);
 value.payment_status='paid';await deliver(f,'checkout.session.async_payment_succeeded',{id:session,customer:f.customer});await deliver(f,'checkout.session.completed',{id:session,customer:f.customer});
 assert.equal((await readBilling(f.u.p)).balances.find(x=>x.unit==='imports')?.purchased,5000);
 assert.equal((await readBilling(f.u.p)).operations[0].state,'completed');
});
test('refund freezes unused grants and cannot be undone by replaying a paid invoice',async()=>{
 const f=await fixture();await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});f.setRefund();
 await deliver(f,'charge.refunded',{id:'ch_fixture',customer:f.customer});await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});
 const view=await readBilling(f.u.p);assert.equal(view.status,'attention');assert.equal(view.balances.find(x=>x.unit==='extractions')?.plan,0);
});
test('fresh remote state prevents old subscription event from restoring canceled access',async()=>{
 const f=await fixture();await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});f.sub.status='canceled';
 await deliver(f,'customer.subscription.updated',{id:f.subid,customer:f.customer,status:'active'});assert.equal((await readBilling(f.u.p)).status,'canceled');
});
test('dispute without a customer field resolves authenticated charge ownership before freezing credits',async()=>{
 const f=await fixture();await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});
 await deliver(f,'charge.dispute.created',{id:'dp_fixture'});assert.equal((await readBilling(f.u.p)).status,'attention');
});
test('upgrade uses the reviewed proration and waits for payment; downgrade schedules next period',async()=>{
 const f=await fixture();await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});
 const review=await prepareBilling(f.u.p,{kind:'upgrade',sku:'pro'},{adapter:f.adapter});assert.equal(review.amount,25000);
 const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review},{adapter:f.adapter});assert.equal(op.state,'awaiting_payment');
 const call=f.mutations.find(x=>x.path.endsWith('/'+f.subid))!;assert.equal(call.form.get('payment_behavior'),'pending_if_incomplete');assert.equal(call.form.get('proration_behavior'),'always_invoice');assert.equal(call.form.get('proration_date'),String(review.prorationDate));assert.equal((await readBilling(f.u.p)).plan,'essential');
 const g=await fixture();g.sub.items.data[0].price.unit_amount=89700;g.sub.items.data[0].price.id='price_pro';g.invoice.amount_paid=g.invoice.amount_due=89700;g.invoice.lines.data[0].amount=89700;g.invoice.lines.data[0].pricing.price_details.price='price_pro';
 await deliver(g,'invoice.paid',{id:g.invoice.id,customer:g.customer});const down=await prepareBilling(g.u.p,{kind:'downgrade',sku:'essential'},{adapter:g.adapter});
 await confirmBilling(g.u.p,{requestId:randomUUID(),review:down},{adapter:g.adapter});assert.equal((await readBilling(g.u.p)).plan,'pro');assert.equal((await readBilling(g.u.p)).nextPlan,'essential');const schedule=g.mutations.find(x=>x.path.endsWith('/sub_sched_fixture'))!;assert.equal(schedule.form.get('phases[0][end_date]'),String(g.sub.items.data[0].current_period_end));assert.equal(schedule.form.get('phases[1][items][0][price]'),'price_target');
});
test('an existing paid subscription cannot be replaced with a new free trial after payment trouble',async()=>{
 const f=await fixture();await deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});
 await testAdmin(c=>c.query("UPDATE app.billing_account SET state='attention' WHERE workspace_id=$1",[f.u.p.workspaceId]));
 await assert.rejects(beginTrial(f.u.p),{code:'SUBSCRIPTION_ACTIVE'});assert.equal((await readBilling(f.u.p)).trialAvailable,false);
});
