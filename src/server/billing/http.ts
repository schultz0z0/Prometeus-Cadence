import 'server-only';
import {z} from 'zod';
import {requirePrincipal} from '../auth/principal.ts';
import {AppError,checkOrigin,errorResponse} from '../errors.ts';
import {readBoundedBody} from '../channels/providers/http.ts';
import {billingTransaction} from './db.ts';
import {readBilling,startTrial} from './repository.ts';
import {prepareBilling,confirmBilling,processBillingOperation} from './operations.ts';
import {receiveBillingEvent} from './events.ts';
import {billingConfig} from './config.ts';
import {hashValue} from '../prospecting/review.ts';
const contactSchema=z.strictObject({requestId:z.uuid(),expectedRevision:z.number().int().nonnegative(),email:z.email().max(254).nullable(),phone:z.string().regex(/^\+?[0-9 ()-]{7,30}$/).nullable()});
const actions=['read','trial','prepare','confirm','contact','reconcile'] as const;
export type BillingAction=typeof actions[number];
async function bytes(request:Request,max:number){if(Number(request.headers.get('content-length'))>max)throw new AppError(413,'Requisição muito grande.');try{return await readBoundedBody(new Response(request.body),max);}catch{throw new AppError(413,'Requisição muito grande.');}}
export async function billingRequest(request:Request,action:BillingAction){
 try{
  if(!actions.includes(action)||request.method!==(action==='read'?'GET':'POST'))throw new AppError(405,'Método não permitido.');
  checkOrigin(request);const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');
  if(!expected)throw new AppError(422,'Informe o workspace exibido.');if(expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');
  await billingTransaction(p,c=>c.query('SELECT app.billing_request_limit($1)',[action==='read'?'read':action==='reconcile'?'reconcile':'mutate']));
  let body:any;
  if(action!=='read'){try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(request,65536)));}catch(e){if(e instanceof AppError)throw e;throw new AppError(422,'Requisição JSON inválida.');}}
  let result:unknown;
  if(action==='read')result=await readBilling(p);
  else if(action==='trial'){const b=z.strictObject({requestId:z.uuid()}).safeParse(body);if(!b.success)throw new AppError(422,'Pedido de teste inválido.');result=await startTrial(p,b.data.requestId);}
  else if(action==='prepare')result=await prepareBilling(p,body);
  else if(action==='confirm')result=await confirmBilling(p,body);
  else if(action==='reconcile'){if(!z.strictObject({}).safeParse(body).success)throw new AppError(422,'Pedido inválido.');await billingTransaction(p,c=>c.query('SELECT app.billing_request_reconcile()'));result=await readBilling(p);}
  else if(action==='contact'){
   const b=contactSchema.safeParse(body);if(!b.success)throw new AppError(422,'Contato de cobrança inválido.');
   const o=await billingTransaction(p,async c=>(await c.query('SELECT app.billing_save_contact($1,$2,$3,$4) AS id',[b.data.requestId,b.data.expectedRevision,hashValue(b.data),{email:b.data.email,phone:b.data.phone}])).rows[0].id);
   if(billingConfig().configured)await processBillingOperation(o);result=await readBilling(p);
  }
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
export async function billingWebhook(request:Request){
 try{
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  const raw=await bytes(request,524288);let id:string;try{id=await receiveBillingEvent(raw,request.headers.get('stripe-signature'));}catch(e){if(e instanceof Error&&/Webhook|Assinatura|validation|invalid/i.test(e.message))throw new AppError(400,'Webhook Stripe inválido.');throw e;}
  return Response.json({received:true,id},{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
