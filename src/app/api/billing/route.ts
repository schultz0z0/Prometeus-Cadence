import {billingRequest} from '../../../server/billing/http.ts';
export const runtime='nodejs';
export const GET=(request:Request)=>billingRequest(request,'read');
