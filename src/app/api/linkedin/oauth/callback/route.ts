import {linkedinCallbackRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinCallbackRequest(request);
