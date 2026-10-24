import {authenticateWebhook,verifyMetaChallenge} from './webhook-auth.ts';
import {ingestAuthenticatedBatch} from './events.ts';
import {errorResponse} from '../errors.ts';
export async function webhookRequest(request:Request,publicId:string,kind:'meta'|'twilio-messages'|'twilio-status'):Promise<Response>{
 if(kind!=='meta')return new Response(null,{status:410,headers:{'cache-control':'no-store'}});
 try{
  if(request.method==='GET'&&kind==='meta')return new Response(await verifyMetaChallenge(request,publicId),{headers:{'cache-control':'no-store','content-type':'text/plain'}});
  if(request.method!=='POST')return new Response(null,{status:405});
  await ingestAuthenticatedBatch(await authenticateWebhook(request,publicId,kind));
  return new Response(null,{status:200,headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
