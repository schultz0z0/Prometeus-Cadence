import {dataLifecycleItemRequest} from '@/server/privacy/http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string;action:string}>}){const {id,action}=await params;return dataLifecycleItemRequest(request,id,action);}
