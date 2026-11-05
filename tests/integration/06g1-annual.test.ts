import test,{after} from 'node:test';import assert from 'node:assert/strict';import {createHmac,randomUUID} from 'node:crypto';
import {billingUser,testAdmin} from './billing-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeBillingPool,billingPool} from '../../src/server/billing/db.ts';
import {createStripeAdapter} from '../../src/server/billing/stripe.ts';
import {billingConfig} from '../../src/server/billing/config.ts';
import {receiveBillingEvent,processBillingEvent} from '../../src/server/billing/events.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {BILLING_VERSION,monthlyWindow} from '../../src/domain/billing.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {prepareBilling,confirmBilling} from '../../src/server/billing/operations.ts';
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'});
after(async()=>{await closeBillingPool();await getPools().close();});
const event=(type:string,obj:any,id='evt_'+randomUUID().replaceAll('-',''))=>{const bytes=Buffer.from(JSON.stringify({id,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object:obj}})),t=Math.floor(Date.now()/1000);return{id,bytes,header:`t=${t},v1=`+createHmac('sha256','whsec_fixture').update(t+'.').update(bytes).digest('hex')};};
const DAY=86400;
async function fixture(o:{amount?:number;interval?:string}={}){
 const u=await billingUser(),customer='cus_'+randomUUID().replaceAll('-',''),subid='sub_'+randomUUID().replaceAll('-',''),now=Math.floor(Date.now()/1000),pi='pi_'+randomUUID().replaceAll('-',''),amount=o.amount??381120,interval=o.interval??'year';
 await testAdmin(c=>c.query('UPDATE app.billing_account SET customer_id=$2 WHERE workspace_id=$1',[u.p.workspaceId,customer]));
 const price:any={id:'price_cur',unit_amount:amount,currency:'brl',recurring:{interval,interval_count:1}};
 const invoice:any={id:'in_'+randomUUID().replaceAll('-',''),customer,currency:'brl',status:'paid',amount_paid:amount,amount_due:amount,amount_remaining:0,billing_reason:'subscription_create',created:now,parent:{subscription_details:{subscription:subid}},lines:{has_more:false,data:[{amount,quantity:1,pricing:{price_details:{price:'price_cur'}},period:{start:now,end:now+365*DAY}}]},payments:{has_more:false,data:[{status:'paid',payment:{type:'payment_intent',payment_intent:pi}}]}};
 const sub:any={id:subid,customer,status:'active',metadata:{workspace_id:u.p.workspaceId,catalog_version:BILLING_VERSION},items:{has_more:false,data:[{id:'si_fixture',quantity:1,price,current_period_start:now,current_period_end:now+365*DAY}]},latest_invoice:invoice.id,cancel_at_period_end:false};
 let refunded=false;const posts:{path:string;form:URLSearchParams}[]=[];
 const adapter=createStripeAdapter(async(input,init)=>{const url=new URL(String(input)),path=url.pathname,form=new URLSearchParams(String(init?.body));
  if(init?.method==='POST'){posts.push({path,form});
   if(path.endsWith('/create_preview'))return Response.json({id:'upcoming',currency:'brl',amount_due:48000});
   if(path.endsWith('/checkout/sessions'))return Response.json({id:'cs_fixture',url:'https://checkout.stripe.com/c/x'});
   if(path.endsWith('/customers'))return Response.json({id:customer});
   if(path.endsWith('/subscription_schedules'))return Response.json({id:'sub_sched_fixture'});
   if(path.endsWith('/sub_sched_fixture'))return Response.json({id:'sub_sched_fixture'});
   if(path.endsWith('/'+subid))return Response.json(sub);
   throw Error('Unexpected POST '+path);}
  if(path.endsWith('/prices')){const lookup=url.searchParams.get('lookup_keys[0]')??'',annual=lookup.endsWith('-annual'),pro=lookup.includes('pro-annual')||lookup.endsWith('-pro');return Response.json({data:[{id:'price_target',unit_amount:annual?(pro?861120:381120):(pro?89700:39700),currency:'brl',recurring:{interval:annual?'year':'month',interval_count:1}}]});}
  if(path.endsWith('/sub_sched_fixture')){const first=sub.items.data[0];return Response.json({id:'sub_sched_fixture',subscription:sub.id,status:'active',end_behavior:'release',metadata:{},current_phase:{start_date:first.current_period_start,end_date:first.current_period_end},phases:[{start_date:first.current_period_start,end_date:first.current_period_end,items:[{quantity:1,price:first.price.id}]}]});}
  if(path.endsWith('/'+subid))return Response.json(sub);
  if(path.includes('/invoices/'))return Response.json(invoice);
  if(path.includes('/payment_intents/'))return Response.json({id:pi,status:'succeeded',currency:'brl',latest_charge:{id:'ch_fixture',disputed:false,refunded,amount_refunded:refunded?amount:0}});
  if(path.includes('/charges/'))return Response.json({id:'ch_fixture',customer,payment_intent:pi,refunded:true,amount_refunded:amount,disputed:false});
  throw Error('Unexpected GET '+path);
 },billingConfig());
 return {u,customer,subid,pi,sub,invoice,adapter,posts,now,refund:()=>{refunded=true;}};
}
type F=Awaited<ReturnType<typeof fixture>>;
/** The next paid period: new price id, new invoice, the anchor moved. */
function renew(f:F,amount:number,interval:string,days:number,offset=365){
 const start=f.now+offset*DAY,end=start+days*DAY,item=f.sub.items.data[0];
 item.price={id:'price_next',unit_amount:amount,currency:'brl',recurring:{interval,interval_count:1}};item.current_period_start=start;item.current_period_end=end;
 Object.assign(f.invoice,{id:'in_'+randomUUID().replaceAll('-',''),amount_due:amount,amount_paid:amount,lines:{has_more:false,data:[{amount,quantity:1,pricing:{price_details:{price:'price_next'}},period:{start,end}}]}});f.sub.latest_invoice=f.invoice.id;
}
async function deliver(f:F,type:string,obj:any){const e=event(type,obj);await receiveBillingEvent(e.bytes,e.header);await processBillingEvent(e.id,f.adapter);return e;}
const pay=(f:F)=>deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer});
const grants=async(f:F,unit='extractions')=>(await testAdmin(c=>c.query("SELECT external_ref,quantity,expires_at,revoked FROM app.billing_grant WHERE workspace_id=$1 AND source='plan' AND unit=$2 ORDER BY expires_at",[f.u.p.workspaceId,unit]))).rows;
const roll=(at:Date)=>billingPool().query('SELECT app.billing_roll_annual($1,$2) n',[100,at]).then(r=>Number(r.rows[0].n));
const inDays=(n:number)=>new Date(Date.now()+n*DAY*1000);

test('06G.1 an annual payment grants the current month only, once, and opens a window per month',async()=>{
 const f=await fixture();await pay(f);await pay(f);
 const v=await readBilling(f.u.p);assert.equal(v.status,'active');assert.equal(v.plan,'essential');assert.equal(v.interval,'year');
 assert.equal(v.balances.find(b=>b.unit==='extractions')?.plan,5000,'not twelve times the franchise');
 let g=await grants(f);assert.equal(g.length,1);assert.ok(Date.parse(g[0].expires_at)<Date.now()+32*DAY*1000,'the window ends within the month');
 assert.equal(await roll(new Date()),0,'same window: nothing to open');
 assert.ok(await roll(inDays(32))>=1);assert.equal(await roll(inDays(32)),0,'idempotent');
 g=await grants(f);assert.equal(g.length,2);assert.equal(g[1].quantity,5000);assert.ok(Date.parse(g[1].expires_at)>Date.parse(g[0].expires_at));
 await roll(inDays(63));assert.equal((await grants(f)).length,3);
 // Past the paid year nothing opens; the last window never outlives the period.
 await roll(inDays(400));assert.equal((await grants(f)).length,3);
 await roll(inDays(360));const last=(await grants(f)).at(-1)!;assert.ok(Date.parse(last.expires_at)<=(f.now+365*DAY)*1000);
 // A monthly subscription is untouched by the roll.
 const m=await fixture({amount:39700,interval:'month'});m.sub.items.data[0].current_period_end=m.now+30*DAY;m.invoice.lines.data[0].period.end=m.now+30*DAY;await pay(m);
 assert.equal((await readBilling(m.u.p)).interval,'month');await roll(inDays(20));assert.equal((await grants(m)).length,1);
 assert.equal((await grants(m))[0].external_ref,m.subid+':'+m.now);
});

test('06G.1 a price that does not match the catalog grants nothing; a refund revokes every window',async()=>{
 const wrong=await fixture({amount:39700,interval:'year'});await pay(wrong);assert.notEqual((await readBilling(wrong.u.p)).status,'active');assert.equal((await grants(wrong)).length,0);
 const cheap=await fixture({amount:100000,interval:'year'});await pay(cheap);assert.equal((await grants(cheap)).length,0);
 const f=await fixture();await pay(f);await roll(inDays(32));assert.equal((await grants(f)).filter(g=>!g.revoked).length,2);
 f.refund();await deliver(f,'charge.refunded',{id:'ch_fixture',customer:f.customer});
 assert.equal((await grants(f)).filter(g=>!g.revoked).length,0,'all windows of that payment');
 assert.equal(await roll(inDays(63)),0,'a blocked payment opens nothing');
});

test('06G.1 review and changes: server price, cycle change at renewal, combined change refused',async()=>{
 const fresh=await billingUser();
 const r=await prepareBilling(fresh.p,{kind:'checkout',sku:'pro-annual'},{adapter:(await fixture()).adapter});assert.equal(r.amount,861120);assert.match(r.effects.join(' '),/mês/);
 await assert.rejects(prepareBilling(fresh.p,{kind:'checkout',sku:'pro-annual',amount:100} as never,{}),{status:422},'the client never sets a price');
 await assert.rejects(prepareBilling(fresh.p,{kind:'checkout',sku:'pro-semester'},{}),{status:422});
 // Annual to monthly: at renewal, with no charge now.
 const f=await fixture();await pay(f);
 const c=await prepareBilling(f.u.p,{kind:'downgrade',sku:'essential'},{adapter:f.adapter});assert.equal(c.amount,0);assert.match(c.effects.join(' '),/renovação/);
 await assert.rejects(prepareBilling(f.u.p,{kind:'downgrade',sku:'pro'},{adapter:f.adapter}),{status:422},'plan and cycle at once');
 await assert.rejects(prepareBilling(f.u.p,{kind:'upgrade',sku:'pro'},{adapter:f.adapter}),{status:422});
 await confirmBilling(f.u.p,{requestId:randomUUID(),review:c},{adapter:f.adapter});
 const update=f.posts.find(x=>x.form.has('phases[1][items][0][price]'))!;assert.equal(update.form.get('phases[1][duration][interval]'),'month');
 const v=await readBilling(f.u.p);assert.equal(v.nextPlan,'essential');assert.equal(v.interval,'year','unchanged until the renewal');assert.equal(v.balances.find(b=>b.unit==='extractions')?.plan,5000);
 // The renewal really moves the period, with a new price and invoice, and applies the scheduled change.
 renew(f,39700,'month',30);f.invoice.billing_reason='subscription_cycle';
 await pay(f);const after1=await readBilling(f.u.p);assert.equal(after1.interval,'month');assert.equal(after1.nextPlan,null);
 assert.equal((await grants(f)).at(-1)!.external_ref,f.subid+':'+f.sub.items.data[0].current_period_start,'a monthly period grants by the period again');
 // Annual upgrade is reviewed with the provider's proration.
 const g=await fixture();await pay(g);
 const up=await prepareBilling(g.u.p,{kind:'upgrade',sku:'pro-annual'},{adapter:g.adapter});assert.equal(up.amount,48000);
 // Monthly to annual, same plan.
 const m=await fixture({amount:39700,interval:'month'});m.sub.items.data[0].current_period_end=m.now+30*DAY;m.invoice.lines.data[0].period.end=m.now+30*DAY;await pay(m);
 const yr=await prepareBilling(m.u.p,{kind:'downgrade',sku:'essential-annual'},{adapter:m.adapter});assert.equal(yr.amount,0);assert.match(yr.effects.join(' '),/3\.811,20/);
 await confirmBilling(m.u.p,{requestId:randomUUID(),review:yr},{adapter:m.adapter});
 assert.equal(m.posts.find(x=>x.form.has('phases[1][items][0][price]'))!.form.get('phases[1][duration][interval]'),'year');
});

test('06G.1 review: one open subscription operation, also while a checkout awaits payment',async()=>{
 const f=await fixture();
 const r1=await prepareBilling(f.u.p,{kind:'checkout',sku:'essential-annual'},{adapter:f.adapter}),r2=await prepareBilling(f.u.p,{kind:'checkout',sku:'pro'},{adapter:f.adapter});
 const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r1},{adapter:f.adapter});assert.equal(op.state,'awaiting_payment');
 await assert.rejects(confirmBilling(f.u.p,{requestId:randomUUID(),review:r2},{adapter:f.adapter}),{status:409,code:'BILLING_OPERATION_PENDING'},'a second checkout cannot be opened in another tab');
 assert.equal((await testAdmin(c=>c.query("SELECT indexdef FROM pg_indexes WHERE indexname='billing_subscription_operation'"))).rows[0].indexdef.includes('resume'),true);
});

test('06G.1 review: a cycle change invoiced as subscription_update is accepted only when it was scheduled',async()=>{
 const f=await fixture();await pay(f);const c=await prepareBilling(f.u.p,{kind:'downgrade',sku:'essential'},{adapter:f.adapter});await confirmBilling(f.u.p,{requestId:randomUUID(),review:c},{adapter:f.adapter});
 renew(f,39700,'month',30);f.invoice.billing_reason='subscription_update';
 await pay(f);const v=await readBilling(f.u.p);assert.equal(v.interval,'month');assert.equal(v.nextPlan,null);assert.equal(v.status,'active');
 // A replay arrives after the schedule was cleared and is still understood.
 const replay=await pay(f);assert.equal((await testAdmin(c=>c.query('SELECT state FROM app.billing_event_inbox WHERE id=$1',[replay.id]))).rows[0].state,'done');
 // The same invoice with no schedule behind it grants nothing.
 const g=await fixture();await pay(g);renew(g,89700,'month',30);g.invoice.billing_reason='subscription_update';await pay(g);
 assert.equal((await readBilling(g.u.p)).plan,'essential','an unapproved change is not applied');
});

test('06G.1 review: the gap between windows spends the franchise, not paid packs; statuses stop the roll; roles; clamping',async()=>{
 const f=await fixture();await pay(f);
 await testAdmin(c=>c.query("INSERT INTO app.billing_grant(workspace_id,id,unit,quantity,source,external_ref) VALUES($1,'pack-qa','extractions',100,'pack','pack-qa')",[f.u.p.workspaceId]));
 // The worker has not run yet and the window has just ended.
 await testAdmin(async c=>{await c.query("UPDATE app.billing_account SET period_start=period_start-interval '32 days' WHERE workspace_id=$1",[f.u.p.workspaceId]);await c.query("UPDATE app.billing_grant SET expires_at=now()-interval '1 minute' WHERE workspace_id=$1 AND source='plan'",[f.u.p.workspaceId]);});
 await withWorkspaceTransaction(f.u.p,c=>c.query("SELECT app.billing_reserve($1,'extractions',10)",[randomUUID()]));
 const pack=await testAdmin(async c=>(await c.query("SELECT held,spent FROM app.billing_grant WHERE id='pack-qa' AND workspace_id=$1",[f.u.p.workspaceId])).rows[0]);assert.deepEqual([pack.held,pack.spent],[0,0],'the prepaid pack is untouched');
 // Past due and canceled open nothing, also from the reservation path.
 const d=await fixture();await pay(d);await testAdmin(c=>c.query("UPDATE app.billing_account SET state='past_due' WHERE workspace_id=$1",[d.u.p.workspaceId]));const n=(await grants(d)).length;await roll(inDays(32));assert.equal((await grants(d)).length,n);
 // Upgrade: the next window carries the new plan's quantity.
 const up=await fixture();await pay(up);await testAdmin(c=>c.query("UPDATE app.billing_account SET plan='pro' WHERE workspace_id=$1",[up.u.p.workspaceId]));await roll(inDays(32));assert.equal((await grants(up)).at(-1)!.quantity,8000);
 // Operators do not manage billing.
 const m=await billingUser();await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),f.u.p.workspaceId,m.p.userId,'operator']));
 await assert.rejects(prepareBilling({...m.p,workspaceId:f.u.p.workspaceId,role:'operator'},{kind:'checkout',sku:'pro-annual'},{adapter:f.adapter}),{status:403});
 // The same anchored months as the domain, clamped day included.
 const w=async(anchor:string,at:string)=>(await testAdmin(c=>c.query('SELECT window_start,window_end FROM app.billing_month_window($1,$2)',[anchor,at]))).rows[0];
 for(const [anchor,at] of [['2026-01-31T12:00:00Z','2026-02-28T13:00:00Z'],['2026-01-31T12:00:00Z','2026-03-31T11:00:00Z'],['2026-01-31T12:00:00Z','2026-12-31T12:00:00Z'],['2024-02-29T00:00:00Z','2025-02-28T00:00:00Z']]){
  const r=await w(anchor,at),e=monthlyWindow(anchor,at);assert.deepEqual([new Date(r.window_start).toISOString(),new Date(r.window_end).toISOString()],[e.start,e.end],anchor+' '+at);
 }
});

test('06G.1 review: upgrade delta on the open window, late payment, second year, replacement',async()=>{
 // Upgrade: the difference lands on the current window, not on a thirteenth one.
 const f=await fixture();await pay(f);
 const up=await prepareBilling(f.u.p,{kind:'upgrade',sku:'pro-annual'},{adapter:f.adapter});
 const inv='in_'+randomUUID().replaceAll('-','');f.sub.latest_invoice=inv;
 await confirmBilling(f.u.p,{requestId:randomUUID(),review:up},{adapter:f.adapter});
 Object.assign(f.sub.items.data[0],{price:{id:'price_target',unit_amount:861120,currency:'brl',recurring:{interval:'year',interval_count:1}}});
 Object.assign(f.invoice,{id:inv,billing_reason:'subscription_update',amount_due:48000,amount_paid:48000,lines:{has_more:false,data:[{amount:48000,quantity:1,pricing:{price_details:{price:'price_target'}},period:{start:f.now,end:f.now+365*DAY}}]}});
 await pay(f);const v=await readBilling(f.u.p);assert.equal(v.plan,'pro');assert.equal(v.interval,'year');
 const g=await grants(f);assert.equal(g.length,1);assert.equal(g[0].quantity,8000);
 await roll(inDays(32));assert.equal((await grants(f)).at(-1)!.quantity,8000);
 // A payment reconciled months late opens the current window only, already valid.
 const late=await fixture(),start=late.now-40*DAY;Object.assign(late.sub.items.data[0],{current_period_start:start,current_period_end:start+365*DAY});late.invoice.lines.data[0].period={start,end:start+365*DAY};await pay(late);
 const lg=await grants(late);assert.equal(lg.length,1);assert.ok(Date.parse(lg[0].expires_at)>Date.now());assert.ok(lg[0].external_ref.startsWith(late.subid+':'+start+':w:'));assert.notEqual(lg[0].external_ref,late.subid+':'+start+':w:'+start);
 // The second year has its own references.
 const y=await fixture();await pay(y);const first=(await grants(y))[0].external_ref;renew(y,381120,'year',365,0);y.sub.items.data[0].current_period_start=y.now+1;y.invoice.lines.data[0].period.start=y.now+1;y.invoice.billing_reason='subscription_cycle';await pay(y);
 const yg=await grants(y);assert.equal(yg.length,2);assert.notEqual(yg[1].external_ref,first);
 // A paid replacement revokes the old subscription's windows and forgets its schedule.
 const r=await fixture();await pay(r);const old=r.subid;await roll(inDays(32));
 const session='cs_replacement_'+randomUUID().replaceAll('-',''),op=randomUUID(),next='sub_replacement_'+randomUUID().replaceAll('-','');
 await testAdmin(async c=>{await c.query("UPDATE app.billing_account SET state='canceled',next_plan='essential',change_schedule_id='sub_sched_old' WHERE workspace_id=$1",[r.u.p.workspaceId]);await c.query("INSERT INTO app.billing_operation(workspace_id,id,request_id,actor_id,body_hash,kind,sku,expected_revision,state,customer_id,remote_id) VALUES($1,$2,$2,$3,'hash','checkout','essential-annual',0,'awaiting_payment',$4,$5)",[r.u.p.workspaceId,op,r.u.p.userId,r.customer,session]);});
 r.sub.id=next;r.invoice.id='in_'+randomUUID().replaceAll('-','');r.sub.latest_invoice=r.invoice.id;r.invoice.parent.subscription_details.subscription=next;
 const checkout={id:session,customer:r.customer,mode:'subscription',status:'complete',payment_status:'paid',currency:'brl',amount_total:381120,subscription:next,metadata:{workspace_id:r.u.p.workspaceId,operation_id:op,sku:'essential-annual',catalog_version:BILLING_VERSION},line_items:{has_more:false,data:[{quantity:1,amount_total:381120}]}};
 const e=event('checkout.session.completed',{id:session,customer:r.customer});await receiveBillingEvent(e.bytes,e.header);await processBillingEvent(e.id,{...r.adapter,readCheckout:async()=>checkout,readSubscription:async()=>r.sub} as never);
 const after2=await testAdmin(c=>c.query("SELECT subscription_id,next_plan,change_schedule_id FROM app.billing_account WHERE workspace_id=$1",[r.u.p.workspaceId]));assert.deepEqual(after2.rows[0],{subscription_id:next,next_plan:null,change_schedule_id:null});
 assert.equal((await testAdmin(c=>c.query("SELECT count(*)::int n FROM app.billing_grant WHERE workspace_id=$1 AND starts_with(external_ref,$2) AND NOT revoked AND source='plan' AND unit<>'enrichment'",[r.u.p.workspaceId,old+':']))).rows[0].n,0);
});
