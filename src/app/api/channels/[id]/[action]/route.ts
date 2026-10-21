import {channelRequestHandler} from '../../../../../server/channels/http.ts';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string;action:string}>}){return channelRequestHandler(request,await context.params);}
