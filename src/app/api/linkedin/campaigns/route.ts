import {linkedinCampaignsRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export const GET=(request:Request)=>linkedinCampaignsRequest(request);
export const POST=(request:Request)=>linkedinCampaignsRequest(request);
