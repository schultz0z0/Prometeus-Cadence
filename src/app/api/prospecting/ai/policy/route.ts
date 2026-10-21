import {aiRequest} from '@/server/prospecting/ai/http';
export const runtime='nodejs';
export const GET=(request:Request)=>aiRequest(request,'policy');
export const POST=(request:Request)=>aiRequest(request,'policy');
