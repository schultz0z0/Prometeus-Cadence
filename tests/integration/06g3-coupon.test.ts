import test,{after} from 'node:test';import assert from 'node:assert/strict';import {createHmac,randomUUID} from 'node:crypto';
import {billingUser,testAdmin,beginTrial} from './billing-helpers.ts';
import {getPools} from '../../src/server/db/pool.ts';
import {closeBillingPool} from '../../src/server/billing/db.ts';
import {createStripeAdapter} from '../../src/server/billing/stripe.ts';
import {billingConfig} from '../../src/server/billing/config.ts';
import {receiveBillingEvent,processBillingEvent} from '../../src/server/billing/events.ts';
import {readBilling} from '../../src/server/billing/repository.ts';
import {BILLING_VERSION} from '../../src/domain/billing.ts';
import {withWorkspaceTransaction} from '../../src/server/db/transaction.ts';
import {prepareBilling,confirmBilling} from '../../src/server/billing/operations.ts';
import {saveCoupon,releaseCoupon,parseCouponArgs} from '../../scripts/billing-coupon.mjs';
Object.assign(process.env,{STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture'});
after(async()=>{await closeBillingPool();await getPools().close();});
const event=(type:string,obj:any,id='evt_'+randomUUID().replaceAll('-',''))=>{const bytes=Buffer.from(JSON.stringify({id,type,created:Math.floor(Date.now()/1000),livemode:false,data:{object:obj}})),t=Math.floor(Date.now()/1000);return{id,bytes,header:`t=${t},v1=`+createHmac('sha256','whsec_fixture').update(t+'.').update(bytes).digest('hex')};};
const rid=(p:string)=>p+'_'+randomUUID().replaceAll('-','');
const code=()=>'QA-'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase();
const week=()=>new Date(Date.now()+7*86400000);
async function fixture(remote:any={valid:true,percent_off:10,amount_off:null,currency:null}){
 const u=await billingUser(),customer=rid('cus'),pi=rid('pi'),session=rid('cs');await beginTrial(u.p);
 await testAdmin(c=>c.query("UPDATE app.billing_account SET customer_id=$2,state='active',plan='essential' WHERE workspace_id=$1",[u.p.workspaceId,customer]));
 const posts:{path:string;form:URLSearchParams}[]=[];let failCheckout=0,paid:any=null,checkoutMeta:any={},status='open',piStatus='succeeded',paymentStatus='unpaid';
 const adapter=createStripeAdapter(async(input,init)=>{const url=new URL(String(input)),path=url.pathname,form=new URLSearchParams(String(init?.body));
  if(init?.method==='POST'){posts.push({path,form});
   if(path.endsWith('/checkout/sessions')){if(failCheckout){const code=failCheckout;failCheckout=0;return new Response('{}',{status:code});}checkoutMeta=Object.fromEntries(form);return Response.json({id:session,url:'https://checkout.stripe.com/c/x'});}
   throw Error('Unexpected POST '+path);}
  if(path.includes('/coupons/'))return remote===null?new Response('{}',{status:404}):Response.json({id:path.split('/').at(-1),...remote});
  if(path.includes('/checkout/sessions/'))return Response.json({id:session,customer,status,payment_status:paymentStatus,mode:'payment',currency:'brl',payment_intent:pi,metadata:{workspace_id:u.p.workspaceId,operation_id:checkoutMeta['metadata[operation_id]'],catalog_version:BILLING_VERSION,sku:checkoutMeta['metadata[sku]']},...paid});
  if(path.includes('/payment_intents/'))return Response.json({id:pi,status:piStatus,currency:'brl',latest_charge:{id:'ch_fixture',disputed:false,refunded:piStatus==='refunded',amount_refunded:piStatus==='refunded'?1:0}});
  if(path.includes('/charges/'))return Response.json({id:'ch_fixture',customer,payment_intent:pi,refunded:true,amount_refunded:1,disputed:false});
  throw Error('Unexpected GET '+path);
 },billingConfig());
 return {u,customer,session,posts,adapter,remote:(next:any)=>{Object.assign(remote,next);},failCheckout:(code=400)=>{failCheckout=code;},lapse:()=>{status='complete';paymentStatus='unpaid';piStatus='requires_payment_method';},processing:()=>{status='complete';paymentStatus='unpaid';piStatus='processing';},refund:()=>{piStatus='refunded';},pay:(total:number,subtotal=9700)=>{status='complete';paymentStatus='paid';paid={amount_total:total,line_items:{has_more:false,data:[{quantity:1,amount_total:total,amount_subtotal:subtotal}]}};},expire:()=>{status='expired';}};
}
type F=Awaited<ReturnType<typeof fixture>>;
const coupon=async(o:{code?:string;stripe?:string;until?:Date;max?:number;active?:boolean}={})=>{const value=o.code??code();await testAdmin(c=>saveCoupon(c,{code:value,stripeCoupon:o.stripe??'qa_coupon',validUntil:o.until??week(),maxUses:o.max??10,active:o.active??true}));return value;};
const prepare=(f:F,value:string,sku='extractions-2000')=>prepareBilling(f.u.p,{kind:'checkout',sku,coupon:value},{adapter:f.adapter});
const confirm=(f:F,review:any)=>confirmBilling(f.u.p,{requestId:randomUUID(),review},{adapter:f.adapter});
const deliver=async(f:F,type:string,expected='done',object=f.session)=>{const e=event(type,{id:object,customer:f.customer});await receiveBillingEvent(e.bytes,e.header);await processBillingEvent(e.id,f.adapter);assert.equal((await testAdmin(c=>c.query('SELECT state FROM app.billing_event_inbox WHERE id=$1',[e.id]))).rows[0].state,expected,type);};
const claims=async(value:string)=>(await testAdmin(c=>c.query('SELECT workspace_id,state FROM app.billing_coupon_claim WHERE code=$1',[value]))).rows;
const invalid={status:422,code:'BILLING_COUPON_INVALID'};
const purchased=async(f:F)=>(await readBilling(f.u.p)).balances.find(b=>b.unit==='extractions')?.purchased;

test('06G.3 a valid coupon: reviewed total, discounted session, full credits, one use',async()=>{
 const f=await fixture(),value=await coupon({stripe:'qa_ten'});
 const r=await prepare(f,value.toLowerCase());assert.equal(r.amount,8730);assert.equal(r.coupon,value);assert.match(r.effects.join(' '),/97,00.*87,30/);
 for(const tampered of [{amount:100},{couponId:'other'},{coupon:'OTHER-CODE'},{coupon:undefined,couponId:undefined}])await assert.rejects(confirm(f,{...r,...tampered}),{code:'REVIEW_CHANGED'},JSON.stringify(tampered));
 const before=await prepareBilling(f.u.p,{kind:'checkout',sku:'extractions-2000'},{adapter:f.adapter});assert.equal(before.amount,9700,'no code, no discount');
 const op=await confirm(f,r);assert.equal(op.state,'awaiting_payment');
 const created=f.posts.find(p=>p.path.endsWith('/checkout/sessions'))!;assert.equal(created.form.get('discounts[0][coupon]'),'qa_ten');assert.equal(created.form.get('line_items[0][price_data][unit_amount]'),'9700','the discount is the provider\'s');
 assert.equal((await claims(value))[0].state,'claimed');assert.equal(await purchased(f),0,'no credits before payment');
 f.pay(8730);await deliver(f,'checkout.session.completed');
 assert.equal(await purchased(f),2000,'the pack quantity does not shrink');assert.equal((await claims(value))[0].state,'redeemed');
 await deliver(f,'checkout.session.completed');assert.equal(await purchased(f),2000,'replay');
 await assert.rejects(prepare(f,value),invalid,'once per workspace');
});

test('06G.3 every refused code gives the same answer and claims nothing',async()=>{
 const f=await fixture();
 const cases=[code(),await coupon({active:false}),await coupon({until:new Date(Date.now()-1000)}),'x','tem espaço',"a'b"];
 for(const value of cases)await assert.rejects(prepare(f,value),invalid,value);
 const used=await coupon({max:1}),other=await fixture();await confirm(other,await prepare(other,used));await assert.rejects(prepare(f,used),invalid,'exhausted');
 // Refused at the provider.
 for(const remote of [{valid:false,percent_off:10,amount_off:null,currency:null},{valid:true,percent_off:null,amount_off:100,currency:'usd'},{valid:true,percent_off:100,amount_off:null,currency:null}]){
  const g=await fixture(remote),value=await coupon();await assert.rejects(prepare(g,value),invalid,JSON.stringify(remote));assert.equal((await claims(value)).length,0);
 }
 const gone=await fixture(null);await assert.rejects(prepare(gone,await coupon()),invalid,'deleted at the provider: the same answer');
 // Only packs.
 const value=await coupon();
 await assert.rejects(prepare(f,value,'essential'),{status:422});await assert.rejects(prepare(f,value,'pro-annual'),{status:422});
 await assert.rejects(prepareBilling(f.u.p,{kind:'capacity',sku:'capacity-seats',quantity:1,coupon:value},{adapter:f.adapter}),{status:422});
 await assert.rejects(prepare(f,value,'enrichment-50'),{status:409},'not on sale');
 assert.equal((await claims(value)).length,0);
});

test('06G.3 the last use goes to one workspace; an open review guarantees nothing',async()=>{
 const value=await coupon({max:1}),a=await fixture(),b=await fixture();
 const ra=await prepare(a,value),rb=await prepare(b,value);
 const results=await Promise.allSettled([confirm(a,ra),confirm(b,rb)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((results.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'BILLING_COUPON_INVALID');assert.equal((await claims(value)).length,1);
 // Expired between review and confirmation.
 const late=await coupon(),c=await fixture(),r=await prepare(c,late);await testAdmin(x=>x.query("UPDATE app.billing_coupon SET valid_until=now()-interval '1 minute' WHERE code=$1",[late]));await assert.rejects(confirm(c,r),invalid);
});

test('06G.3 a paid session that does not match the review grants nothing',async()=>{
 for(const [total,subtotal] of [[100,9700],[8000,9700],[8730,8730],[9700,9700]]){
  const f=await fixture(),value=await coupon();await confirm(f,await prepare(f,value));f.pay(total,subtotal);await deliver(f,'checkout.session.completed','pending');assert.equal(await purchased(f),0,total+'/'+subtotal);assert.equal((await claims(value))[0].state,'claimed');
 }
 // Rounding by the provider is tolerated.
 const f=await fixture(),value=await coupon();await confirm(f,await prepare(f,value));f.pay(8731);await deliver(f,'checkout.session.completed');assert.equal(await purchased(f),2000);
 // Without a coupon a discount is a divergence.
 const g=await fixture();await confirmBilling(g.u.p,{requestId:randomUUID(),review:await prepareBilling(g.u.p,{kind:'checkout',sku:'extractions-2000'},{adapter:g.adapter})},{adapter:g.adapter});g.pay(8730);await deliver(g,'checkout.session.completed','pending');assert.equal(await purchased(g),0);
});

test('06G.3 an expired session or a provider refusal returns the use',async()=>{
 const value=await coupon({max:1}),f=await fixture();await confirm(f,await prepare(f,value));
 f.expire();await deliver(f,'checkout.session.expired');assert.equal((await claims(value)).length,0);
 const g=await fixture();g.failCheckout();const op=await confirm(g,await prepare(g,value));assert.equal(op.state,'failed');assert.equal((await claims(value)).length,0);
 const h=await fixture();assert.equal((await confirm(h,await prepare(h,value))).state,'awaiting_payment');assert.equal((await claims(value)).length,1);
});

test('06G.3 authority: operators are refused and the tables stay closed',async()=>{
 const f=await fixture(),value=await coupon(),other=await billingUser();
 await testAdmin(c=>c.query('INSERT INTO auth.member(id,"organizationId","userId",role,"createdAt") VALUES($1,$2,$3,$4,now())',[randomUUID(),f.u.p.workspaceId,other.p.userId,'operator']));
 const operator={...other.p,workspaceId:f.u.p.workspaceId,role:'operator' as const};
 await assert.rejects(prepareBilling(operator,{kind:'checkout',sku:'extractions-2000',coupon:value},{adapter:f.adapter}),{status:403});
 await assert.rejects(withWorkspaceTransaction(f.u.p,c=>c.query('SELECT app.billing_check_coupon($1)',['X'])),/BILLING_COUPON_INVALID/,'the owner gets the generic refusal only');
 for(const table of ['billing_coupon','billing_coupon_claim'])await assert.rejects(withWorkspaceTransaction(f.u.p,c=>c.query('SELECT * FROM app.'+table)),{code:'42501'},table);
 await assert.rejects(withWorkspaceTransaction(operator,c=>c.query('SELECT app.billing_check_coupon($1)',[value])),/FORBIDDEN/);
 // The operator script validates what it stores.
 await assert.rejects(testAdmin(c=>saveCoupon(c,{code:'x',stripeCoupon:'a',validUntil:week(),maxUses:1})),/código/i);
 await assert.rejects(testAdmin(c=>saveCoupon(c,{code:'VALID',stripeCoupon:'a-b',validUntil:week(),maxUses:1})),/Stripe/);
 await assert.rejects(testAdmin(c=>saveCoupon(c,{code:'VALID',stripeCoupon:'a',validUntil:week(),maxUses:0})),/usos/);
});

test('06G.3 review: a lapsed payment returns the use; one still processing keeps it; a refund does not',async()=>{
 const value=await coupon({max:1}),f=await fixture();await confirm(f,await prepare(f,value));
 f.processing();await deliver(f,'checkout.session.completed');assert.equal((await claims(value)).length,1,'a boleto may still be paid');
 f.lapse();await deliver(f,'checkout.session.async_payment_failed');assert.equal((await claims(value)).length,0);
 assert.equal((await testAdmin(c=>c.query("SELECT state FROM app.billing_operation WHERE workspace_id=$1 AND kind='checkout'",[f.u.p.workspaceId]))).rows[0].state,'failed');
 // The webhook was lost: the periodic read finds the same.
 const g=await fixture(),second=await coupon();await confirm(g,await prepare(g,second));g.lapse();await deliver(g,'checkout.session.completed');assert.equal((await claims(second)).length,0);
 // A refund does not give the use back.
 const h=await fixture(),third=await coupon();await confirm(h,await prepare(h,third));h.pay(8730);await deliver(h,'checkout.session.completed');h.refund();await deliver(h,'charge.refunded','done','ch_fixture');
 assert.equal((await claims(third))[0].state,'redeemed');
});

test('06G.3 review: the session expires soon, with the same body on a retry; an unknown result holds the use',async()=>{
 const f=await fixture(),value=await coupon();const op=await confirm(f,await prepare(f,value));assert.equal(op.state,'awaiting_payment');
 const created=(await testAdmin(c=>c.query("SELECT floor(extract(epoch FROM created_at))::bigint AS at FROM app.billing_operation WHERE workspace_id=$1 AND kind='checkout'",[f.u.p.workspaceId]))).rows[0].at;
 assert.equal(f.posts.find(p=>p.path.endsWith('/checkout/sessions'))!.form.get('expires_at'),String(Number(created)+3600));
 const plain=await fixture();await confirmBilling(plain.u.p,{requestId:randomUUID(),review:await prepareBilling(plain.u.p,{kind:'checkout',sku:'extractions-2000'},{adapter:plain.adapter})},{adapter:plain.adapter});assert.equal(plain.posts.find(p=>p.path.endsWith('/checkout/sessions'))!.form.get('expires_at'),null,'only with a coupon');
 const g=await fixture(),held=await coupon();g.failCheckout(500);const un=await confirm(g,await prepare(g,held));assert.equal(un.state,'uncertain');assert.equal((await claims(held))[0].state,'claimed');
 // The operator releases it after checking Stripe; a redeemed use stays.
 await testAdmin(c=>releaseCoupon(c,held,g.u.p.workspaceId));assert.equal((await claims(held)).length,0);
 // Closed, or a later worker pass in the same database would pick this operation up.
 await testAdmin(c=>c.query("UPDATE app.billing_operation SET state='failed' WHERE workspace_id=$1 AND id=$2",[g.u.p.workspaceId,un.id]));
 const h=await fixture(),spent=await coupon();await confirm(h,await prepare(h,spent));h.pay(8730);await deliver(h,'checkout.session.completed');await testAdmin(c=>releaseCoupon(c,spent,h.u.p.workspaceId));assert.equal((await claims(spent)).length,1);
});

test('06G.3 review: a coupon changed after the review fails before charging and returns the use',async()=>{
 const f=await fixture(),value=await coupon();const r=await prepare(f,value);f.remote({percent_off:50});
 assert.equal((await confirm(f,r)).state,'failed');assert.equal(f.posts.filter(p=>p.path.endsWith('/checkout/sessions')).length,0,'no session');assert.equal((await claims(value)).length,0);
});

test('06G.3 review: one workspace, one use, also on replay and concurrency',async()=>{
 const f=await fixture(),value=await coupon(),r=await prepare(f,value),requestId=randomUUID();
 const first=await confirmBilling(f.u.p,{requestId,review:r},{adapter:f.adapter}),again=await confirmBilling(f.u.p,{requestId,review:r},{adapter:f.adapter});assert.equal(first.id,again.id,'replay');assert.equal((await claims(value)).length,1);
 const g=await fixture(),other=await coupon(),a=await prepare(g,other),b=await prepare(g,other,'imports-5000');
 const results=await Promise.allSettled([confirm(g,a),confirm(g,b)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await claims(other)).length,1);
});

test('06G.3 review: the operator script reads the last day in Brazil and refuses mistakes',()=>{
 const future=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
 const parsed=parseCouponArgs(['BEM-VINDO',  'qa_ten',future,'100']);assert.equal(parsed.validUntil.toISOString(),new Date(future+'T23:59:59-03:00').toISOString());assert.equal(parsed.update,false);assert.equal(parsed.active,true);
 assert.equal(parseCouponArgs(['BEM-VINDO','qa_ten',future,'100','--inactive','--update']).active,false);
 for(const bad of [['A1B','c','2020-01-01','1'],['A1B','c','31/12/2099','1'],['A1B','c',future,'1','--inactiv'],['A1B','c',future,'x']])assert.throws(()=>parseCouponArgs(bad),JSON.stringify(bad));
});

test('06G.3 review: registering a code in use needs an explicit update',async()=>{
 const value=await coupon({max:1});await assert.rejects(testAdmin(c=>saveCoupon(c,{code:value,stripeCoupon:'qa_coupon',validUntil:week(),maxUses:99})),/já existe/i);
 await testAdmin(c=>saveCoupon(c,{code:value,stripeCoupon:'qa_coupon',validUntil:week(),maxUses:99,update:true}));assert.equal((await testAdmin(c=>c.query('SELECT max_uses FROM app.billing_coupon WHERE code=$1',[value]))).rows[0].max_uses,99);
});
