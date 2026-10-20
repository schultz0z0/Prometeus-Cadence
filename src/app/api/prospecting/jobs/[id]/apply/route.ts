import {prospectingRequest} from '@/server/prospecting/http';
export const runtime='nodejs';
export const POST=async(request:Request,{params}:{params:Promise<{id:string}>})=>prospectingRequest(request,'apply',(await params).id);
