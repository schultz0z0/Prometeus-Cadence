import {contextRequest} from '@/server/context/http';
export const runtime='nodejs';
export const GET=(request:Request)=>contextRequest(request,'get');
