import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {AppError,errorResponse} from '../errors.ts';
import {attestLinkedinAdapter,readLinkedinCapabilities,revokeLinkedinAdapter} from './capabilities.ts';
export async function linkedinCapabilitiesRequest(request:Request){
 try{const p=await authorizeProspectingRequest(request);let result:unknown;
  if(request.method==='GET')result=await readLinkedinCapabilities(p);
  else{const body=await readProspectingBody(request) as {action?:unknown;input?:unknown};
   if(body?.action==='attest')result=await attestLinkedinAdapter(p,body.input);
   else if(body?.action==='revoke')result=await revokeLinkedinAdapter(p,body.input);
   else throw new AppError(422,'Ação inválida.');}
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
