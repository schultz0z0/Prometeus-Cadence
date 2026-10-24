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
  readInvoice:(id:string)=>request('GET','/invoices/'+stripeId(id,'in'),{'expand[0]':'lines.data'}),
  cancelSubscription:(id:string,key:string)=>request('POST','/subscriptions/'+stripeId(id,'sub'),{cancel_at_period_end:'true'},'billing:'+key+':cancel'),
  updateCustomer:(id:string,contact:{email:string|null;phone:string|null},key:string)=>request('POST','/customers/'+stripeId(id,'cus'),{email:contact.email??'',phone:contact.phone??''},'billing:'+key+':contact'),
  async paymentPortal(customer:string,key:string){const result=await request('POST','/billing_portal/sessions',{customer:stripeId(customer,'cus'),return_url:config.origin+'/settings/plan','flow_data[type]':'payment_method_update'},'billing:'+key+':portal');result.url=stripeUrl(result.url,'portal');return result;},
 };
}
export type StripeAdapter=ReturnType<typeof createStripeAdapter>;
