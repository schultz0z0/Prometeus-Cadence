export const BILLING_VERSION='2026-10-24-v1';
export const TRIAL_DAYS=7;
export type PlanCode='essential'|'pro';
export type PlanSku=PlanCode|`${PlanCode}-annual`;
export type BillingInterval='month'|'year';
export type CommercialUnit='extractions'|'imports'|'enrichment'|'sdr';
export type BillingStatus='inactive'|'trial'|'pilot'|'active'|'past_due'|'canceled'|'attention';
export interface PlanOffer {
 code:PlanSku;planCode:PlanCode;name:string;amount:number;currency:'brl';cycle:BillingInterval;
 allowances:Record<CommercialUnit,number>;
 capacity:{seats:number;mailboxes:number;whatsapp:number;cadences:number;automations:number;linkedin:number};
}
const plans:Record<PlanCode,PlanOffer>={
 essential:{code:'essential',planCode:'essential',name:'Essential',amount:39700,currency:'brl',cycle:'month',allowances:{extractions:5000,imports:5000,enrichment:50,sdr:0},capacity:{seats:2,mailboxes:3,whatsapp:2,cadences:100,automations:50,linkedin:0}},
 pro:{code:'pro',planCode:'pro',name:'Pro',amount:89700,currency:'brl',cycle:'month',allowances:{extractions:8000,imports:15000,enrichment:50,sdr:300},capacity:{seats:3,mailboxes:5,whatsapp:3,cadences:100,automations:50,linkedin:1}},
};
// 20% off a year of monthly payments; the franchise stays monthly, one window at a time.
const annualAmounts:Record<PlanCode,number>={essential:381120,pro:861120};
const annualOffer=(c:PlanCode):PlanOffer=>({...structuredClone(plans[c]),code:`${c}-annual`,amount:annualAmounts[c],cycle:'year'});
export interface PackOffer {code:string;name:string;unit:CommercialUnit;quantity:number;amount:number;currency:'brl';available:boolean;}
const packs:PackOffer[]=[
 ...[[2000,9700],[5000,21900],[10000,39900]].map(([quantity,amount])=>({code:'extractions-'+quantity,name:quantity.toLocaleString('pt-BR')+' extrações',unit:'extractions' as const,quantity,amount,currency:'brl' as const,available:true})),
 ...[[5000,2700],[10000,4700],[50000,14700]].map(([quantity,amount])=>({code:'imports-'+quantity,name:quantity.toLocaleString('pt-BR')+' importações',unit:'imports' as const,quantity,amount,currency:'brl' as const,available:true})),
 ...[[50,6500],[100,12000],[300,33000]].map(([quantity,amount])=>({code:'enrichment-'+quantity,name:quantity+' créditos de enriquecimento',unit:'enrichment' as const,quantity,amount,currency:'brl' as const,available:false})),
];
export function getPlan(code:string):PlanOffer {if(code!=='essential'&&code!=='pro')throw Error('Plano inválido.');return structuredClone(plans[code]);}
export function getSku(code:PlanSku):PlanOffer;
export function getSku(code:`${CommercialUnit}-${number}`):PackOffer;
export function getSku(code:string):PlanOffer|PackOffer;
export function getSku(code:string):PlanOffer|PackOffer {if(code==='essential'||code==='pro')return getPlan(code);if(code==='essential-annual'||code==='pro-annual')return annualOffer(code.slice(0,-7) as PlanCode);const p=packs.find(p=>p.code===code);if(!p)throw Error('Pacote inválido.');return {...p};}
export function billingCatalog(){return {version:BILLING_VERSION,trialDays:TRIAL_DAYS,plans:Object.values(plans).map(p=>structuredClone(p)),annualPlans:(['essential','pro'] as const).map(annualOffer),packs:packs.map(p=>({...p}))};}
export const couponCode=(value:string)=>{const code=value.trim().toUpperCase();return /^[A-Z0-9_-]{3,40}$/.test(code)?code:null;};
const MIN_CHARGE=50;
/** The total after the provider's coupon, or nothing when it cannot be applied; Stripe charges at least R$ 0,50. */
export function couponAmount(amount:number,c:{valid?:unknown;percent_off?:unknown;amount_off?:unknown;currency?:unknown}):number|null{
 if(c.valid!==true)return null;let net:number;
 if(typeof c.percent_off==='number'&&c.percent_off>0)net=amount-Math.round(amount*c.percent_off/100);
 else if(Number.isSafeInteger(c.amount_off)&&(c.amount_off as number)>0&&c.currency==='brl')net=amount-(c.amount_off as number);
 else return null;
 return net>=MIN_CHARGE?net:null;
}
export type CapacityUnit='mailboxes'|'whatsapp'|'seats';
export const CAPACITY_UNITS:CapacityUnit[]=['mailboxes','whatsapp','seats'];
export const CAPACITY_MAX=50;
export interface CapacityOffer {code:string;unit:CapacityUnit;name:string;amount:number;currency:'brl';interval:BillingInterval;}
const capacityCatalog:Record<CapacityUnit,{name:string;amount:number}>={mailboxes:{name:'Contas de E-mail',amount:1900},whatsapp:{name:'Números de WhatsApp',amount:4900},seats:{name:'Usuários Extras',amount:5900}};
/** One subscription has one interval, so a yearly subscriber pays twelve months of the add-on, without the plan's discount. */
export const capacityOffer=(unit:CapacityUnit,interval:BillingInterval):CapacityOffer=>({code:`capacity-${unit}${interval==='year'?'-annual':''}`,unit,name:capacityCatalog[unit].name,amount:capacityCatalog[unit].amount*(interval==='year'?12:1),currency:'brl',interval});
export function capacityFromCode(code:string):CapacityOffer|null{const m=/^capacity-(mailboxes|whatsapp|seats)(-annual)?$/.exec(code);return m?capacityOffer(m[1] as CapacityUnit,m[2]?'year':'month'):null;}
export function capacityFromPrice(amount:unknown,interval:unknown):CapacityOffer|null{if(interval!=='month'&&interval!=='year')return null;return CAPACITY_UNITS.map(u=>capacityOffer(u,interval)).find(o=>o.amount===amount)??null;}
/** Capacity in use is never removed silently: the person frees it first. */
export const capacityReductionAllowed=(input:{inUse:number;requested:number})=>input.inUse<=input.requested;
export const skuTitle=(sku:string)=>{const c=capacityFromCode(sku);if(c)return c.name+(c.interval==='year'?' anual':'');const o=getSku(sku);return o.name+('cycle'in o&&o.cycle==='year'?' anual':'');};
export const planSku=(plan:PlanCode,interval:BillingInterval):PlanSku=>interval==='year'?`${plan}-annual`:plan;
/** The exact catalog combination of amount and interval, or nothing: a divergent Stripe price grants no rights. */
export function planFromPrice(amount:unknown,interval:unknown):{plan:PlanCode;interval:BillingInterval;sku:PlanSku}|null{
 for(const plan of ['essential','pro'] as const){
  if(interval==='month'&&amount===plans[plan].amount)return {plan,interval,sku:plan};
  if(interval==='year'&&amount===annualAmounts[plan])return {plan,interval,sku:`${plan}-annual`};
 }
 return null;
}
/** One plan item plus at most one item per add-on, in one interval, exactly as in the catalog; anything else grants no rights. */
export function parseSubscriptionItems(items:unknown){
 if(!Array.isArray(items))return null;let found:(NonNullable<ReturnType<typeof planFromPrice>>&{item:any})|null=null,total=0;const capacity:Partial<Record<CapacityUnit,any>>={};
 for(const i of items){
  const p=i?.price;if(p?.currency!=='brl'||(p?.recurring?.interval_count??1)!==1)return null;
  const plan=planFromPrice(p.unit_amount,p.recurring?.interval),add=plan?null:capacityFromPrice(p.unit_amount,p.recurring?.interval);
  if(plan){if(found||i.quantity!==1)return null;found={...plan,item:i};total+=p.unit_amount;}
  else if(add){if(capacity[add.unit]||!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>CAPACITY_MAX)return null;capacity[add.unit]=i;total+=p.unit_amount*i.quantity;}
  else return null;
 }
 if(!found||items.some(i=>i.price.recurring?.interval!==found!.interval))return null;
 return {...found,capacity,total};
}
/** Same cycle: up now, down at renewal. Same plan, other cycle: at renewal, so franchises never overlap. Both at once: not allowed. */
export function planChange(plan:PlanCode,interval:BillingInterval,sku:string):'upgrade'|'downgrade'|null{
 if(!['essential','pro','essential-annual','pro-annual'].includes(sku))return null;
 const target=getSku(sku) as PlanOffer,samePlan=target.planCode===plan,sameCycle=target.cycle===interval;
 if(samePlan&&sameCycle)return null;
 if(sameCycle)return target.planCode==='pro'?'upgrade':'downgrade';
 return samePlan?'downgrade':null;
}
export function trialEnd(start:string):string {const t=Date.parse(start);if(!Number.isFinite(t))throw Error('Relógio inválido.');return new Date(t+TRIAL_DAYS*86400000).toISOString();}
export function monthlyWindow(anchor:string,now:string){
 const a=new Date(anchor),n=new Date(now);if(!Number.isFinite(+a)||!Number.isFinite(+n)||+n<+a)throw Error('Janela inválida.');
 const at=(months:number)=>{const y=a.getUTCFullYear(),m=a.getUTCMonth()+months,last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(a.getUTCDate(),last),a.getUTCHours(),a.getUTCMinutes(),a.getUTCSeconds(),a.getUTCMilliseconds()));};
 let m=(n.getUTCFullYear()-a.getUTCFullYear())*12+n.getUTCMonth()-a.getUTCMonth();if(+at(m)>+n)m--;return {start:at(m).toISOString(),end:at(m+1).toISOString()};
}
export interface BillingBalance {unit:CommercialUnit;plan:number;purchased:number;reserved:number;consumed:number;nextReset:string|null;}
export interface BillingOperation {id:string;kind:string;sku:string|null;state:'prepared'|'processing'|'uncertain'|'awaiting_payment'|'completed'|'failed';createdAt:string;url:string|null;error:string|null;}
export interface BillingView {version:string;configured:boolean;canManage:boolean;status:BillingStatus;plan:PlanCode|null;interval:BillingInterval;nextPlan:PlanSku|null;periodEnd:string|null;cancelAtPeriodEnd:boolean;trialAvailable:boolean;revision:number;contact:{email:string|null;phone:string|null};balances:BillingBalance[];capacity:PlanOffer['capacity']|null;capacityExtras:Record<CapacityUnit,{active:number;scheduled:number|null}>;usage:Record<string,number>;operations:BillingOperation[];invoices:{id:string;status:string;amount:number;currency:string;url:string|null;createdAt:string}[];}
export interface BillingReview {token:string;expiresAt:string;kind:'checkout'|'cancel'|'resume'|'upgrade'|'downgrade'|'payment-method'|'capacity';sku:string|null;amount:number;currency:'brl';effects:string[];revision:number;prorationDate?:number;priceId?:string;quantity?:number;fromQuantity?:number;coupon?:string;couponId?:string;}
