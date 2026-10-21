import {channelRequestHandler} from '../../../server/channels/http.ts';
export const runtime='nodejs';
export const GET=(request:Request)=>channelRequestHandler(request,{});
export const POST=(request:Request)=>channelRequestHandler(request,{});
