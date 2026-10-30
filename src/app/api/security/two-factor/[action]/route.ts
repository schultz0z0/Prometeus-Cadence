import {twoFactorRequest} from '@/server/auth/two-factor-http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{action:string}>}){return twoFactorRequest(request,(await params).action);}
