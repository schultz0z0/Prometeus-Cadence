import {linkedinTemplatesRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinTemplatesRequest(request);
export const POST=(request:Request)=>linkedinTemplatesRequest(request);
