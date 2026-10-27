import {researchRequest} from '@/server/research/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return researchRequest(request,(await params).id);}
