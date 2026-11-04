import {linkedinSequencesRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinSequencesRequest(request);
export const POST=(request:Request)=>linkedinSequencesRequest(request);
