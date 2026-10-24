export const BILLING_VERSION='2026-10-24-v1';
export const TRIAL_DAYS=7;
export type PlanCode='essential'|'pro';
export type CommercialUnit='extractions'|'imports'|'enrichment'|'sdr';
export type BillingStatus='inactive'|'trial'|'pilot'|'active'|'past_due'|'canceled'|'attention';
export interface PlanOffer {
 code:PlanCode;name:string;amount:number;currency:'brl';cycle:'month';
 allowances:Record<CommercialUnit,number>;
 capacity:{seats:number;mailboxes:number;whatsapp:number;cadences:number;automations:number;linkedin:number};
}
const plans:Record<PlanCode,PlanOffer>={
 essential:{code:'essential',name:'Essential',amount:39700,currency:'brl',cycle:'month',allowances:{extractions:5000,imports:5000,enrichment:50,sdr:0},capacity:{seats:2,mailboxes:3,whatsapp:2,cadences:100,automations:50,linkedin:0}},
 pro:{code:'pro',name:'Pro',amount:89700,currency:'brl',cycle:'month',allowances:{extractions:8000,imports:15000,enrichment:50,sdr:300},capacity:{seats:3,mailboxes:5,whatsapp:3,cadences:100,automations:50,linkedin:1}},
};
export interface PackOffer {code:string;name:string;unit:CommercialUnit;quantity:number;amount:number;currency:'brl';available:boolean;}
const packs:PackOffer[]=[
 ...[[2000,9700],[5000,21900],[10000,39900]].map(([quantity,amount])=>({code:'extractions-'+quantity,name:quantity.toLocaleString('pt-BR')+' extrações',unit:'extractions' as const,quantity,amount,currency:'brl' as const,available:true})),
 ...[[5000,2700],[10000,4700],[50000,14700]].map(([quantity,amount])=>({code:'imports-'+quantity,name:quantity.toLocaleString('pt-BR')+' importações',unit:'imports' as const,quantity,amount,currency:'brl' as const,available:true})),
 ...[[50,6500],[100,12000],[300,33000]].map(([quantity,amount])=>({code:'enrichment-'+quantity,name:quantity+' créditos de enriquecimento',unit:'enrichment' as const,quantity,amount,currency:'brl' as const,available:false})),
];
export function getPlan(code:string):PlanOffer {if(code!=='essential'&&code!=='pro')throw Error('Plano inválido.');return structuredClone(plans[code]);}
export function getSku(code:PlanCode):PlanOffer;
export function getSku(code:`${CommercialUnit}-${number}`):PackOffer;
export function getSku(code:string):PlanOffer|PackOffer;
export function getSku(code:string):PlanOffer|PackOffer {if(code==='essential'||code==='pro')return getPlan(code);const p=packs.find(p=>p.code===code);if(!p)throw Error('Pacote inválido.');return {...p};}
export function billingCatalog(){return {version:BILLING_VERSION,trialDays:TRIAL_DAYS,plans:Object.values(plans).map(p=>structuredClone(p)),packs:packs.map(p=>({...p}))};}
export function trialEnd(start:string):string {const t=Date.parse(start);if(!Number.isFinite(t))throw Error('Relógio inválido.');return new Date(t+TRIAL_DAYS*86400000).toISOString();}
export function monthlyWindow(anchor:string,now:string){
 const a=new Date(anchor),n=new Date(now);if(!Number.isFinite(+a)||!Number.isFinite(+n)||+n<+a)throw Error('Janela inválida.');
 const at=(months:number)=>{const y=a.getUTCFullYear(),m=a.getUTCMonth()+months,last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return new Date(Date.UTC(y,m,Math.min(a.getUTCDate(),last),a.getUTCHours(),a.getUTCMinutes(),a.getUTCSeconds(),a.getUTCMilliseconds()));};
 let m=(n.getUTCFullYear()-a.getUTCFullYear())*12+n.getUTCMonth()-a.getUTCMonth();if(+at(m)>+n)m--;return {start:at(m).toISOString(),end:at(m+1).toISOString()};
}
export interface BillingBalance {unit:CommercialUnit;plan:number;purchased:number;reserved:number;consumed:number;nextReset:string|null;}
export interface BillingOperation {id:string;kind:string;sku:string|null;state:'prepared'|'processing'|'uncertain'|'awaiting_payment'|'completed'|'failed';createdAt:string;url:string|null;error:string|null;}
export interface BillingView {version:string;configured:boolean;canManage:boolean;status:BillingStatus;plan:PlanCode|null;nextPlan:PlanCode|null;periodEnd:string|null;cancelAtPeriodEnd:boolean;trialAvailable:boolean;revision:number;contact:{email:string|null;phone:string|null};balances:BillingBalance[];capacity:PlanOffer['capacity']|null;usage:Record<string,number>;operations:BillingOperation[];invoices:{id:string;status:string;amount:number;currency:string;url:string|null;createdAt:string}[];}
export interface BillingReview {token:string;expiresAt:string;kind:'checkout'|'cancel'|'upgrade'|'downgrade'|'payment-method';sku:string|null;amount:number;currency:'brl';effects:string[];revision:number;prorationDate?:number;priceId?:string;}
