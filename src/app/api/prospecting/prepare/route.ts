import {prospectingRequest} from '@/server/prospecting/http';
export const runtime='nodejs';
export const POST=(request:Request)=>prospectingRequest(request,'prepare');
