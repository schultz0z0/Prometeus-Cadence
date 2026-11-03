import {linkedinNotifyRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const POST=(request:Request)=>linkedinNotifyRequest(request);
