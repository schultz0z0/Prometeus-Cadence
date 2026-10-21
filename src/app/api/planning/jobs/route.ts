import {planningRequest} from '@/server/planning/http';
export const runtime='nodejs';
export const POST=(request:Request)=>planningRequest(request,'confirm');
