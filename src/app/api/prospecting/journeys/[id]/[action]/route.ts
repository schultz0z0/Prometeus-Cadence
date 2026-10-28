import {journeyRequest} from '@/server/research/journey-http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string;action:string}>}){const p=await context.params;return journeyRequest(request,p.id,p.action);}
