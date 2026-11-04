import {sdrRequest} from '@/server/sdr/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{resource:string}>}){return sdrRequest(request,(await params).resource);}
export async function POST(request:Request,{params}:{params:Promise<{resource:string}>}){return sdrRequest(request,(await params).resource);}
