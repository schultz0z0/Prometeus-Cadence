import {linkedinConversationActionRequest} from '@/server/linkedin/http';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string;action:string}>}){const {id,action}=await context.params;return linkedinConversationActionRequest(request,id,action);}
