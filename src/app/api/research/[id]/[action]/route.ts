import {researchRequest} from '@/server/research/http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string;action:string}>}){const p=await params;return researchRequest(request,p.id,p.action);}
