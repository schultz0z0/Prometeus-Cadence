import {sdrConversationRequest} from '@/server/sdr/http';
export const runtime='nodejs';
export async function GET(request:Request){return sdrConversationRequest(request);}
