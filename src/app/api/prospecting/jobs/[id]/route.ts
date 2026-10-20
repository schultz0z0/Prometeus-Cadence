import {prospectingRequest} from '@/server/prospecting/http';
export const runtime='nodejs';
export const GET=async(request:Request,{params}:{params:Promise<{id:string}>})=>prospectingRequest(request,'get',(await params).id);
