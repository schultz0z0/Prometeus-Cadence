import {knowledgeRequest} from '@/server/knowledge/http';
export const runtime='nodejs';
export const GET=(request:Request)=>knowledgeRequest(request);
export const POST=(request:Request)=>knowledgeRequest(request);
