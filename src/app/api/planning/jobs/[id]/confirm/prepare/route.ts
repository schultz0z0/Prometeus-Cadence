import {planningRequest} from '@/server/planning/http';
export const runtime='nodejs';
export const POST=async(request:Request,{params}:{params:Promise<{id:string}>})=>planningRequest(request,'prepare-selection',(await params).id);
