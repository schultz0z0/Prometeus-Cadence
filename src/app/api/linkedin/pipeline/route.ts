import {linkedinPipelineRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinPipelineRequest(request);
