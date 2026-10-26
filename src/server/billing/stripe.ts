import {BILLING_VERSION,getSku} from '../../domain/billing.ts';
import {billingConfig} from './config.ts';
export class StripeFailure extends Error {uncertain:boolean;constructor(uncertain:boolean){super(uncertain?'Resultado Stripe incerto. Aguarde a conciliação antes de repetir.':'Stripe não autorizou esta operação.');this.uncertain=uncertain;}}
export function stripeId(value:unknown,prefix:string):string {if(typeof value!=='string'||!new RegExp('^'+prefix+'_[A-Za-z0-9_]+$').test(value)||value.length>200)throw Error('Identificador Stripe inválido.');return value;}
export function stripeUrl(value:unknown,kind:'checkout'|'invoice'|'portal'){
 if(typeof value!=='string')throw Error('URL Stripe inválida.');const u=new URL(value),hosts=kind==='checkout'?['checkout.stripe.com']:kind==='invoice'?['invoice.stripe.com','pay.stripe.com']:['billing.stripe.com'];
 if(u.protocol!=='https:'||!hosts.includes(u.hostname)||u.username||u.password)throw Error('URL Stripe inválida.');return u.toString();
}
export function createStripeAdapter(fetcher:typeof fetch=fetch,config=billingConfig()){
 async function request(method:'GET'|'POST',endpoint:string,params:Record<string,string>={},key?:string):Promise<any>{
  if(!config.key)throw Error('Stripe de teste ainda não configurado.');
  if(!/^\/[a-z_]+(?:\/[A-Za-z0-9_]+){0,3}$/.test(endpoint))throw Error('Operação Stripe inválida.');
  const form=new URLSearchParams(params),url='https://api.stripe.com/v1'+endpoint+(method==='GET'&&form.size?'?'+form:'');let response:Response;
  try{response=await fetcher(url,{method,headers:{authorization:'Bearer '+config.key,'Stripe-Version':config.apiVersion,...(method==='POST'?{'content-type':'application/x-www-form-urlencoded','Idempotency-Key':key??''}:{})},...(method==='POST'?{body:form.toString()}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new StripeFailure(method==='POST');}
  if(!response.ok)throw new StripeFailure(method==='POST'&&(response.status>=500||response.status===409||response.status===429));
  const reader=response.body?.getReader();if(!reader)throw new StripeFailure(method==='POST');let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw Error();}chunks.push(value);}const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!value||typeof value!=='object'||value.livemode===true)throw Error();return value;}catch{throw new StripeFailure(method==='POST');}
 }
 return {
  request,
  async ensurePrice(code:string){
   const offer=getSku(code);if(!('cycle' in offer))throw Error('Plano inválido.');const lookup='prometeus-'+BILLING_VERSION+'-'+code;
   const existing=await request('GET','/prices',{'lookup_keys[0]':lookup,active:'true',limit:'1'});let price=existing.data?.[0];
   if(!price){const product=await request('POST','/products',{name:'Prometeus Cadence · '+offer.name,'metadata[catalog_version]':BILLING_VERSION},'billing:product:'+lookup);price=await request('POST','/prices',{product:stripeId(product.id,'prod'),lookup_key:lookup,currency:'brl',unit_amount:String(offer.amount),'recurring[interval]':'month'},'billing:price:'+lookup);}
   if(price.unit_amount!==offer.amount||price.currency!=='brl'||price.recurring?.interval!=='month'||(price.recurring.interval_count??1)!==1)throw Error('Preço Stripe divergente do catálogo.');return stripeId(price.id,'price');
  },
  previewChange:(subscription:string,item:string,price:string,date:number)=>request('POST','/invoices/create_preview',{subscription:stripeId(subscription,'sub'),'subscription_details[items][0][id]':stripeId(item,'si'),'subscription_details[items][0][price]':stripeId(price,'price'),'subscription_details[items][0][quantity]':'1','subscription_details[proration_date]':String(date),'subscription_details[proration_behavior]':'always_invoice'},'billing:preview:'+subscription+':'+price+':'+date),
  upgrade:(subscription:string,item:string,price:string,date:number,key:string)=>request('POST','/subscriptions/'+stripeId(subscription,'sub'),{'items[0][id]':stripeId(item,'si'),'items[0][price]':stripeId(price,'price'),'items[0][quantity]':'1',payment_behavior:'pending_if_incomplete',proration_behavior:'always_invoice',proration_date:String(date)},'billing:'+key+':upgrade'),
  async downgrade(s:any,price:string,key:string){
   // Stripe forbids metadata with from_subscription. Repeating this creation
   // key recovers our exact schedule after a lost response, even when s.schedule
   // is already populated; a foreign attached schedule cannot be adopted.
   const item=s.items.data[0],priceId=(v:any)=>typeof v==='string'?v:v?.id,attached=s.schedule?stripeId(priceId(s.schedule),'sub_sched'):null;
   let current=attached?await request('GET','/subscription_schedules/'+attached):null,schedule={id:attached};
   if(current?.metadata?.cadence_operation&&current.metadata.cadence_operation!==key)throw new StripeFailure(false);
   // Already marked schedules can be read directly; unmarked schedules still
   // need the original idempotent creation response to prove ownership.
   if(!current||current.metadata?.cadence_operation!==key){
    schedule=await request('POST','/subscription_schedules',{from_subscription:stripeId(s.id,'sub')},'billing:'+key+':schedule');
    if(attached&&schedule.id!==attached)throw new StripeFailure(false);
    current=await request('GET','/subscription_schedules/'+stripeId(schedule.id,'sub_sched'));
   }
   const phases=current.phases;
   const sameItems=(phase:any,expected:string)=>phase?.items?.length===1&&phase.items[0].quantity===1&&priceId(phase.items[0].price)===expected;
   if((s.schedule&&priceId(s.schedule)!==schedule.id)||(current.metadata?.cadence_operation&&current.metadata.cadence_operation!==key)||priceId(current.subscription)!==s.id||current.status!=='active'||current.end_behavior!=='release'||current.current_phase?.start_date!==item.current_period_start||current.current_phase?.end_date!==item.current_period_end||!Array.isArray(phases)||phases.length<1||phases.length>2||phases[0].start_date!==item.current_period_start||phases[0].end_date!==item.current_period_end||!sameItems(phases[0],item.price.id)||(phases.length===2&&(current.metadata?.cadence_operation!==key||phases[1].start_date!==item.current_period_end||!sameItems(phases[1],price))))throw new StripeFailure(false);
   return request('POST','/subscription_schedules/'+stripeId(schedule.id,'sub_sched'),{'metadata[cadence_operation]':key,end_behavior:'release',proration_behavior:'none','phases[0][start_date]':String(item.current_period_start),'phases[0][end_date]':String(item.current_period_end),'phases[0][items][0][price]':stripeId(item.price.id,'price'),'phases[0][items][0][quantity]':'1','phases[1][items][0][price]':stripeId(price,'price'),'phases[1][items][0][quantity]':'1','phases[1][duration][interval]':'month','phases[1][duration][interval_count]':'1','phases[1][proration_behavior]':'none'},'billing:'+key+':downgrade');
  },
  createCustomer:(workspaceId:string,key:string,contact:{email:string|null;phone:string|null})=>request('POST','/customers',{'metadata[workspace_id]':workspaceId,...(contact.email?{email:contact.email}:{}),...(contact.phone?{phone:contact.phone}:{})},'billing:'+key+':customer'),
  async createCheckout(input:{customer:string;sku:string;workspaceId:string;operationId:string}){
   stripeId(input.customer,'cus');const sku=getSku(input.sku),subscription='cycle' in sku;
   if(!subscription&&!sku.available)throw Error('Este recurso ainda não está disponível para compra.');
   const metadata={'metadata[workspace_id]':input.workspaceId,'metadata[operation_id]':input.operationId,'metadata[catalog_version]':BILLING_VERSION,'metadata[sku]':sku.code};
   const result=await request('POST','/checkout/sessions',{customer:input.customer,mode:subscription?'subscription':'payment','line_items[0][quantity]':'1','line_items[0][price_data][currency]':'brl','line_items[0][price_data][unit_amount]':String(sku.amount),'line_items[0][price_data][product_data][name]':'Prometeus Cadence · '+sku.name,...(subscription?{'line_items[0][price_data][recurring][interval]':'month','subscription_data[metadata][workspace_id]':input.workspaceId,'subscription_data[metadata][catalog_version]':BILLING_VERSION,'subscription_data[metadata][plan]':sku.code}:{'payment_intent_data[metadata][workspace_id]':input.workspaceId,'payment_intent_data[metadata][operation_id]':input.operationId}),...metadata,success_url:config.origin+'/settings/plan?billing=return',cancel_url:config.origin+'/settings/plan?billing=canceled'},'billing:'+input.operationId+':checkout');
   stripeId(result.id,'cs');result.url=stripeUrl(result.url,'checkout');return result;
  },
  readCheckout:(id:string)=>request('GET','/checkout/sessions/'+stripeId(id,'cs'),{'expand[0]':'line_items','expand[1]':'subscription'}),
  readSubscription:(id:string)=>request('GET','/subscriptions/'+stripeId(id,'sub'),{'expand[0]':'latest_invoice','expand[1]':'items.data.price'}),
  readInvoice:(id:string)=>request('GET','/invoices/'+stripeId(id,'in'),{'expand[0]':'payments'}),
  readPayment:(id:string)=>request('GET','/payment_intents/'+stripeId(id,'pi'),{'expand[0]':'latest_charge'}),
  readCharge:(id:string)=>request('GET','/charges/'+stripeId(id,'ch')),
  readDispute:(id:string)=>request('GET','/disputes/'+stripeId(id,'dp')),
  cancelSubscription:(id:string,key:string)=>request('POST','/subscriptions/'+stripeId(id,'sub'),{cancel_at_period_end:'true'},'billing:'+key+':cancel'),
  resumeSubscription:(id:string,key:string)=>request('POST','/subscriptions/'+stripeId(id,'sub'),{cancel_at_period_end:'false'},'billing:'+key+':resume'),
  updateCustomer:(id:string,contact:{email:string|null;phone:string|null},key:string)=>request('POST','/customers/'+stripeId(id,'cus'),{email:contact.email??'',phone:contact.phone??''},'billing:'+key+':contact'),
  async paymentPortal(customer:string,key:string){const result=await request('POST','/billing_portal/sessions',{customer:stripeId(customer,'cus'),return_url:config.origin+'/settings/plan','flow_data[type]':'payment_method_update'},'billing:'+key+':portal');result.url=stripeUrl(result.url,'portal');return result;},
 };
}
export type StripeAdapter=ReturnType<typeof createStripeAdapter>;
