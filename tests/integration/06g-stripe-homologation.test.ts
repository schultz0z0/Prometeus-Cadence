// Real calls to Stripe's test mode, off by default. Each customer lives on its own test clock and is deleted at the end.
//   STRIPE_HOMOLOGATION=1 HOMOLOGATION_OUT=<file> node scripts/test-integration.mjs 06g-stripe-homologation
// With HOMOLOGATION_PAY_FILE=<file>, the coupon session URL is written there and the test waits for it to be paid by hand.
import test,{after} from 'node:test';import assert from 'node:assert/strict';import {createHmac,randomUUID} from 'node:crypto';import {writeFileSync} from 'node:fs';
import {billingUser,testAdmin,beginTrial} from './billing-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
import {createStripeAdapter} from '../../src/server/billing/stripe.ts';
import {billingConfig} from '../../src/server/billing/config.ts';
import {receiveBillingEvent,processBillingEvent} from '../../src/server/billing/events.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {BILLING_VERSION,couponAmount,getPlan} from '../../src/domain/billing.ts';
import {prepareBilling,confirmBilling} from '../../src/server/billing/operations.ts';
import {saveCoupon} from '../../scripts/billing-coupon.mjs';
const enabled=process.env.STRIPE_HOMOLOGATION==='1',skip=enabled?false:'STRIPE_HOMOLOGATION=1 is required: real Stripe test-mode calls';
const only=process.env.HOMOLOGATION_ONLY,scenario=(name:string)=>({skip:skip||(only&&!name.includes(only)?'other scenario':false)});
const DAY=86400,seen:Record<string,unknown>={};const clocks:string[]=[],customers:string[]=[],coupons:string[]=[];
const key=()=>{const k=billingConfig().key;if(!k.startsWith('sk_test_'))throw Error('Test key only.');return k;};
async function api(method:'GET'|'POST'|'DELETE',path:string,params:Record<string,string>={}){
 const body=new URLSearchParams(params),url='https://api.stripe.com/v1'+path+(method==='GET'&&body.size?'?'+body:'');
 const r=await fetch(url,{method,headers:{authorization:'Bearer '+key(),'Stripe-Version':billingConfig().apiVersion,...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{})},...(method==='POST'?{body:body.toString()}:{})});
 const j:any=await r.json();if(!r.ok)throw Error(method+' '+path+' '+r.status+' '+JSON.stringify(j.error?.message??j).slice(0,300));if(j.livemode===true)throw Error('Live object.');return j;
}
after(async()=>{
 if(enabled){for(const id of clocks)await api('DELETE','/test_helpers/test_clocks/'+id).catch(e=>console.error('cleanup',e.message));for(const id of customers)await api('DELETE','/customers/'+id).catch(e=>console.error('cleanup',e.message));for(const id of coupons)await api('DELETE','/coupons/'+id).catch(e=>console.error('cleanup',e.message));}
 if(process.env.HOMOLOGATION_OUT)writeFileSync(process.env.HOMOLOGATION_OUT,JSON.stringify(seen,null,1));
 await closeBillingPool();await getPools().close();
});
async function deliver(customer:string,type:string,object:string,expected='done'){
 const id='evt_'+randomUUID().replaceAll('-',''),bytes=Buffer.from(JSON.stringify({id,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object:{id:object,customer}}})),t=Math.floor(Date.now()/1000);
 await receiveBillingEvent(bytes,`t=${t},v1=`+createHmac('sha256',billingConfig().webhookSecret).update(t+'.').update(bytes).digest('hex'));await processBillingEvent(id);
 const row=(await testAdmin(c=>c.query('SELECT state,error_code FROM app.billing_event_inbox WHERE id=$1',[id]))).rows[0];assert.equal(row.state,expected,type+' '+row.error_code);
}
/** A workspace with a clocked customer, a default test card, and a subscription created as the app's checkout would. */
async function fixture(sku:string){
 const u=await billingUser(),now=Math.floor(Date.now()/1000),clock=(await api('POST','/test_helpers/test_clocks',{frozen_time:String(now),name:'[RE] 06G'})).id;clocks.push(clock);
 const customer=(await api('POST','/customers',{test_clock:clock,email:'re-homolog-06g@example.com',name:'[RE] Homologacao 06G','metadata[workspace_id]':u.p.workspaceId})).id;
 const pm=(await api('POST','/payment_methods/pm_card_visa/attach',{customer})).id;await api('POST','/customers/'+customer,{'invoice_settings[default_payment_method]':pm});
 await testAdmin(c=>c.query('UPDATE app.billing_account SET customer_id=$2 WHERE workspace_id=$1',[u.p.workspaceId,customer]));
 const adapter=createStripeAdapter(),price=await adapter.ensurePrice(sku);
 const sub=await api('POST','/subscriptions',{customer,'items[0][price]':price,'metadata[workspace_id]':u.p.workspaceId,'metadata[catalog_version]':BILLING_VERSION,'metadata[plan]':sku.replace('-annual','')});
 const f={u,customer,clock,sub:sub.id as string,
  read:()=>api('GET','/subscriptions/'+sub.id,{'expand[0]':'latest_invoice'}),
  latest:async()=>{const s=await api('GET','/subscriptions/'+sub.id,{'expand[0]':'latest_invoice'});return s.latest_invoice;},
  paid:async(expected='done')=>{const s=await api('GET','/subscriptions/'+sub.id);await deliver(customer,'invoice.paid',s.latest_invoice,expected);},
  updated:(expected='done')=>deliver(customer,'customer.subscription.updated',sub.id,expected),
  view:()=>readBilling(u.p),
  // Stripe limits one advance to about two of the shortest interval in play.
  advance:async(to:number)=>{for(;;){const at=(await api('GET','/test_helpers/test_clocks/'+clock)).frozen_time,next=Math.min(to,at+55*DAY);await api('POST',`/test_helpers/test_clocks/${clock}/advance`,{frozen_time:String(next)});let ready=false;for(let i=0;i<60&&!ready;i++){const c=await api('GET','/test_helpers/test_clocks/'+clock);if(c.status==='ready')ready=true;else if(c.status!=='advancing')throw Error('clock '+c.status);else await new Promise(r=>setTimeout(r,2000));}if(!ready)throw Error('clock timeout');if(next===to)return;}}};
 await f.paid();return f;
}
const lineShape=(inv:any)=>inv.lines.data.map((l:any)=>({amount:l.amount,quantity:l.quantity,hasPrice:!!l.pricing?.price_details?.price,proration:l.parent?.subscription_item_details?.proration??null}));
const buy=async(f:any,unit:string,quantity:number)=>{
 const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-'+unit,quantity});const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r});return {r,op};
};

test('homologation: annual subscription, add-ons, upgrade, reduction and renewal',scenario('annual'),async()=>{
 const f=await fixture('essential-annual');let v=await f.view();
 assert.equal(v.status,'active');assert.equal(v.interval,'year');assert.equal(v.balances.find(b=>b.unit==='extractions')?.plan,5000,'one window, not twelve');
 seen.annualCreate={reason:(await f.latest()).billing_reason,amount:(await f.latest()).amount_due};
 // A new item with pending_if_incomplete.
 const first=await buy(f,'whatsapp',1);seen.addNewItem={reviewAmount:first.r.amount,state:first.op.state,sku:first.r.sku};assert.equal(first.op.state,'awaiting_payment');
 let inv=await f.latest();seen.addNewItemInvoice={reason:inv.billing_reason,status:inv.status,amountDue:inv.amount_due,matchesReview:inv.amount_due===first.r.amount,lines:lineShape(inv)};
 await f.paid();v=await f.view();assert.equal(v.capacityExtras.whatsapp.active,1);assert.equal(v.capacity?.whatsapp,3);
 // More of an existing item.
 const more=await buy(f,'whatsapp',2);inv=await f.latest();seen.addExistingItemInvoice={reason:inv.billing_reason,matchesReview:inv.amount_due===more.r.amount,lines:lineShape(inv)};await f.paid();assert.equal((await f.view()).capacityExtras.whatsapp.active,2);
 // The plan upgrade with an add-on on the subscription.
 const up=await prepareBilling(f.u.p,{kind:'upgrade',sku:'pro-annual'}),upOp=await confirmBilling(f.u.p,{requestId:randomUUID(),review:up});assert.equal(upOp.state,'awaiting_payment');
 inv=await f.latest();seen.upgradeInvoice={reason:inv.billing_reason,matchesReview:inv.amount_due===up.amount,lines:lineShape(inv)};await f.paid();v=await f.view();assert.equal(v.plan,'pro');assert.equal(v.capacityExtras.whatsapp.active,2);assert.equal(v.capacity?.whatsapp,getPlan('pro').capacity.whatsapp+2);
 // Reduction without proration: no invoice of its own, and events keep flowing.
 const before=(await f.latest()).id,red=await buy(f,'whatsapp',1);assert.equal(red.op.state,'completed');assert.equal((await f.latest()).id,before,'no new invoice');await f.updated();
 v=await f.view();assert.deepEqual(v.capacityExtras.whatsapp,{active:2,scheduled:1});
 // A real renewal: draft, finalization, payment.
 const s=await f.read(),end=s.items.data[0].current_period_end;await f.advance(end+2*3600);
 inv=await f.latest();seen.annualRenewal={reason:inv.billing_reason,status:inv.status,amountDue:inv.amount_due,lines:lineShape(inv)};assert.equal(inv.status,'paid');await f.paid();
 v=await f.view();assert.deepEqual(v.capacityExtras.whatsapp,{active:1,scheduled:null},'the reduction took effect');assert.equal(v.capacity?.whatsapp,getPlan('pro').capacity.whatsapp+1);
 assert.equal((await testAdmin(c=>c.query("SELECT count(DISTINCT external_ref)::int n FROM app.billing_grant WHERE workspace_id=$1 AND source='plan' AND unit='extractions'",[f.u.p.workspaceId]))).rows[0].n,2,'a window of the new year');
 // Down to zero removes the item.
 const zero=await buy(f,'whatsapp',0);assert.equal(zero.op.state,'completed');assert.equal((await f.read()).items.data.length,1);await f.updated();assert.equal((await f.view()).capacityExtras.whatsapp.scheduled,0);
});

test('homologation: a scheduled cycle change with an add-on, applied by the clock',scenario('cycle'),async()=>{
 const f=await fixture('essential');await buy(f,'mailboxes',1);await f.paid();assert.equal((await f.view()).capacityExtras.mailboxes.active,1);
 const c=await prepareBilling(f.u.p,{kind:'downgrade',sku:'essential-annual'}),op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:c});assert.equal(op.state,'completed');
 const s=await f.read();seen.cycleSchedule={attached:!!s.schedule,items:s.items.data.length};
 const sched=await api('GET','/subscription_schedules/'+s.schedule);seen.cyclePhases=sched.phases.map((p:any)=>p.items.length);assert.equal(sched.phases[1].items.length,2,'the add-on goes along');
 await assert.rejects(prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-mailboxes',quantity:2}),{status:409});
 await f.advance(s.items.data[0].current_period_end+2*3600);
 const invoices=(await api('GET','/invoices',{customer:f.customer,limit:'10'})).data;seen.cycleInvoices=invoices.map((i:any)=>({reason:i.billing_reason,status:i.status,due:i.amount_due,created:i.created,lines:lineShape(i),isLatest:false}));
 const after2=await f.read(),inv=await f.latest();seen.cyclePeriod={start:after2.items.data[0].current_period_start,end:after2.items.data[0].current_period_end,schedule:!!after2.schedule,status:after2.status,clock:(await api('GET','/test_helpers/test_clocks/'+f.clock)).frozen_time,latest:inv.id===invoices[0]?.id};seen.cycleRenewal={reason:inv.billing_reason,status:inv.status,amountDue:inv.amount_due,expected:381120+22800,lines:lineShape(inv),intervals:after2.items.data.map((i:any)=>i.price.recurring.interval)};
 assert.equal(inv.amount_due,403920,'charged at the boundary, not stretched for free');assert.equal(after2.items.data[0].current_period_start,s.items.data[0].current_period_end);assert.equal(inv.status,'paid');await f.paid();
 const v=await f.view();assert.equal(v.interval,'year');assert.equal(v.nextPlan,null);assert.equal(v.capacityExtras.mailboxes.active,1);assert.equal(v.capacity?.mailboxes,4);
 assert.equal((await f.read()).schedule,null,'released once applied');
 // A reduction: a purchase would preview with today's date, outside this clock's simulated period.
 assert.equal((await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-mailboxes',quantity:0})).amount,0,'changes are possible again');
});

test('homologation: annual to monthly at renewal, with a real invoice',scenario('toMonthly'),async()=>{
 const f=await fixture('essential-annual');await buy(f,'seats',1);await f.paid();
 const c=await prepareBilling(f.u.p,{kind:'downgrade',sku:'essential'}),op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:c});assert.equal(op.state,'completed');
 const s=await f.read(),end=s.items.data[0].current_period_end;await f.advance(end+2*3600);
 const after3=await f.read(),inv=await f.latest();seen.toMonthly={reason:inv.billing_reason,status:inv.status,amountDue:inv.amount_due,expected:39700+5900,lines:lineShape(inv),startsAtBoundary:after3.items.data[0].current_period_start===end,days:Math.round((after3.items.data[0].current_period_end-after3.items.data[0].current_period_start)/DAY)};
 assert.equal(inv.amount_due,45600,'charged at the boundary');assert.equal(inv.status,'paid');await f.paid();
 const v=await f.view();assert.equal(v.interval,'month');assert.equal(v.nextPlan,null);assert.equal(v.capacityExtras.seats.active,1);assert.equal(v.capacity?.seats,3);
 assert.equal((await f.read()).schedule,null,'released once applied');
});

test('homologation: a declined add-on grants nothing, and the expired update fails the operation',scenario('declined'),async()=>{
 const f=await fixture('essential');
 const pm=(await api('POST','/payment_methods/pm_card_chargeCustomerFail/attach',{customer:f.customer})).id;await api('POST','/customers/'+f.customer,{'invoice_settings[default_payment_method]':pm});
 const {r,op}=await buy(f,'seats',1);assert.equal(op.state,'awaiting_payment');
 let s=await f.read();seen.declined={pendingUpdate:!!s.pending_update,items:s.items.data.length,invoiceStatus:s.latest_invoice.status,reason:s.latest_invoice.billing_reason};assert.ok(r.amount>0);
 await f.paid();assert.equal((await f.view()).capacityExtras.seats.active,0,'unpaid');
 // Stripe abandons the pending update after 23 hours.
 const invoice=s.latest_invoice.id;await f.advance(Math.floor(Date.now()/1000)+25*3600);
 s=await f.read();const old=await api('GET','/invoices/'+invoice);seen.declinedExpired={pendingUpdate:!!s.pending_update,oldInvoiceStatus:old.status,latestIsSame:s.latest_invoice.id===invoice};
 await deliver(f.customer,'customer.subscription.pending_update_expired',f.sub);
 const state=(await testAdmin(c=>c.query("SELECT state,error_code FROM app.billing_operation WHERE workspace_id=$1 AND kind='capacity'",[f.u.p.workspaceId]))).rows[0];seen.declinedOperation=state;assert.equal(state.state,'failed');assert.equal((await f.view()).capacityExtras.seats.active,0);
});

test('homologation: coupon sessions on credit packs',scenario('coupon'),async()=>{
 const u=await billingUser();await beginTrial(u.p);
 const customer=(await api('POST','/customers',{email:'re-homolog-06g@example.com',name:'[RE] Homologacao 06G','metadata[workspace_id]':u.p.workspaceId})).id;customers.push(customer);
 await testAdmin(c=>c.query('UPDATE app.billing_account SET customer_id=$2 WHERE workspace_id=$1',[u.p.workspaceId,customer]));
 const campaign=async(params:Record<string,string>)=>{const stripe=(await api('POST','/coupons',{duration:'once',name:'[RE] 06G',...params})).id;coupons.push(stripe);const code='RE-'+randomUUID().replaceAll('-','').slice(0,10).toUpperCase();await testAdmin(c=>saveCoupon(c,{code,stripeCoupon:stripe,validUntil:new Date(Date.now()+DAY*1000),maxUses:5}));return code;};
 const session=async(op:any)=>{const row=(await testAdmin(c=>c.query('SELECT remote_id FROM app.billing_operation WHERE workspace_id=$1 AND id=$2',[u.p.workspaceId,op.id]))).rows[0];return api('GET','/checkout/sessions/'+row.remote_id,{'expand[0]':'line_items'});};
 // Rounding of a percentage, and a fixed amount: what the review promised against what Stripe computes.
 const rounded=[];for(const [params,sku] of [[{percent_off:'33.5'},'imports-5000'],[{percent_off:'12.5'},'imports-10000'],[{amount_off:'1000',currency:'brl'},'extractions-5000']] as [Record<string,string>,string][]){
  const code=await campaign(params),r=await prepareBilling(u.p,{kind:'checkout',sku,coupon:code}),op=await confirmBilling(u.p,{requestId:randomUUID(),review:r});assert.equal(op.state,'awaiting_payment');
  const s=await session(op),line=s.line_items.data[0];rounded.push({params,review:r.amount,total:s.amount_total,lineTotal:line.amount_total,lineSubtotal:line.amount_subtotal,expires:s.expires_at-Math.floor(Date.now()/1000),status:s.status});
  assert.ok(Math.abs(s.amount_total-r.amount)<=1,'within the tolerance');assert.equal(s.amount_total,line.amount_total);
  // Expiring it for real returns the use.
  await api('POST',`/checkout/sessions/${s.id}/expire`);await deliver(customer,'checkout.session.expired',s.id);assert.equal((await testAdmin(c=>c.query('SELECT count(*)::int n FROM app.billing_coupon_claim WHERE code=$1',[code]))).rows[0].n,0);
 }
 seen.couponRounding=rounded;
 // Coupon fields as Stripe returns them.
 const raw=await api('POST','/coupons',{duration:'once',percent_off:'10'});coupons.push(raw.id);seen.couponShape={valid:raw.valid,percent_off:raw.percent_off,amount_off:raw.amount_off,currency:raw.currency,computed:couponAmount(9700,raw)};
 const deleted=await campaign({percent_off:'5'}),gone=(await testAdmin(c=>c.query('SELECT stripe_coupon_id FROM app.billing_coupon WHERE code=$1',[deleted]))).rows[0].stripe_coupon_id;await api('DELETE','/coupons/'+gone);coupons.splice(coupons.indexOf(gone),1);
 await assert.rejects(prepareBilling(u.p,{kind:'checkout',sku:'imports-5000',coupon:deleted}),{status:422,code:'BILLING_COUPON_INVALID'});
 if(!process.env.HOMOLOGATION_PAY_FILE)return;
 // Paid by hand with a test card in the hosted Checkout.
 const code=await campaign({percent_off:'10'}),r=await prepareBilling(u.p,{kind:'checkout',sku:'extractions-2000',coupon:code}),op:any=await confirmBilling(u.p,{requestId:randomUUID(),review:r});assert.ok(op.url);
 writeFileSync(process.env.HOMOLOGATION_PAY_FILE,op.url);
 let s:any;for(let i=0;i<450;i++){s=await session(op);if(s.status==='complete')break;await new Promise(w=>setTimeout(w,2000));}
 assert.equal(s.status,'complete','not paid in time');seen.couponPaid={review:r.amount,total:s.amount_total,subtotal:s.line_items.data[0].amount_subtotal,paymentStatus:s.payment_status};
 await deliver(customer,'checkout.session.completed',s.id);const v=await readBilling(u.p);assert.equal(v.balances.find(b=>b.unit==='extractions')?.purchased,2000);
 assert.equal((await testAdmin(c=>c.query('SELECT state FROM app.billing_coupon_claim WHERE code=$1',[code]))).rows[0].state,'redeemed');
 await deliver(customer,'checkout.session.completed',s.id);assert.equal((await readBilling(u.p)).balances.find(b=>b.unit==='extractions')?.purchased,2000,'replay');
 // The annual plan through the real Checkout.
 const ar=await prepareBilling(u.p,{kind:'checkout',sku:'essential-annual'}),aop:any=await confirmBilling(u.p,{requestId:randomUUID(),review:ar});writeFileSync(process.env.HOMOLOGATION_PAY_FILE,aop.url);
 let as:any;for(let i=0;i<450;i++){as=await session(aop);if(as.status==='complete')break;await new Promise(w=>setTimeout(w,2000));}
 assert.equal(as.status,'complete','annual not paid in time');seen.annualCheckout={total:as.amount_total,subscription:!!as.subscription};
 await deliver(customer,'checkout.session.completed',as.id);const av=await readBilling(u.p);seen.annualCheckoutView={status:av.status,plan:av.plan,interval:av.interval,franchise:av.balances.find(b=>b.unit==='extractions')?.plan};assert.equal(av.status,'active');assert.equal(av.interval,'year');assert.equal(av.balances.find(b=>b.unit==='extractions')?.plan,5000);
 const sub=typeof as.subscription==='string'?as.subscription:as.subscription.id;await deliver(customer,'invoice.paid',(await api('GET','/subscriptions/'+sub)).latest_invoice);assert.equal((await readBilling(u.p)).balances.find(b=>b.unit==='extractions')?.plan,5000,'replay by invoice');
});
