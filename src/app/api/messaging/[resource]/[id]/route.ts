import {messagingRequestHandler} from '../../../../../server/messaging/http.ts';
export const runtime='nodejs';
export async function GET(request:Request,context:{params:Promise<{resource:string;id:string}>}){return messagingRequestHandler(request,await context.params);}
