import {prospectingRequest} from '@/server/prospecting/http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return prospectingRequest(request,'reconcile',(await context.params).id);}
