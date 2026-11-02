import {assistantItemRequest} from '@/server/assistant/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string;action:string}>}){const {id,action}=await params;return assistantItemRequest(request,id,action);}
export async function POST(request:Request,{params}:{params:Promise<{id:string;action:string}>}){const {id,action}=await params;return assistantItemRequest(request,id,action);}
