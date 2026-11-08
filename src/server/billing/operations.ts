import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {BILLING_VERSION,CAPACITY_MAX,CAPACITY_UNITS,capacityFromCode,capacityOffer,capacityReductionAllowed,couponAmount,couponCode,getPlan,getSku,parseSubscriptionItems,planChange,planSku,type BillingReview,type PlanOffer} from '../../domain/billing.ts';
import {AppError} from '../errors.ts';
import {createReviewToken,verifyReviewToken,hashValue} from '../prospecting/review.ts';
import {billingPool,billingTransaction,billingError} from './db.ts';
import {billingConfig} from './config.ts';
import {createStripeAdapter,StripeFailure,type StripeAdapter,stripeUrl} from './stripe.ts';
import {operationView} from './repository.ts';
const kinds=z.enum(['checkout','cancel','resume','upgrade','downgrade','payment-method','capacity']);
const quantity=z.number().int().min(0).max(CAPACITY_MAX);
const brl=(cents:number)=>(cents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}).replace(/\s/g,' ');
const inputSchema=z.strictObject({kind:kinds,sku:z.string().min(1).max(80).optional(),quantity:quantity.optional(),coupon:z.string().max(200).optional()});
const reviewSchema=z.strictObject({kind:kinds,sku:z.string().max(80).nullable(),amount:z.number().int().nonnegative(),currency:z.literal('brl'),revision:z.number().int().nonnegative(),token:z.string().min(1).max(8192),expiresAt:z.string().max(40),effects:z.array(z.string().max(500)).max(8),prorationDate:z.number().int().optional(),priceId:z.string().max(200).optional(),quantity:quantity.optional(),fromQuantity:quantity.optional(),coupon:z.string().max(40).optional(),couponId:z.string().max(100).optional()});
const confirmSchema=z.strictObject({requestId:z.uuid(),review:reviewSchema});
const signing=()=>{const s=process.env.BETTER_AUTH_SECRET;if(!s||s.length<32)throw Error('Revisão de cobrança indisponível.');return s;};
function proof(p:Principal,a:any,r:Omit<BillingReview,'token'|'expiresAt'|'effects'>){return {scope:'billing-review-v1',catalog:BILLING_VERSION,userId:p.userId,workspaceId:p.workspaceId,subscription:a.subscription_id,fromPlan:a.plan,fromInterval:a.billing_interval,...r};}
async function account(c:import('pg').PoolClient){const row=(await c.query('SELECT *,app.current_role() AS role FROM app.billing_account')).rows[0];if(!row||!['owner','admin'].includes(row.role))throw new AppError(403,'Somente proprietário ou administrador pode gerenciar cobrança.');return row;}
// A rolled period with its renewal still unprocessed: a change now would be judged against the old one.
const samePeriod=(item:any,a:any)=>item?.current_period_start===new Date(a.period_start).getTime()/1000;
const creditEligible=(a:any)=>a.state==='active'&&['essential','pro','essential-annual','pro-annual'].includes(a.plan)&&
 Boolean(a.period_start&&a.period_end&&Date.parse(a.period_start)<=Date.now()&&Date.parse(a.period_end)>Date.now());
export async function prepareBilling(p:Principal,input:unknown,deps:{adapter?:StripeAdapter}={}):Promise<BillingReview>{
 const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Operação de cobrança inválida.');if(!billingConfig().configured)throw new AppError(503,'Stripe de teste ainda não configurado.','BILLING_NOT_CONFIGURED');
 const a=await billingTransaction(p,account),b=parsed.data;
 if(b.coupon!==undefined&&b.kind!=='checkout')throw new AppError(422,'O cupom vale para pacotes de créditos.');
 let amount=0,sku:string|null=b.sku??null;let effects:string[]=[];let change:Partial<BillingReview>={};
 if(b.kind==='checkout'){
  if(!sku)throw new AppError(422,'Escolha um plano ou pacote.');let offer;try{offer=getSku(sku);}catch{throw new AppError(422,'Plano ou pacote inválido.');}
  if('cycle'in offer){if(a.subscription_id&&['active','past_due','attention'].includes(a.state))throw new AppError(409,'Altere a assinatura existente para trocar de plano.');effects=[offer.cycle==='year'?'Assinatura anual em ambiente de teste, cobrada de uma vez. A franquia renova a cada mês, sem acumular.':'Assinatura mensal em ambiente de teste.','Acesso somente após pagamento confirmado.'];}
  else {if(!offer.available)throw new AppError(409,'Este recurso ainda não está disponível para compra.');if(!creditEligible(a))throw new AppError(402,'A compra de créditos adicionais exige assinatura Essential ou Pro ativa.','BILLING_CREDITS_REQUIRES_PLAN');effects=['Compra única, sem renovação automática.','Créditos sem expiração. Na captação, você escolhe quando usá-los.'];}amount=offer.amount;
  if(b.coupon!==undefined){
   if('cycle'in offer)throw new AppError(422,'O cupom vale para pacotes de créditos.');
   const code=couponCode(b.coupon);if(!code)throw new AppError(422,'Cupom inválido, vencido ou já utilizado.','BILLING_COUPON_INVALID');
   const couponId:string=(await billingTransaction(p,c=>c.query('SELECT app.billing_check_coupon($1) AS id',[code]))).rows[0].id;
   let remote;try{remote=await (deps.adapter??createStripeAdapter()).readCoupon(couponId);}catch(e){if(e instanceof StripeFailure&&e.status===404)throw new AppError(422,'Cupom inválido, vencido ou já utilizado.','BILLING_COUPON_INVALID');throw new AppError(409,'Não foi possível validar o cupom agora. Tente novamente.');}
   const net=couponAmount(offer.amount,remote);if(net===null)throw new AppError(422,'Cupom inválido, vencido ou já utilizado.','BILLING_COUPON_INVALID');
   amount=net;change={coupon:code,couponId};effects=[`Cupom ${code}: de ${brl(offer.amount)} por ${brl(net)}.`,...effects];
  }
 }else{
  if(!a.subscription_id)throw new AppError(409,'É necessário ter uma assinatura para esta ação.');
  if(b.kind==='cancel'){sku=null;effects=['A renovação será cancelada.','O acesso permanece até o fim do período pago; dados e saldo comprado serão preservados.'];}
  else if(b.kind==='resume'){
   if(a.state!=='active'||!a.cancel_at_period_end||Date.parse(a.period_end)<=Date.now())throw new AppError(409,'A assinatura não possui uma renovação cancelada que possa ser retomada.');
   sku=null;effects=['A renovação automática da assinatura atual será retomada.',`Nenhuma cobrança imediata ou crédito adicional. A ${a.billing_interval==='year'?'anuidade':'mensalidade'} volta a ser cobrada na próxima renovação.`];
  }
  else if(b.kind==='payment-method'){sku=null;effects=['Atualize a forma de pagamento no ambiente seguro do Stripe.'];}
  else if(b.kind==='capacity'){
   const base=sku?capacityFromCode(sku):null;if(!base||b.quantity===undefined)throw new AppError(422,'Escolha um adicional e a quantidade.');
   if(a.state!=='active'||a.cancel_at_period_end||a.change_schedule_id)throw new AppError(409,'Regularize a assinatura antes de alterar os adicionais.');
   if(a.capacity_scheduled?.[base.unit]!==undefined)throw new AppError(409,'Já existe uma redução agendada para a próxima renovação.');
   const offer=capacityOffer(base.unit,a.billing_interval),adapter=deps.adapter??createStripeAdapter(),sub=await adapter.readSubscription(a.subscription_id),items=parseSubscriptionItems(sub.items?.data),current=items?.capacity[base.unit];
   if(sub.customer!==a.customer_id||sub.status!=='active'||sub.pending_update||sub.schedule||sub.items?.has_more||!items||items.sku!==planSku(a.plan,a.billing_interval)||!samePeriod(items.item,a))throw new AppError(409,'A assinatura mudou. Atualize o estado antes de alterar.');
   const from=current?.quantity??0;if(from!==(a.capacity_extra?.[base.unit]??0))throw new AppError(409,'A assinatura mudou. Atualize o estado antes de alterar.');
   if(b.quantity===from)throw new AppError(422,'Esta já é a quantidade contratada.');
   sku=offer.code;const period=offer.interval==='year'?'ano':'mês';change={quantity:b.quantity,fromQuantity:from};
   if(b.quantity>from){
    const priceId=await adapter.ensurePrice(offer.code),prorationDate=Math.floor(Date.now()/1000),preview=await adapter.previewCapacity(sub.id,current?.id??null,priceId,b.quantity,prorationDate);
    if(preview.currency!=='brl'||!Number.isSafeInteger(preview.amount_due)||preview.amount_due<=0)throw new AppError(409,'Não foi possível confirmar o valor da alteração.');
    amount=preview.amount_due;change={...change,priceId,prorationDate};effects=['Cobrança proporcional de teste, conforme esta prévia.',`${offer.name}: ${b.quantity} no total, ${brl(offer.amount)}/${period} por unidade a partir da renovação.`,'A capacidade aumenta somente após o pagamento.'];
   }else{
    const usage=(await billingTransaction(p,c=>c.query('SELECT app.billing_capacity_usage() AS usage'))).rows[0].usage,inUse=base.unit==='seats'?usage.seats+usage.pendingSeats:usage[base.unit];
    if(!capacityReductionAllowed({inUse,requested:getPlan(a.plan).capacity[base.unit]+b.quantity}))throw new AppError(409,'Há mais recursos em uso do que esta quantidade permite. Desconecte alguns antes de reduzir.','BILLING_CAPACITY_IN_USE');
    effects=['A capacidade paga permanece até a próxima renovação, sem cobrança agora.',`A partir da renovação: ${b.quantity} ${b.quantity===1?'unidade':'unidades'} de ${offer.name}, ${brl(offer.amount*b.quantity)}/${period}. Nenhum recurso é apagado.`];
   }
  }
  else {
   if(!sku||planChange(a.plan,a.billing_interval,sku)!==b.kind)throw new AppError(422,'Troca de plano inválida. Para mudar de plano e de ciclo, faça uma alteração de cada vez.');
   if(a.state!=='active'||a.cancel_at_period_end||a.change_schedule_id)throw new AppError(409,'Regularize a assinatura antes de alterar o plano.');
   const adapter=deps.adapter??createStripeAdapter(),sub=await adapter.readSubscription(a.subscription_id),items=parseSubscriptionItems(sub.items?.data),item=items?.item;
   if(sub.customer!==a.customer_id||sub.status!=='active'||sub.pending_update||sub.schedule||sub.items?.has_more||!items||items.sku!==planSku(a.plan,a.billing_interval)||!samePeriod(items.item,a))throw new AppError(409,'A assinatura mudou. Atualize o estado antes de trocar.');
   const priceId=await adapter.ensurePrice(sku);change={priceId};
   if(b.kind==='upgrade'){
    const prorationDate=Math.floor(Date.now()/1000),preview=await adapter.previewChange(sub.id,item.id,priceId,prorationDate);
    if(preview.currency!=='brl'||!Number.isSafeInteger(preview.amount_due)||preview.amount_due<=0)throw new AppError(409,'Não foi possível confirmar o valor da alteração.');
    amount=preview.amount_due;change.prorationDate=prorationDate;effects=['Cobrança proporcional de teste, conforme esta prévia.','O plano e a diferença de franquia mudam somente após o pagamento.'];
   }else{const target=getSku(sku) as PlanOffer,extras=CAPACITY_UNITS.reduce((n,u)=>n+capacityOffer(u,target.cycle).amount*(items.capacity[u]?.quantity??0),0),total=brl(target.amount+extras);effects=['O plano atual permanece até a próxima renovação, sem cobrança agora.',`${target.name} será aplicado na renovação por ${total}/${target.cycle==='year'?'ano':'mês'}${extras?', com os adicionais':''}. Dados e saldo comprado permanecem.`];}
  }
 }
 const core={kind:b.kind,sku,amount,currency:'brl' as const,revision:Number(a.revision),...change},now=Date.now();
 return {...core,effects,token:createReviewToken(proof(p,a,core),signing(),now),expiresAt:new Date(now+600000).toISOString()};
}
export async function confirmBilling(p:Principal,input:unknown,deps:{adapter?:StripeAdapter}={}){
 const parsed=confirmSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Confirmação de cobrança inválida.');const {requestId,review}=parsed.data;
 const {token,expiresAt:_expires,effects:_effects,...core}=review,hash=hashValue(core);
 let op:any;
 try{op=await billingTransaction(p,async c=>{
  const a=await account(c),prior=(await c.query('SELECT * FROM app.billing_operation WHERE request_id=$1',[requestId])).rows[0];
  if(prior){if(prior.actor_id!==p.userId||prior.body_hash!==hash)throw new AppError(409,'Este identificador já foi usado com outros dados.');return prior;}
  verifyReviewToken(token,proof(p,a,core),signing());if(Number(a.revision)!==core.revision)throw new AppError(409,'A assinatura mudou. Revise novamente.');
  return (await c.query('SELECT app.billing_prepare_operation($1,$2,$3,$4,$5,$6,$7) AS operation',[randomUUID(),requestId,hash,core.kind,core.sku,core.revision,core])).rows[0].operation;
 });}catch(e){if(e&&typeof e==='object'&&'constraint'in e&&e.constraint==='billing_subscription_operation')throw new AppError(409,'Já existe uma alteração de assinatura ou checkout em andamento.','BILLING_OPERATION_PENDING');throw e;}
 if(!['completed','failed','awaiting_payment'].includes(op.state))await processBillingOperation(op.id,deps.adapter);
 return billingTransaction(p,async c=>operationView((await c.query('SELECT * FROM app.billing_operation WHERE id=$1',[op.id])).rows[0]));
}
export async function processBillingOperation(id?:string,adapter:StripeAdapter=createStripeAdapter()):Promise<boolean>{
 const o=(await billingPool().query('SELECT app.billing_claim_operation($1) AS operation',[id??null])).rows[0].operation;if(!o)return false;
 const update=async(action:string,data:unknown)=>{const r=(await billingPool().query('SELECT app.billing_update_operation($1,$2,$3,$4,$5) AS saved',[o.workspace_id,o.id,o.lease_token,action,data])).rows[0].saved;if(!r)throw Error('Billing lease lost.');};
 try{
  if(Date.now()-Date.parse(o.created_at)>23*3600000){await update('uncertain',{code:'MANUAL_RECONCILIATION'});return true;}
  if(o.kind==='checkout'&&!('cycle' in getSku(o.sku))&&o.stage!=='financial_requested'&&!creditEligible(o.account))throw new StripeFailure(false);
  let customer=o.account.customer_id;
  if(!customer){
   if(Date.now()-Date.parse(o.account.customer_started_at)>23*3600000){await update('uncertain',{code:'MANUAL_RECONCILIATION'});return true;}
   const contact=o.account.customer_request??o.account.contact;
   const value=await adapter.createCustomer(o.workspace_id,'workspace:'+o.workspace_id,{email:contact.email??null,phone:contact.phone??null});
   customer=value.id;await update('customer',{id:customer});
  }
  if(o.kind==='checkout'){
   const couponId=o.proof?.couponId;
   // A coupon changed since the review would charge another total, which grants nothing: stop before the session exists.
   if(couponId&&o.stage!=='financial_requested'&&couponAmount((getSku(o.sku) as {amount:number}).amount,await adapter.readCoupon(couponId))!==o.proof.amount)throw new StripeFailure(false);
   await update('financial_request',{});
   // From the operation's own clock: a retry must repeat the same body. An abandoned session gives the use back within the hour.
   const session=await adapter.createCheckout({customer,sku:o.sku,workspaceId:o.workspace_id,operationId:o.id,coupon:couponId,...(couponId?{expiresAt:Math.floor(Date.parse(o.created_at)/1000)+3600}:{})});
   await update('awaiting_payment',{id:session.id,result:{url:session.url}});
  }else if(o.kind==='cancel'){
   await adapter.cancelSubscription(o.account.subscription_id,o.id);await update('completed',{id:o.account.subscription_id});
  }else if(o.kind==='resume'){
   const sub=await adapter.readSubscription(o.account.subscription_id);
   if(sub.customer!==customer||sub.status!=='active')throw new StripeFailure(false);
   if(sub.cancel_at_period_end)await adapter.resumeSubscription(sub.id,o.id);
   await update('completed',{id:sub.id});
  }else if(o.kind==='payment-method'){
   const result=await adapter.paymentPortal(customer,o.id);await update('completed',{id:result.id,result:{url:stripeUrl(result.url,'portal')}});
  }else if(o.kind==='contact'){
   await adapter.updateCustomer(customer,o.proof.contact,o.id);await update('completed',{id:customer});
  }else if(o.kind==='upgrade'||o.kind==='downgrade'){
   const sub=await adapter.readSubscription(o.account.subscription_id),items=parseSubscriptionItems(sub.items?.data),item=items?.item;
   if(sub.customer!==customer||sub.status!=='active'||!items||!item)throw new StripeFailure(false);
   if(o.kind==='upgrade'){
    let changed=sub;
    // An acknowledged remote change is recovered by reading it, never by charging a second time.
    if(item.price?.id!==o.proof.priceId){
     if(item.price?.unit_amount!==getSku(planSku(o.account.plan,o.account.billing_interval)).amount)throw new StripeFailure(false);
     if(o.stage!=='financial_requested'){if(!samePeriod(item,o.account))throw new StripeFailure(false);const preview=await adapter.previewChange(sub.id,item.id,o.proof.priceId,o.proof.prorationDate,':'+o.id);if(preview.currency!=='brl'||preview.amount_due!==o.proof.amount)throw new StripeFailure(false);}
     await update('financial_request',{});
     changed=await adapter.upgrade(sub.id,item.id,o.proof.priceId,o.proof.prorationDate,o.id);
    }
    const invoiceId=typeof changed.latest_invoice==='string'?changed.latest_invoice:changed.latest_invoice?.id;
    if(!invoiceId)throw new StripeFailure(true);
    await update('awaiting_payment',{id:sub.id,result:{invoiceId}});
   }else {
    if(item.price?.unit_amount!==getSku(planSku(o.account.plan,o.account.billing_interval)).amount)throw new StripeFailure(false);
    const cycle=(getSku(o.sku) as PlanOffer).cycle,extras=[];for(const u of CAPACITY_UNITS)if(items.capacity[u])extras.push({price:await adapter.ensurePrice(capacityOffer(u,cycle).code),quantity:items.capacity[u].quantity as number});
    const schedule=await adapter.downgrade(sub,o.proof.priceId,o.id,cycle,extras);await update('completed',{id:schedule.id});
   }
  }else if(o.kind==='capacity'){
   const sub=await adapter.readSubscription(o.account.subscription_id),items=parseSubscriptionItems(sub.items?.data),offer=capacityFromCode(o.sku);
   if(sub.customer!==customer||sub.status!=='active'||!items||!offer)throw new StripeFailure(false);
   const current=items.capacity[offer.unit],have=current?.quantity??0,{quantity:target,fromQuantity:from}=o.proof;
   if(target<from){
    if(have===from&&current){if(!samePeriod(items.item,o.account))throw new StripeFailure(false);await adapter.reduceCapacity(sub.id,current.id,target,o.id);}else if(have!==target)throw new StripeFailure(false);
    await update('completed',{id:sub.id});
   }else{
    let changed=sub;
    // As with the plan upgrade: an acknowledged change is read back, never charged twice.
    // Without our own request on record, that quantity was not approved here.
    if(have===target&&o.stage!=='financial_requested')throw new StripeFailure(false);
    if(have!==target){
     if(have!==from)throw new StripeFailure(false);
     if(o.stage!=='financial_requested'){if(!samePeriod(items.item,o.account))throw new StripeFailure(false);const preview=await adapter.previewCapacity(sub.id,current?.id??null,o.proof.priceId,target,o.proof.prorationDate,':'+o.id);if(preview.currency!=='brl'||preview.amount_due!==o.proof.amount)throw new StripeFailure(false);}
     await update('financial_request',{});
     changed=await adapter.addCapacity(sub.id,current?.id??null,o.proof.priceId,target,o.proof.prorationDate,o.id);
    }
    const invoiceId=typeof changed.latest_invoice==='string'?changed.latest_invoice:changed.latest_invoice?.id;
    if(!invoiceId)throw new StripeFailure(true);
    await update('awaiting_payment',{id:sub.id,result:{invoiceId}});
   }
  }else throw new StripeFailure(false);
 }catch(error){
  const refused=error instanceof StripeFailure&&!error.uncertain||error instanceof Error&&error.message==='BILLING_CREDITS_REQUIRES_PLAN';
  try{await update(refused?'failed':'uncertain',{code:refused?'PROVIDER_REJECTED':'RECONCILIATION_REQUIRED'});}catch{}
 }
 return true;
}
