import {aiRequest} from '@/server/prospecting/ai/http';
export const runtime='nodejs';
export const POST=(request:Request)=>aiRequest(request,'diagnostics');
