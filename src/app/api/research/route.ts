import {researchRequest} from '@/server/research/http';
export const runtime='nodejs';
export const GET=(request:Request)=>researchRequest(request);
export const POST=(request:Request)=>researchRequest(request);
