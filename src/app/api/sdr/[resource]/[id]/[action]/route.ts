import {sdrItemRequest} from '@/server/sdr/http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{resource:string;id:string;action:string}>}){const {resource,id,action}=await params;return sdrItemRequest(request,resource,id,action);}
