import {contextRequest} from '@/server/context/http';
export const runtime='nodejs';
export const POST=(request:Request)=>contextRequest(request,'save-product');
