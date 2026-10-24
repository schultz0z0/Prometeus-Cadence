import {channelRequestHandler} from '../../../../server/channels/http.ts';
export const runtime='nodejs';
export async function POST(request:Request){return channelRequestHandler(request,{id:'openwa'});}
