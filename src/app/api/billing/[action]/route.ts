import {billingRequest,type BillingAction} from '../../../../server/billing/http.ts';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}){return billingRequest(request,(await params).action as BillingAction);}
