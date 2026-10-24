import 'server-only';
import {createHash} from 'node:crypto';
import {BILLING_VERSION,getPlan,getSku} from '../../domain/billing.ts';
import {billingPool} from './db.ts';
import {billingConfig} from './config.ts';
import {verifyStripeEvent} from './signature.ts';
import {createStripeAdapter,type StripeAdapter,stripeId,stripeUrl} from './stripe.ts';
const id=(v:any):string|null=>typeof v==='string'?v:v?.id??null;
const ensure=(ok:unknown):void=>{if(!ok)throw Error('BILLING_REMOTE_MISMATCH');};
export async function receiveBillingEvent(bytes:Uint8Array,header:string|null){
 const e=verifyStripeEvent(bytes,header,billingConfig().webhookSecret),customer=id(e.data.object.customer);
 if(!/^(checkout\.session\.(completed|async_payment_succeeded|async_payment_failed|expired)|customer\.subscription\.(created|updated|deleted|pending_update_expired|pending_update_applied)|invoice\.(paid|payment_failed|payment_action_required)|charge\.(refunded|dispute\.(created|updated|closed)))$/.test(e.type))return e.id;
 return enqueue({id:e.id,type:e.type,object_id:e.data.object.id,customer_id:customer,created:e.created,body_hash:createHash('sha256').update(bytes).digest('hex')});
}
async function enqueue(e:any){return (await billingPool().query('SELECT app.billing_receive_event($1) AS id',[e])).rows[0].id as string;}
export async function enqueueReconciliation(customer:string,object:string,type='billing.reconcile'){
 stripeId(customer,'cus');const key='sync:'+customer+':'+object+':'+Math.floor(Date.now()/300000);
 return enqueue({id:key,type,object_id:object,customer_id:customer,created:Math.floor(Date.now()/1000),body_hash:createHash('sha256').update(key).digest('hex')});
}
async function healthyPayment(pi:string,adapter:StripeAdapter){const p=await adapter.readPayment(pi);ensure(p.id===pi&&p.status==='succeeded'&&p.currency==='brl'&&p.latest_charge&&typeof p.latest_charge==='object');return !p.latest_charge.disputed&&!p.latest_charge.refunded&&!p.latest_charge.amount_refunded;}
export async function subscriptionSnapshot(a:any,subId:string,adapter:StripeAdapter){
 const s=await adapter.readSubscription(subId);ensure(s.id===subId&&id(s.customer)===a.customer_id&&s.metadata?.workspace_id===a.workspace_id&&s.metadata?.catalog_version===BILLING_VERSION);
 ensure(!s.items?.has_more&&s.items?.data?.length===1);const item=s.items.data[0],price=item.price;
 ensure(item.quantity===1&&price.currency==='brl'&&price.recurring?.interval==='month'&&(price.recurring.interval_count??1)===1);
 const plan=price.unit_amount===39700?'essential':price.unit_amount===89700?'pro':null;ensure(plan);const offer=getPlan(plan!);
 const start=item.current_period_start,end=item.current_period_end;ensure(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start<end);
 const pending=(await billingPool().query("SELECT id,sku,proof,result FROM app.billing_operation WHERE workspace_id=$1 AND kind='upgrade' AND remote_id=$2 AND state='awaiting_payment' ORDER BY created_at DESC LIMIT 1",[a.workspace_id,s.id])).rows[0];
 let expiry:Record<string,string>={};
 if(pending?.result?.invoiceId&&!s.pending_update&&pending.sku!==plan){const previous=await adapter.readInvoice(stripeId(pending.result.invoiceId,'in'));ensure(id(previous.customer)===a.customer_id&&id(previous.parent?.subscription_details?.subscription)===s.id);if(previous.status==='void')expiry={upgrade_expired_operation_id:pending.id,expired_invoice_id:previous.id};}
 const base={kind:'subscription',subscription_id:s.id,plan,status:s.status,period_start:start,period_end:end,cancel_at_period_end:!!s.cancel_at_period_end,paid:false,...expiry};
 if(!s.latest_invoice||!['active','past_due'].includes(s.status))return base;
 const inv=await adapter.readInvoice(stripeId(id(s.latest_invoice),'in'));
 ensure(inv.id===id(s.latest_invoice)&&id(inv.customer)===a.customer_id&&inv.currency==='brl'&&id(inv.parent?.subscription_details?.subscription)===s.id);
 if(inv.status!=='paid'||inv.amount_paid!==inv.amount_due||inv.amount_remaining!==0||!(inv.amount_paid>0))return {...base,invoice:invoiceView(inv,s.id)};
 ensure(!inv.lines?.has_more&&inv.lines?.data?.some((line:any)=>line.quantity===1&&line.pricing?.price_details?.price===price.id&&line.period?.end===end&&line.amount>0));
 if(inv.billing_reason==='subscription_update'){
  const approved=(await billingPool().query("SELECT id,proof FROM app.billing_operation WHERE workspace_id=$1 AND kind='upgrade' AND sku=$2 AND result->>'invoiceId'=$3 AND state IN('awaiting_payment','completed') ORDER BY created_at DESC LIMIT 1",[a.workspace_id,plan,inv.id])).rows[0];
  ensure(approved&&approved.proof.amount===inv.amount_due);
 }else ensure(['subscription_create','subscription_cycle'].includes(inv.billing_reason)&&inv.amount_due===offer.amount&&inv.lines.data.length===1&&inv.lines.data[0].period.start===start);
 ensure(!inv.payments?.has_more);const paid=inv.payments?.data?.filter((p:any)=>p.status==='paid'&&p.payment?.type==='payment_intent');ensure(paid?.length===1);const pi=stripeId(id(paid[0].payment.payment_intent),'pi');
 if(!await healthyPayment(pi,adapter))return {kind:'freeze',payment_intent:pi};
 return {...base,paid:s.status==='active',invoice_id:inv.id,payment_intent:pi,invoice:invoiceView(inv,s.id),...(inv.billing_reason==='subscription_update'&&pending?.result?.invoiceId===inv.id&&pending.sku===plan?{upgrade_paid_operation_id:pending.id}:{})};
}
function invoiceView(v:any,sub:string){return {id:v.id,subscription_id:sub,status:v.status,amount:v.amount_paid??0,url:v.hosted_invoice_url?stripeUrl(v.hosted_invoice_url,'invoice'):null,created:v.created};}
async function checkoutSnapshot(a:any,sessionId:string,adapter:StripeAdapter){
 const s=await adapter.readCheckout(sessionId);ensure(s.id===sessionId&&id(s.customer)===a.customer_id);
 const m=s.metadata;ensure(m?.workspace_id===a.workspace_id&&m.catalog_version===BILLING_VERSION);
 const o=(await billingPool().query('SELECT * FROM app.billing_operation WHERE workspace_id=$1 AND id=$2',[a.workspace_id,m.operation_id])).rows[0];ensure(o&&o.kind==='checkout'&&o.sku===m.sku&&o.remote_id===s.id);
 if(s.status==='expired')return {kind:'expired',session_id:s.id};
 if(s.status!=='complete'||s.payment_status!=='paid')return {};
 const offer=getSku(String(m.sku));ensure(s.currency==='brl'&&s.amount_total===offer.amount&&!s.line_items?.has_more&&s.line_items?.data?.length===1&&s.line_items.data[0].quantity===1&&s.line_items.data[0].amount_total===offer.amount);
 if('cycle' in offer){ensure(s.mode==='subscription');return {...await subscriptionSnapshot(a,stripeId(id(s.subscription),'sub'),adapter),approved_operation_id:o.id,approved_session_id:s.id};}
 ensure(s.mode==='payment'&&offer.available);const pi=stripeId(id(s.payment_intent),'pi');
 if(!await healthyPayment(pi,adapter))return {kind:'freeze',payment_intent:pi};
 return {kind:'pack',sku:offer.code,payment_id:s.id,payment_intent:pi,operation_id:o.id};
}
export async function processBillingEvent(eventId?:string,adapter:StripeAdapter=createStripeAdapter()):Promise<boolean>{
 const e=(await billingPool().query('SELECT app.billing_claim_event($1) AS event',[eventId??null])).rows[0].event;if(!e)return false;
 let data:any={},error:string|null=null;
 try{
  const a=e.account;
  if(!a&&!e.customer_id&&(e.type==='charge.refunded'||e.type.startsWith('charge.dispute.'))){
   let chargeId=e.object_id;if(e.type.startsWith('charge.dispute.'))chargeId=stripeId(id((await adapter.readDispute(stripeId(e.object_id,'dp'))).charge),'ch');
   const charge=await adapter.readCharge(stripeId(chargeId,'ch')),customer=stripeId(id(charge.customer),'cus');
   const bound=(await billingPool().query('SELECT app.billing_bind_event_customer($1,$2,$3) AS bound',[e.id,e.lease_token,customer])).rows[0].bound;
   if(bound){await processBillingEvent(e.id,adapter);return true;}
  }
  if(!a)throw Error('CUSTOMER_NOT_MAPPED');
  if(e.type.startsWith('checkout.session.')||e.type==='billing.checkout')data=await checkoutSnapshot(a,stripeId(e.object_id,'cs'),adapter);
  else if(e.type.startsWith('customer.subscription.'))data=await subscriptionSnapshot(a,stripeId(e.object_id,'sub'),adapter);
  else if(e.type.startsWith('invoice.')){
   const invoice=await adapter.readInvoice(stripeId(e.object_id,'in'));ensure(id(invoice.customer)===a.customer_id);
   data=await subscriptionSnapshot(a,stripeId(id(invoice.parent?.subscription_details?.subscription),'sub'),adapter);
  }else if(e.type==='billing.reconcile'&&a.subscription_id)data=await subscriptionSnapshot(a,a.subscription_id,adapter);
  else if(e.type==='charge.refunded'||e.type.startsWith('charge.dispute.')){
   let chargeId=e.object_id;
   if(e.type.startsWith('charge.dispute.')){const d=await adapter.readDispute(stripeId(e.object_id,'dp'));chargeId=stripeId(id(d.charge),'ch');}
   const c=await adapter.readCharge(stripeId(chargeId,'ch'));ensure(id(c.customer)===a.customer_id);
   if(c.disputed||c.refunded||c.amount_refunded>0)data={kind:'freeze',payment_intent:stripeId(id(c.payment_intent),'pi')};
  }
  if(data.kind==='subscription'&&a.subscription_id&&a.subscription_id!==data.subscription_id&&!data.approved_operation_id){
   const retired=(await billingPool().query('SELECT 1 FROM app.billing_subscription_history WHERE workspace_id=$1 AND subscription_id=$2',[a.workspace_id,data.subscription_id])).rowCount;
   if(retired)data={};
   else{
    const checkout=(await billingPool().query("SELECT remote_id FROM app.billing_operation WHERE workspace_id=$1 AND kind='checkout' AND sku IN('essential','pro') AND state='awaiting_payment' AND remote_id IS NOT NULL LIMIT 1",[a.workspace_id])).rows[0];
    if(!checkout)throw Error('UNAPPROVED_SUBSCRIPTION');
    const replacement:any=await checkoutSnapshot(a,checkout.remote_id,adapter);
    if(replacement.kind!=='subscription'||replacement.subscription_id!==data.subscription_id)throw Error('CHECKOUT_NOT_CONFIRMED');data=replacement;
   }
  }
 }catch{error='REMOTE_RECONCILIATION_REQUIRED';}
 let r;try{r=await billingPool().query('SELECT app.billing_apply_event($1,$2,$3,$4) AS saved',[e.id,e.lease_token,data,error]);}
 catch{r=await billingPool().query('SELECT app.billing_apply_event($1,$2,$3,$4) AS saved',[e.id,e.lease_token,{},'APPLY_RECONCILIATION_REQUIRED']);}
 if(!r.rows[0].saved)throw Error('Billing event lease lost.');return true;
}
