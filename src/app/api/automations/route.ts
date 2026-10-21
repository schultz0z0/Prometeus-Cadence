import {automationRequest} from '@/server/automations/http';
export const runtime='nodejs';
export const GET=(request:Request)=>automationRequest(request);
