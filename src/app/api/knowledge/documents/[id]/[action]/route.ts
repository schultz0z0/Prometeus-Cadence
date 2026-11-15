import {knowledgeItemRequest} from '@/server/knowledge/http';
export const runtime='nodejs';
type Ctx={params:Promise<{id:string;action:string}>};
export async function GET(request:Request,{params}:Ctx){const p=await params;return knowledgeItemRequest(request,p.id,p.action);}
export async function POST(request:Request,{params}:Ctx){const p=await params;return knowledgeItemRequest(request,p.id,p.action);}
