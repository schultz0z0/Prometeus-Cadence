import {prospectingRequest} from '@/server/prospecting/http';
export const runtime='nodejs';
export const GET=(request:Request)=>prospectingRequest(request,'capabilities');
