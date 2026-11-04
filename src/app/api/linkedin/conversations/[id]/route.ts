import {linkedinConversationRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return linkedinConversationRequest(request,(await context.params).id);}
