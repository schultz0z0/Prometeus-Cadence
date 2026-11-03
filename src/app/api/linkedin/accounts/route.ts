import {linkedinAccountsRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinAccountsRequest(request);
export const POST=(request:Request)=>linkedinAccountsRequest(request);
