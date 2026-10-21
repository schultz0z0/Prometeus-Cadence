import {webhookRequest} from '../../../../../../server/channels/webhooks.ts';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{publicId:string;kind:string}>}){
 const {publicId,kind}=await context.params;if(kind!=='messages'&&kind!=='status')return new Response(null,{status:404});
 return webhookRequest(request,publicId,kind==='messages'?'twilio-messages':'twilio-status');
}
