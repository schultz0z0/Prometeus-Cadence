import test,{after} from 'node:test';import assert from 'node:assert/strict';import {createHmac,randomUUID} from 'node:crypto';
import {billingUser,testAdmin,beginTrial} from './billing-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
import {createStripeAdapter} from '../../src/server/billing/stripe.ts';
import {billingConfig} from '../../src/server/billing/config.ts';
import {receiveBillingEvent,processBillingEvent} from '../../src/server/billing/events.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {BILLING_VERSION,capacityOffer,getSku,type CapacityUnit} from '../../src/domain/billing.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {prepareBilling,confirmBilling,processBillingOperation} from '../../src/server/billing/operations.ts';
import {identityAction} from '../../src/server/workspaces/service.ts';
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'});
after(async()=>{await closeBillingPool();await getPools().close();});
const event=(type:string,obj:any,id='evt_'+randomUUID().replaceAll('-',''))=>{const bytes=Buffer.from(JSON.stringify({id,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object:obj}})),t=Math.floor(Date.now()/1000);return{id,bytes,header:`t=${t},v1=`+createHmac('sha256','whsec_fixture').update(t+'.').update(bytes).digest('hex')};};
const DAY=86400,rid=(p:string)=>p+'_'+randomUUID().replaceAll('-','');
const priceOf=(id:string,amount:number,interval:string)=>({id,unit_amount:amount,currency:'brl',recurring:{interval,interval_count:1}});
async function fixture(o:{amount?:number;interval?:string}={}){
 const u=await billingUser(),customer=rid('cus'),subid=rid('sub'),now=Math.floor(Date.now()/1000),pi=rid('pi'),amount=o.amount??39700,interval=o.interval??'month',days=interval==='year'?365:30;
 await testAdmin(c=>c.query('UPDATE app.billing_account SET customer_id=$2 WHERE workspace_id=$1',[u.p.workspaceId,customer]));
 const line=(price:string,value:number,start=now,end=now+days*DAY,quantity=1)=>({amount:value,quantity,pricing:{price_details:{price}},period:{start,end}});
 const invoice:any={id:rid('in'),customer,currency:'brl',status:'paid',amount_paid:amount,amount_due:amount,amount_remaining:0,billing_reason:'subscription_create',created:now,parent:{subscription_details:{subscription:subid}},lines:{has_more:false,data:[line('price_cur',amount)]},payments:{has_more:false,data:[{status:'paid',payment:{type:'payment_intent',payment_intent:pi}}]}};
 const sub:any={id:subid,customer,status:'active',metadata:{workspace_id:u.p.workspaceId,catalog_version:BILLING_VERSION},items:{has_more:false,data:[{id:'si_plan',quantity:1,price:priceOf('price_cur',amount,interval),current_period_start:now,current_period_end:now+days*DAY}]},latest_invoice:invoice.id,cancel_at_period_end:false};
 const posts:{path:string;form:URLSearchParams}[]=[];const stored:Record<string,any>={};let onPost:((form:URLSearchParams)=>Promise<void>)|null=null,failPost:number|null=null,payment=pi,preview=2500,refunded=false,voided:string|null=null;
 const adapter=createStripeAdapter(async(input,init)=>{const url=new URL(String(input)),path=url.pathname,form=new URLSearchParams(String(init?.body));
  if(init?.method==='POST'){posts.push({path,form});
   if(path.endsWith('/create_preview'))return Response.json({id:'upcoming',currency:'brl',amount_due:preview});
   if(path.endsWith('/subscription_schedules'))return Response.json({id:'sub_sched_fixture'});
   if(path.endsWith('/sub_sched_fixture'))return Response.json({id:'sub_sched_fixture'});
   if(path.endsWith('/'+subid)){await onPost?.(form);if(failPost){const status=failPost;failPost=null;return new Response('{}',{status});}return Response.json(sub);}
   throw Error('Unexpected POST '+path);}
  if(path.endsWith('/prices')){const code=(url.searchParams.get('lookup_keys[0]')??'').replace('prometeus-'+BILLING_VERSION+'-','');const offer:any=code.startsWith('capacity-')?capacityOffer(code.replace('capacity-','').replace('-annual','') as CapacityUnit,code.endsWith('-annual')?'year':'month'):getSku(code);return Response.json({data:[priceOf('price_'+code.replaceAll('-','_'),offer.amount,offer.interval??offer.cycle)]});}
  if(path.endsWith('/sub_sched_fixture')){const first=sub.items.data[0];return Response.json({id:'sub_sched_fixture',subscription:sub.id,status:'active',end_behavior:'release',metadata:{},current_phase:{start_date:first.current_period_start,end_date:first.current_period_end},phases:[{start_date:first.current_period_start,end_date:first.current_period_end,items:sub.items.data.map((i:any)=>({quantity:i.quantity,price:i.price.id}))}]});}
  if(path.endsWith('/'+subid))return Response.json(sub);
  if(path.includes('/invoices/')){const asked=path.split('/').at(-1)!;return Response.json(asked===voided?{...invoice,id:voided,status:'void'}:stored[asked]??invoice);}
  if(path.includes('/payment_intents/')){const asked=path.split('/').at(-1);return Response.json({id:asked,status:'succeeded',currency:'brl',latest_charge:{id:'ch_fixture',disputed:false,refunded:refunded&&asked===payment,amount_refunded:refunded&&asked===payment?1:0}});}
  if(path.includes('/charges/'))return Response.json({id:'ch_fixture',customer,payment_intent:payment,refunded:true,amount_refunded:1,disputed:false});
  throw Error('Unexpected GET '+path);
 },billingConfig());
 const setExtra=(unit:CapacityUnit,quantity:number)=>{const offer=capacityOffer(unit,interval as 'month'|'year'),items=sub.items.data,first=items[0];sub.items.data=items.filter((i:any)=>i.id!=='si_'+unit);if(quantity)sub.items.data.push({id:'si_'+unit,quantity,price:priceOf('price_'+offer.code.replaceAll('-','_'),offer.amount,interval),current_period_start:first.current_period_start,current_period_end:first.current_period_end});};
 return {u,customer,subid,pi,sub,invoice,adapter,posts,now,days,interval,amount,setExtra,line,setPreview:(n:number)=>{preview=n;},store:(i:any)=>{stored[i.id]=i;},onPost:(fn:(form:URLSearchParams)=>Promise<void>)=>{onPost=fn;},failNext:(status:number)=>{failPost=status;},refund:()=>{refunded=true;},newPayment:()=>{payment=rid('pi');invoice.payments.data[0].payment.payment_intent=payment;},voidInvoice:(i:string)=>{voided=i;}};
}
type F=Awaited<ReturnType<typeof fixture>>;
async function deliver(f:F,type:string,obj:any,expected='done'){const e=event(type,obj);await receiveBillingEvent(e.bytes,e.header);await processBillingEvent(e.id,f.adapter);assert.equal((await testAdmin(c=>c.query('SELECT state FROM app.billing_event_inbox WHERE id=$1',[e.id]))).rows[0].state,expected,type);return e;}
const pay=(f:F,expected='done')=>deliver(f,'invoice.paid',{id:f.invoice.id,customer:f.customer},expected);
const opState=async(f:F,kind='capacity')=>(await testAdmin(c=>c.query('SELECT state,error_code FROM app.billing_operation WHERE workspace_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT 1',[f.u.p.workspaceId,kind]))).rows[0];
/** Buys add-ons through the real flow: review, confirm, then the approved invoice is paid. */
async function buy(f:F,unit:CapacityUnit,quantity:number,amount=2500){
 f.setPreview(amount);const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-'+unit,quantity},{adapter:f.adapter});
 const inv=rid('in');f.sub.latest_invoice=inv;
 const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r},{adapter:f.adapter});assert.equal(op.state,'awaiting_payment');
 f.setExtra(unit,quantity);const offer=capacityOffer(unit,f.interval as 'month'|'year'),start=f.sub.items.data[0].current_period_start,end=f.sub.items.data[0].current_period_end;
 Object.assign(f.invoice,{id:inv,billing_reason:'subscription_update',amount_due:amount,amount_paid:amount,lines:{has_more:false,data:[f.line('price_'+offer.code.replaceAll('-','_'),amount,start,end,quantity)]}});
 await pay(f);return r;
}
/** The next paid period, billed whole for what the subscription now holds. */
function renew(f:F,total?:number){
 const start=f.sub.items.data[0].current_period_end,end=start+f.days*DAY;
 for(const i of f.sub.items.data)Object.assign(i,{current_period_start:start,current_period_end:end});
 const sum=f.sub.items.data.reduce((n:number,i:any)=>n+i.price.unit_amount*i.quantity,0);
 Object.assign(f.invoice,{id:rid('in'),billing_reason:'subscription_cycle',amount_due:total??sum,amount_paid:total??sum,lines:{has_more:false,data:f.sub.items.data.map((i:any)=>f.line(i.price.id,i.price.unit_amount*i.quantity,start,end,i.quantity))}});f.sub.latest_invoice=f.invoice.id;
}
const connect=(f:F)=>withWorkspaceTransaction(f.u.p,c=>c.query("INSERT INTO app.channel_connection(workspace_id,id,provider,name,public_id,identifiers,created_by) VALUES($1,$2,'meta','QA',$2,'{}',$3) RETURNING id",[f.u.p.workspaceId,randomUUID(),f.u.p.userId])).then(r=>r.rows[0].id as string);
const disconnect=(f:F,id:string)=>testAdmin(c=>c.query('UPDATE app.channel_connection SET archived_at=now() WHERE workspace_id=$1 AND id=$2',[f.u.p.workspaceId,id]));

test('06G.2 an add-on is granted only after the approved invoice is paid, once',async()=>{
 const f=await fixture();await pay(f);
 assert.equal((await readBilling(f.u.p)).capacity?.whatsapp,2);
 f.setPreview(3100);const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:1},{adapter:f.adapter});
 assert.equal(r.amount,3100);assert.equal(r.quantity,1);assert.equal(r.sku,'capacity-whatsapp');assert.match(r.effects.join(' '),/49,00/);
 const inv=rid('in');f.sub.latest_invoice=inv;
 const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r},{adapter:f.adapter});assert.equal(op.state,'awaiting_payment');
 const update=f.posts.find(p=>p.path.endsWith('/'+f.subid)&&p.form.get('items[0][quantity]')==='1')!;
 assert.equal(update.form.get('items[0][price]'),'price_capacity_whatsapp');assert.equal(update.form.get('payment_behavior'),'pending_if_incomplete');assert.equal(update.form.get('proration_behavior'),'always_invoice');
 assert.equal((await readBilling(f.u.p)).capacity?.whatsapp,2,'nothing before payment');
 // The return from payment or an unpaid invoice grants nothing.
 Object.assign(f.invoice,{id:inv,status:'open',amount_paid:0,amount_remaining:3100,amount_due:3100,billing_reason:'subscription_update'});await pay(f);
 assert.equal((await readBilling(f.u.p)).capacity?.whatsapp,2,'unpaid');
 f.setExtra('whatsapp',1);Object.assign(f.invoice,{status:'paid',amount_paid:3100,amount_remaining:0,lines:{has_more:false,data:[f.line('price_capacity_whatsapp',3100)]}});
 await pay(f);const v=await readBilling(f.u.p);
 assert.equal(v.capacity?.whatsapp,3);assert.deepEqual(v.capacityExtras.whatsapp,{active:1,scheduled:null});assert.equal((await opState(f)).state,'completed');
 const replay=await pay(f);assert.equal((await readBilling(f.u.p)).capacity?.whatsapp,3);assert.equal((await testAdmin(c=>c.query('SELECT state FROM app.billing_event_inbox WHERE id=$1',[replay.id]))).rows[0].state,'done');
 // The franchise of the period is untouched, and the database enforces the new limit.
 assert.equal(v.balances.find(b=>b.unit==='extractions')?.plan,5000);
 await connect(f);await connect(f);await connect(f);await assert.rejects(connect(f),{code:'BILLING_CAPACITY'});
});

test('06G.2 a quantity raised in Stripe without approval grants nothing until a renewal pays for it',async()=>{
 const f=await fixture();await pay(f);
 f.setExtra('seats',3);await deliver(f,'customer.subscription.updated',{id:f.subid,customer:f.customer});
 assert.equal((await readBilling(f.u.p)).capacity?.seats,2,'no free seats');
 renew(f,39700);await pay(f,'pending');assert.equal((await readBilling(f.u.p)).capacity?.seats,2,'a renewal that does not add up grants nothing');
 renew(f);await pay(f);assert.equal((await readBilling(f.u.p)).capacity?.seats,5);
 // A divergent item stops recognition entirely.
 f.sub.items.data[1].price.unit_amount=1;await deliver(f,'customer.subscription.updated',{id:f.subid,customer:f.customer},'pending');assert.equal((await readBilling(f.u.p)).capacity?.seats,5,'unchanged');
});

test('06G.2 a reduction is refused while in use, holds the limit and takes effect at renewal',async()=>{
 const f=await fixture();await pay(f);await buy(f,'whatsapp',2);
 const ids=[await connect(f),await connect(f),await connect(f),await connect(f)];
 await assert.rejects(prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:1},{adapter:f.adapter}),{status:409,code:'BILLING_CAPACITY_IN_USE'});
 assert.equal((await testAdmin(c=>c.query('SELECT count(*)::int n FROM app.channel_connection WHERE workspace_id=$1 AND archived_at IS NULL',[f.u.p.workspaceId]))).rows[0].n,4,'nothing removed');
 await disconnect(f,ids[0]);
 const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:1},{adapter:f.adapter});assert.equal(r.amount,0);assert.match(r.effects.join(' '),/renovação/);
 const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r},{adapter:f.adapter});assert.equal(op.state,'completed');
 const update=f.posts.at(-1)!;assert.equal(update.form.get('items[0][id]'),'si_whatsapp');assert.equal(update.form.get('items[0][quantity]'),'1');assert.equal(update.form.get('proration_behavior'),'none');
 f.setExtra('whatsapp',1);await deliver(f,'customer.subscription.updated',{id:f.subid,customer:f.customer});
 let v=await readBilling(f.u.p);assert.equal(v.capacity?.whatsapp,3,'the same limit the guard applies');assert.deepEqual(v.capacityExtras.whatsapp,{active:2,scheduled:1});
 await assert.rejects(connect(f),{code:'BILLING_CAPACITY'},'new resources respect the scheduled quantity');
 await assert.rejects(prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:3},{adapter:f.adapter}),{status:409},'one change at a time');
 renew(f);await pay(f);v=await readBilling(f.u.p);assert.equal(v.capacity?.whatsapp,3);assert.deepEqual(v.capacityExtras.whatsapp,{active:1,scheduled:null});
 // Down to zero removes the item.
 await disconnect(f,ids[1]);const z=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:0},{adapter:f.adapter});await confirmBilling(f.u.p,{requestId:randomUUID(),review:z},{adapter:f.adapter});
 assert.equal(f.posts.at(-1)!.form.get('items[0][deleted]'),'true');
 f.setExtra('whatsapp',0);await deliver(f,'customer.subscription.updated',{id:f.subid,customer:f.customer});assert.deepEqual((await readBilling(f.u.p)).capacityExtras.whatsapp,{active:1,scheduled:0});
});

test('06G.2 add-ons do not outlive the subscription and do not expand while payment is pending',async()=>{
 const f=await fixture();await pay(f);await buy(f,'whatsapp',1);const a=await connect(f);await connect(f);await connect(f);
 await testAdmin(c=>c.query("UPDATE app.billing_account SET state='past_due' WHERE workspace_id=$1",[f.u.p.workspaceId]));await disconnect(f,a);
 await assert.rejects(connect(f),{code:'BILLING_CAPACITY'},'pending payment: the base limit');
 await testAdmin(c=>c.query("UPDATE app.billing_account SET state='active' WHERE workspace_id=$1",[f.u.p.workspaceId]));
 f.sub.status='canceled';await deliver(f,'customer.subscription.deleted',{id:f.subid,customer:f.customer});
 const v=await readBilling(f.u.p);assert.equal(v.status,'canceled');assert.deepEqual(v.capacityExtras.whatsapp,{active:0,scheduled:null});
 assert.equal((await testAdmin(c=>c.query('SELECT count(*)::int n FROM app.channel_connection WHERE workspace_id=$1 AND archived_at IS NULL',[f.u.p.workspaceId]))).rows[0].n,2,'nothing removed');
 assert.equal((await testAdmin(c=>c.query('SELECT count(*)::int n FROM auth.member WHERE "organizationId"=$1',[f.u.p.workspaceId]))).rows[0].n,1,'the owner stays');
});

test('06G.2 plan and cycle changes keep add-ons, and annual subscribers pay the annual price',async()=>{
 const f=await fixture({amount:89700});await pay(f);await buy(f,'whatsapp',2);
 const up=await fixture();await pay(up);await buy(up,'seats',1);
 const u=await prepareBilling(up.u.p,{kind:'upgrade',sku:'pro'},{adapter:up.adapter});assert.ok(u.amount>0,'upgrade with an add-on');
 const d=await prepareBilling(f.u.p,{kind:'downgrade',sku:'essential'},{adapter:f.adapter});assert.match(d.effects.join(' '),/495,00/,'renewal includes add-ons');
 await confirmBilling(f.u.p,{requestId:randomUUID(),review:d},{adapter:f.adapter});
 let s=f.posts.find(p=>p.form.has('phases[1][items][0][price]'))!;
 assert.equal(s.form.get('phases[1][items][0][price]'),'price_essential');assert.equal(s.form.get('phases[1][items][1][price]'),'price_capacity_whatsapp');assert.equal(s.form.get('phases[1][items][1][quantity]'),'2');
 assert.equal(s.form.get('phases[0][items][1][quantity]'),'2','the current period is preserved');
 await assert.rejects(prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:3},{adapter:f.adapter}),{status:409},'not while a change is scheduled');
 // Monthly to annual moves the add-on to its annual price.
 const m=await fixture();await pay(m);await buy(m,'mailboxes',1);
 const c=await prepareBilling(m.u.p,{kind:'downgrade',sku:'essential-annual'},{adapter:m.adapter});await confirmBilling(m.u.p,{requestId:randomUUID(),review:c},{adapter:m.adapter});
 s=m.posts.find(p=>p.form.has('phases[1][items][0][price]'))!;assert.equal(s.form.get('phases[1][items][1][price]'),'price_capacity_mailboxes_annual');assert.equal(s.form.get('phases[1][duration][interval]'),'year');
 // Annual subscriber.
 const y=await fixture({amount:381120,interval:'year'});await pay(y);
 const r=await prepareBilling(y.u.p,{kind:'capacity',sku:'capacity-seats',quantity:1},{adapter:y.adapter});assert.equal(r.sku,'capacity-seats-annual');assert.match(r.effects.join(' '),/708,00/);
});

test('06G.2 authority, validation and failure paths',async()=>{
 const f=await fixture();await pay(f);const go=(input:unknown)=>prepareBilling(f.u.p,input,{adapter:f.adapter});
 for(const bad of [{kind:'capacity',sku:'capacity-seats'},{kind:'capacity',sku:'capacity-seats',quantity:51},{kind:'capacity',sku:'capacity-seats',quantity:-1},{kind:'capacity',sku:'capacity-seats',quantity:1.5},{kind:'capacity',sku:'capacity-linkedin',quantity:1},{kind:'capacity',sku:'essential',quantity:1},{kind:'capacity',sku:'capacity-seats',quantity:0},{kind:'capacity',sku:'capacity-seats',quantity:1,amount:1}])
  await assert.rejects(go(bad),{status:422},JSON.stringify(bad));
 await assert.rejects(go({kind:'checkout',sku:'capacity-seats'}),{status:422},'not a checkout');
 const other=await billingUser();await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),f.u.p.workspaceId,other.p.userId,'operator']));
 await assert.rejects(prepareBilling({...other.p,workspaceId:f.u.p.workspaceId,role:'operator'},{kind:'capacity',sku:'capacity-seats',quantity:1},{adapter:f.adapter}),{status:403});
 const trial=await billingUser();await beginTrial(trial.p);await assert.rejects(prepareBilling(trial.p,{kind:'capacity',sku:'capacity-seats',quantity:1},{adapter:f.adapter}),{status:409},'needs a subscription');
 // One operation at a time, and a voided invoice fails it without granting.
 const r1=await go({kind:'capacity',sku:'capacity-whatsapp',quantity:1}),r2=await go({kind:'capacity',sku:'capacity-mailboxes',quantity:1});
 const inv=rid('in');f.sub.latest_invoice=inv;await confirmBilling(f.u.p,{requestId:randomUUID(),review:r1},{adapter:f.adapter});
 await assert.rejects(confirmBilling(f.u.p,{requestId:randomUUID(),review:r2},{adapter:f.adapter}),{status:409,code:'BILLING_OPERATION_PENDING'});
 f.voidInvoice(inv);f.sub.latest_invoice=f.invoice.id;await deliver(f,'customer.subscription.pending_update_expired',{id:f.subid,customer:f.customer});
 assert.equal((await opState(f)).state,'failed');assert.equal((await readBilling(f.u.p)).capacity?.whatsapp,2);
 // A refund of the add-on invoice needs attention but keeps the period's franchise.
 const g=await fixture();await pay(g);g.newPayment();await buy(g,'mailboxes',1);
 g.refund();await deliver(g,'charge.refunded',{id:'ch_fixture',customer:g.customer});
 const v=await readBilling(g.u.p);assert.equal(v.status,'attention');assert.equal(v.balances.find(b=>b.unit==='extractions')?.plan,5000,'franchise kept');
 assert.equal(v.capacityExtras.mailboxes.active,0,'the refunded add-on is withdrawn');
});

test('06G.2 review: a stale period stops changes; an add-on invoice never moves the period',async()=>{
 const f=await fixture();await pay(f);
 const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-mailboxes',quantity:1},{adapter:f.adapter});
 const before=(await testAdmin(c=>c.query('SELECT period_start FROM app.billing_account WHERE workspace_id=$1',[f.u.p.workspaceId]))).rows[0].period_start;
 // Stripe rolled the period; the renewal invoice has not arrived.
 const start=f.sub.items.data[0].current_period_end;for(const i of f.sub.items.data)Object.assign(i,{current_period_start:start,current_period_end:start+30*DAY});
 await assert.rejects(prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-mailboxes',quantity:1},{adapter:f.adapter}),{status:409});
 await assert.rejects(prepareBilling(f.u.p,{kind:'upgrade',sku:'pro'},{adapter:f.adapter}),{status:409});
 const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r},{adapter:f.adapter});assert.equal(op.state,'failed','the worker refuses too');
 // An approved add-on invoice that arrives in a rolled period leaves the period for the renewal.
 const g=await fixture();await pay(g);const r2=await prepareBilling(g.u.p,{kind:'capacity',sku:'capacity-mailboxes',quantity:1},{adapter:g.adapter});const inv=rid('in');g.sub.latest_invoice=inv;await confirmBilling(g.u.p,{requestId:randomUUID(),review:r2},{adapter:g.adapter});
 g.setExtra('mailboxes',1);const s2=g.sub.items.data[0].current_period_end;for(const i of g.sub.items.data)Object.assign(i,{current_period_start:s2,current_period_end:s2+30*DAY});
 Object.assign(g.invoice,{id:inv,billing_reason:'subscription_update',amount_due:2500,amount_paid:2500,lines:{has_more:false,data:[g.line('price_capacity_mailboxes',2500,s2,s2+30*DAY)]}});
 const old=(await testAdmin(c=>c.query('SELECT period_start FROM app.billing_account WHERE workspace_id=$1',[g.u.p.workspaceId]))).rows[0].period_start;
 await pay(g);assert.deepEqual((await testAdmin(c=>c.query('SELECT period_start FROM app.billing_account WHERE workspace_id=$1',[g.u.p.workspaceId]))).rows[0].period_start,old);
 assert.ok(before);
});

test('06G.2 review: a paid add-on whose event lost the race to the renewal still completes',async()=>{
 const f=await fixture();await pay(f);f.setPreview(2500);const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-seats',quantity:1},{adapter:f.adapter});
 const inv=rid('in');f.sub.latest_invoice=inv;await confirmBilling(f.u.p,{requestId:randomUUID(),review:r},{adapter:f.adapter});
 f.setExtra('seats',1);Object.assign(f.invoice,{id:inv,billing_reason:'subscription_update',amount_due:2500,amount_paid:2500});
 const paid={...f.invoice};f.store(paid);renew(f);const later=f.invoice.id;await pay(f);assert.equal((await opState(f)).state,'completed');
 assert.equal((await readBilling(f.u.p)).capacityExtras.seats.active,1);assert.ok(paid.id!==later);
});

test('06G.2 review: a reduction holds the limit before Stripe is called and is released if it fails',async()=>{
 const f=await fixture();await pay(f);await buy(f,'whatsapp',2);
 const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:1},{adapter:f.adapter});let held:any=null;
 f.onPost(async()=>{held=(await testAdmin(c=>c.query('SELECT capacity_scheduled FROM app.billing_account WHERE workspace_id=$1',[f.u.p.workspaceId]))).rows[0].capacity_scheduled;});f.failNext(400);
 const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r},{adapter:f.adapter});assert.equal(op.state,'failed');
 assert.deepEqual(held,{whatsapp:1},'held during the call');assert.equal((await readBilling(f.u.p)).capacityExtras.whatsapp.scheduled,null,'released');
});

test('06G.2 review: an interrupted purchase is read back once; an unapproved quantity is not adopted',async()=>{
 const f=await fixture();await pay(f);f.setPreview(2500);const r=await prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-whatsapp',quantity:1},{adapter:f.adapter});
 f.failNext(500);const inv=rid('in');f.sub.latest_invoice=inv;const op=await confirmBilling(f.u.p,{requestId:randomUUID(),review:r},{adapter:f.adapter});assert.equal(op.state,'uncertain');
 const posts=f.posts.filter(p=>p.form.has('items[0][price]')).length;f.setExtra('whatsapp',1);
 await testAdmin(c=>c.query('UPDATE app.billing_operation SET retry_at=now()-interval \'1 minute\' WHERE workspace_id=$1 AND id=$2',[f.u.p.workspaceId,op.id]));
 await processBillingOperation(op.id,f.adapter);assert.equal((await opState(f)).state,'awaiting_payment');assert.equal(f.posts.filter(p=>p.form.has('items[0][price]')).length,posts,'no second charge');
 // Someone set the quantity in Stripe between review and confirmation.
 const g=await fixture();await pay(g);const r2=await prepareBilling(g.u.p,{kind:'capacity',sku:'capacity-seats',quantity:2},{adapter:g.adapter});g.setExtra('seats',2);
 assert.equal((await confirmBilling(g.u.p,{requestId:randomUUID(),review:r2},{adapter:g.adapter})).state,'failed');
});

test('06G.2 review: full journeys with add-ons: upgrade, scheduled change, annual, mailboxes and seats',async()=>{
 // Upgrade keeps the add-on through a paid proration.
 const u=await fixture();await pay(u);await buy(u,'whatsapp',1);u.setPreview(50000);const up=await prepareBilling(u.u.p,{kind:'upgrade',sku:'pro'},{adapter:u.adapter});
 const inv=rid('in');u.sub.latest_invoice=inv;await confirmBilling(u.u.p,{requestId:randomUUID(),review:up},{adapter:u.adapter});
 const plan=u.sub.items.data.find((i:any)=>i.id==='si_plan');plan.price=priceOf('price_pro',89700,'month');
 Object.assign(u.invoice,{id:inv,billing_reason:'subscription_update',amount_due:50000,amount_paid:50000,lines:{has_more:false,data:[u.line('price_pro',50000,plan.current_period_start,plan.current_period_end)]}});await pay(u);
 let v=await readBilling(u.u.p);assert.equal(v.plan,'pro');assert.equal(v.capacity?.whatsapp,4,'3 of Pro plus the add-on');
 // A scheduled cycle change with add-ons, invoiced as an update: the renewal applies both.
 const m=await fixture();await pay(m);await buy(m,'mailboxes',1);const c=await prepareBilling(m.u.p,{kind:'downgrade',sku:'essential-annual'},{adapter:m.adapter});await confirmBilling(m.u.p,{requestId:randomUUID(),review:c},{adapter:m.adapter});
 const start=m.sub.items.data[0].current_period_end,end=start+365*DAY;m.sub.items.data=[{id:'si_plan',quantity:1,price:priceOf('price_essential_annual',381120,'year'),current_period_start:start,current_period_end:end},{id:'si_mailboxes',quantity:1,price:priceOf('price_capacity_mailboxes_annual',22800,'year'),current_period_start:start,current_period_end:end}];
 Object.assign(m.invoice,{id:rid('in'),billing_reason:'subscription_update',amount_due:403920,amount_paid:403920,lines:{has_more:false,data:[m.line('price_essential_annual',381120,start,end),m.line('price_capacity_mailboxes_annual',22800,start,end)]}});m.sub.latest_invoice=m.invoice.id;await pay(m);
 v=await readBilling(m.u.p);assert.equal(v.interval,'year');assert.equal(v.nextPlan,null);assert.equal(v.capacity?.mailboxes,4);
 // Annual: paid add-on, reduction, renewal.
 const y=await fixture({amount:381120,interval:'year'});await pay(y);await buy(y,'seats',2,30000);assert.equal((await readBilling(y.u.p)).capacity?.seats,4);
 const z=await prepareBilling(y.u.p,{kind:'capacity',sku:'capacity-seats',quantity:1},{adapter:y.adapter});await confirmBilling(y.u.p,{requestId:randomUUID(),review:z},{adapter:y.adapter});y.setExtra('seats',1);
 await deliver(y,'customer.subscription.updated',{id:y.subid,customer:y.customer});assert.equal((await readBilling(y.u.p)).capacity?.seats,3);renew(y);await pay(y);assert.deepEqual((await readBilling(y.u.p)).capacityExtras.seats,{active:1,scheduled:null});
 // A renewal must carry each item at its quantity, not only the right total.
 const w=await fixture();await pay(w);w.setExtra('seats',2);renew(w);w.invoice.lines.data[1].quantity=1;await pay(w,'pending');assert.equal((await readBilling(w.u.p)).capacity?.seats,2);
 // Mailboxes and seats reach the guards.
 const g=await fixture();await pay(g);await buy(g,'mailboxes',1);await buy(g,'seats',1);
 const mail=()=>withWorkspaceTransaction(g.u.p,c=>c.query("INSERT INTO app.channel_connection(workspace_id,id,channel,provider,name,public_id,identifiers,created_by) VALUES($1,$2,'EMAIL','smtp-imap','QA',$2,'{}',$3)",[g.u.p.workspaceId,randomUUID(),g.u.p.userId]));
 for(let i=0;i<4;i++)await mail();await assert.rejects(mail(),{code:'BILLING_CAPACITY'});
 await identityAction(g.u.headers,{type:'invite',email:'a@cadence.example',role:'operator'});await identityAction(g.u.headers,{type:'invite',email:'b@cadence.example',role:'operator'});
 await assert.rejects(identityAction(g.u.headers,{type:'invite',email:'c@cadence.example',role:'operator'}),/capacidade|BILLING_CAPACITY/i);
});
