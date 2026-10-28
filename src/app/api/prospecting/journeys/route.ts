import {journeyRequest} from '@/server/research/journey-http';
export const runtime='nodejs';
export async function GET(request:Request){return journeyRequest(request);}
export async function POST(request:Request){return journeyRequest(request);}
