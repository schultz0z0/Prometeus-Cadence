import {planningRequest} from '@/server/planning/http';
export const runtime='nodejs';
export const GET=async(request:Request,{params}:{params:Promise<{id:string}>})=>planningRequest(request,'get',(await params).id);
