import {automationRequest} from '@/server/automations/http';
export const runtime='nodejs';
async function handle(request:Request,{params}:{params:Promise<{id:string;action:string}>}){const {id,action}=await params;return automationRequest(request,id,action);}
export const GET=handle;
export const POST=handle;
