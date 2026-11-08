import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {BILLING_VERSION,CAPACITY_UNITS,getPlan,type BillingView,type BillingStatus,type CommercialUnit,type BillingOperation} from '../../domain/billing.ts';
import {billingTransaction} from './db.ts';
import {billingConfig} from './config.ts';
import {AppError} from '../errors.ts';
import {readExtractionDay} from './extraction-day.ts';
import {readQualificationDay} from './qualification-day.ts';
const iso=(v:unknown)=>v?new Date(v as string).toISOString():null;
const capacityWithExtras=(base:NonNullable<BillingView['capacity']>,a:any,active:boolean)=>{const out={...base};if(active&&a.state==='active')for(const u of CAPACITY_UNITS){const paid=a.capacity_extra?.[u]??0;out[u]+=Math.min(paid,a.capacity_scheduled?.[u]??paid);}return out;};
export function operationView(r:Record<string,any>):BillingOperation{return {id:r.id,kind:r.kind,sku:r.sku,state:r.state,createdAt:iso(r.created_at)!,url:r.result?.url??null,error:r.error_code?'A operação aguarda revisão ou conciliação.':null};}
export async function readBilling(p:Principal):Promise<BillingView>{return billingTransaction(p,async c=>{
 const account=(await c.query('SELECT *,app.current_role() AS role FROM app.billing_account')).rows[0];if(!account)throw new AppError(503,'O cadastro comercial está sendo preparado.');
 const canManage=['owner','admin'].includes(account.role),active=['active','trial','pilot'].includes(account.state)&&Date.parse(account.period_end)>Date.now();
 const grants=(await c.query('SELECT * FROM app.billing_grant')).rows;
 const balances=(['extractions','imports','enrichment','sdr'] as CommercialUnit[]).map(unit=>{
  const rows=grants.filter(r=>r.unit===unit),valid=rows.filter(r=>!r.revoked&&(!r.expires_at||+new Date(r.expires_at)>Date.now()));
  return {unit,plan:valid.filter(r=>r.source!=='pack').reduce((n,r)=>n+r.quantity-r.spent-r.held,0),purchased:valid.filter(r=>r.source==='pack').reduce((n,r)=>n+r.quantity-r.spent-r.held,0),reserved:rows.reduce((n,r)=>n+r.held,0),consumed:valid.reduce((n,r)=>n+r.spent,0),nextReset:valid.filter(r=>r.source!=='pack'&&r.expires_at).map(r=>iso(r.expires_at)!).sort()[0]??null};
 });
 const operations=canManage?(await c.query('SELECT * FROM app.billing_operation ORDER BY created_at DESC LIMIT 20')).rows.map(operationView):[];
 const invoices=canManage?(await c.query('SELECT * FROM app.billing_invoice ORDER BY created_at DESC LIMIT 30')).rows.map(r=>({id:r.id,status:r.status,amount:r.amount,currency:r.currency,url:r.url,createdAt:iso(r.created_at)!})):[];
 return {version:BILLING_VERSION,configured:billingConfig().configured,canManage,status:(active?account.state:['trial','pilot','active'].includes(account.state)?'inactive':account.state) as BillingStatus,plan:account.plan,interval:account.billing_interval,nextPlan:account.next_plan,periodEnd:iso(account.period_end),cancelAtPeriodEnd:account.cancel_at_period_end,trialAvailable:!account.trial_started_at&&!account.subscription_id&&account.role==='owner'&&account.state!=='active',revision:Number(account.revision),contact:canManage?{email:account.contact.email??null,phone:account.contact.phone??null}:{email:null,phone:null},balances,dailyExtractions:await readExtractionDay(c),dailyQualifications:await readQualificationDay(c),capacity:account.plan?capacityWithExtras(getPlan(account.plan).capacity,account,active):null,capacityExtras:Object.fromEntries(CAPACITY_UNITS.map(u=>[u,{active:account.capacity_extra?.[u]??0,scheduled:account.capacity_scheduled?.[u]??null}])) as BillingView['capacityExtras'],usage:(await c.query('SELECT app.billing_capacity_usage() AS usage')).rows[0].usage,operations,invoices};
});}
export async function startTrial(p:Principal,requestId:string){
 if(!z.uuid().safeParse(requestId).success)throw new AppError(422,'Identificador de operação inválido.');
 await billingTransaction(p,c=>c.query('SELECT app.billing_start_trial($1)',[requestId]));return readBilling(p);
}
