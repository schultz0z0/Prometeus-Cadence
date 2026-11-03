import {linkedinCapabilitiesRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinCapabilitiesRequest(request);
export const POST=(request:Request)=>linkedinCapabilitiesRequest(request);
