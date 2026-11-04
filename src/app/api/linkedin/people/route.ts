import {linkedinPeopleRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinPeopleRequest(request);
