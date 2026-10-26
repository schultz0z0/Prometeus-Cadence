import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {BILLING_VERSION,getSku,getPlan,type BillingReview} from '../../domain/billing.ts';
import {AppError} from '../errors.ts';
import {createReviewToken,verifyReviewToken,hashValue} from '../prospecting/review.ts';
import {billingPool,billingTransaction,billingError} from './db.ts';
import {billingConfig} from './config.ts';
import {createStripeAdapter,StripeFailure,type StripeAdapter,stripeUrl} from './stripe.ts';
import {operationView} from './repository.ts';
const kinds=z.enum(['checkout','cancel','resume','upgrade','downgrade','payment-method']);
const inputSchema=z.strictObject({kind:kinds,sku:z.string().min(1).max(80).optional()});
const reviewSchema=z.strictObject({kind:kinds,sku:z.string().max(80).nullable(),amount:z.number().int().nonnegative(),currency:z.literal('brl'),revision:z.number().int().nonnegative(),token:z.string().min(1).max(8192),expiresAt:z.string().max(40),effects:z.array(z.string().max(500)).max(8),prorationDate:z.number().int().optional(),priceId:z.string().max(200).optional()});
const confirmSchema=z.strictObject({requestId:z.uuid(),review:reviewSchema});
const signing=()=>{const s=process.env.BETTER_AUTH_SECRET;if(!s||s.length<32)throw Error('Revisão de cobrança indisponível.');return s;};
function proof(p:Principal,a:any,r:Omit<BillingReview,'token'|'expiresAt'|'effects'>){return {scope:'billing-review-v1',catalog:BILLING_VERSION,userId:p.userId,workspaceId:p.workspaceId,subscription:a.subscription_id,fromPlan:a.plan,...r};}
async function account(c:import('pg').PoolClient){const row=(await c.query('SELECT *,app.current_role() AS role FROM app.billing_account')).rows[0];if(!row||!['owner','admin'].includes(row.role))throw new AppError(403,'Somente proprietário ou administrador pode gerenciar cobrança.');return row;}
export async function prepareBilling(p:Principal,input:unknown,deps:{adapter?:StripeAdapter}={}):Promise<BillingReview>{
 const parsed=inputSchema.safeParse(input);if(!parsed.success)throw new AppError(422,'Operação de cobrança inválida.');if(!billingConfig().configured)throw new AppError(503,'Stripe de teste ainda não configurado.','BILLING_NOT_CONFIGURED');
 const a=await billingTransaction(p,account),b=parsed.data;
 let amount=0,sku:string|null=b.sku??null;let effects:string[]=[];let change:Partial<BillingReview>={};
 if(b.kind==='checkout'){
  if(!sku)throw new AppError(422,'Escolha um plano ou pacote.');let offer;try{offer=getSku(sku);}catch{throw new AppError(422,'Plano ou pacote inválido.');}
  if('cycle'in offer){if(a.subscription_id&&['active','past_due','attention'].includes(a.state))throw new AppError(409,'Altere a assinatura existente para trocar de plano.');effects=['Assinatura mensal em ambiente de teste.','Acesso somente após pagamento confirmado.'];}
  else {if(!offer.available)throw new AppError(409,'Este recurso ainda não está disponível para compra.');await billingTransaction(p,c=>c.query('SELECT app.billing_require_execution()'));effects=['Compra única, sem renovação automática.','Créditos sem expiração; usados depois da franquia.'];}amount=offer.amount;
 }else{
  if(!a.subscription_id)throw new AppError(409,'É necessário ter uma assinatura para esta ação.');
  if(b.kind==='cancel'){sku=null;effects=['A renovação será cancelada.','O acesso permanece até o fim do período pago; dados e saldo comprado serão preservados.'];}
  else if(b.kind==='resume'){
   if(a.state!=='active'||!a.cancel_at_period_end||Date.parse(a.period_end)<=Date.now())throw new AppError(409,'A assinatura não possui uma renovação cancelada que possa ser retomada.');
   sku=null;effects=['A renovação automática da assinatura atual será retomada.','Nenhuma cobrança imediata ou crédito adicional. A mensalidade volta a ser cobrada na próxima renovação.'];
  }
  else if(b.kind==='payment-method'){sku=null;effects=['Atualize a forma de pagamento no ambiente seguro do Stripe.'];}
  else {
   if(!sku||!['essential','pro'].includes(sku)||sku===a.plan||b.kind!==(sku==='pro'?'upgrade':'downgrade'))throw new AppError(422,'Troca de plano inválida.');
   if(a.state!=='active'||a.cancel_at_period_end||a.change_schedule_id)throw new AppError(409,'Regularize a assinatura antes de alterar o plano.');
   const adapter=deps.adapter??createStripeAdapter(),sub=await adapter.readSubscription(a.subscription_id),item=sub.items?.data?.[0];
   if(sub.customer!==a.customer_id||sub.status!=='active'||sub.pending_update||sub.schedule||sub.items?.data?.length!==1||item?.quantity!==1||item.price?.unit_amount!==getPlan(a.plan).amount)throw new AppError(409,'A assinatura mudou. Atualize o estado antes de trocar.');
   const priceId=await adapter.ensurePrice(sku);change={priceId};
   if(b.kind==='upgrade'){
    const prorationDate=Math.floor(Date.now()/1000),preview=await adapter.previewChange(sub.id,item.id,priceId,prorationDate);
    if(preview.currency!=='brl'||!Number.isSafeInteger(preview.amount_due)||preview.amount_due<=0)throw new AppError(409,'Não foi possível confirmar o valor da alteração.');
    amount=preview.amount_due;change.prorationDate=prorationDate;effects=['Cobrança proporcional de teste, conforme esta prévia.','O plano e a diferença de franquia mudam somente após o pagamento.'];
   }else effects=['O plano atual permanece até a próxima renovação.','O Essential será aplicado na renovação por R$ 397/mês. Dados e saldo comprado permanecem.'];
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
  let customer=o.account.customer_id;
  if(!customer){
   if(Date.now()-Date.parse(o.account.customer_started_at)>23*3600000){await update('uncertain',{code:'MANUAL_RECONCILIATION'});return true;}
   const contact=o.account.customer_request??o.account.contact;
   const value=await adapter.createCustomer(o.workspace_id,'workspace:'+o.workspace_id,{email:contact.email??null,phone:contact.phone??null});
   customer=value.id;await update('customer',{id:customer});
  }
  if(o.kind==='checkout'){
   await update('financial_request',{});
   const session=await adapter.createCheckout({customer,sku:o.sku,workspaceId:o.workspace_id,operationId:o.id});
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
   const sub=await adapter.readSubscription(o.account.subscription_id),item=sub.items?.data?.[0];
   if(sub.customer!==customer||sub.status!=='active'||sub.items?.data?.length!==1||item?.quantity!==1)throw new StripeFailure(false);
   if(o.kind==='upgrade'){
    let changed=sub;
    // An acknowledged remote change is recovered by reading it, never by charging a second time.
    if(item.price?.id!==o.proof.priceId){
     if(item.price?.unit_amount!==getPlan(o.account.plan).amount)throw new StripeFailure(false);
     if(o.stage!=='financial_requested'){const preview=await adapter.previewChange(sub.id,item.id,o.proof.priceId,o.proof.prorationDate);if(preview.currency!=='brl'||preview.amount_due!==o.proof.amount)throw new StripeFailure(false);}
     await update('financial_request',{});
     changed=await adapter.upgrade(sub.id,item.id,o.proof.priceId,o.proof.prorationDate,o.id);
    }
    const invoiceId=typeof changed.latest_invoice==='string'?changed.latest_invoice:changed.latest_invoice?.id;
    if(!invoiceId)throw new StripeFailure(true);
    await update('awaiting_payment',{id:sub.id,result:{invoiceId}});
   }else {const schedule=await adapter.downgrade(sub,o.proof.priceId,o.id);await update('completed',{id:schedule.id});}
  }else throw new StripeFailure(false);
 }catch(error){
  try{await update(error instanceof StripeFailure&&!error.uncertain?'failed':'uncertain',{code:error instanceof StripeFailure&&!error.uncertain?'PROVIDER_REJECTED':'RECONCILIATION_REQUIRED'});}catch{}
 }
 return true;
}
