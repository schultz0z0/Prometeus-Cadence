import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {AppError,errorResponse} from '../errors.ts';
import {requirePrincipal} from '../auth/principal.ts';
import {attestLinkedinAdapter,readLinkedinCapabilities,revokeLinkedinAdapter} from './capabilities.ts';
import {confirmLinkedinConnection,finishLinkedinReturn,prepareLinkedinConnection,readLinkedinAccount,receiveLinkedinNotify,revokeLinkedinAccount,syncLinkedinAccount} from './connections.ts';
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store'}});
export async function linkedinCapabilitiesRequest(request:Request){
 try{const p=await authorizeProspectingRequest(request);let result:unknown;
  if(request.method==='GET')result=await readLinkedinCapabilities(p);
  else{const body=await readProspectingBody(request) as {action?:unknown;input?:unknown};
   if(body?.action==='attest')result=await attestLinkedinAdapter(p,body.input);
   else if(body?.action==='revoke')result=await revokeLinkedinAdapter(p,body.input);
   else throw new AppError(422,'Ação inválida.');}
  return json(result);
 }catch(e){return errorResponse(e);}
}
export async function linkedinAccountsRequest(request:Request){
 try{const p=await authorizeProspectingRequest(request);
  if(request.method==='GET')return json(await readLinkedinAccount(p));
  const body=await readProspectingBody(request) as {action?:unknown;input?:unknown};
  if(body?.action==='prepare-connect')return json(await prepareLinkedinConnection(p));
  if(body?.action==='confirm-connect')return json(await confirmLinkedinConnection(p,p.sessionId,body.input));
  throw new AppError(422,'Ação inválida.');
 }catch(e){return errorResponse(e);}
}
export async function linkedinAccountActionRequest(request:Request,id:string,action:string){
 try{const p=await authorizeProspectingRequest(request);
  if(request.method!=='POST'||!['sync','reconnect','revoke'].includes(action))throw new AppError(404,'Operação não encontrada.');
  const body=await readProspectingBody(request) as Record<string,unknown>;
  if(action==='sync')return json(await syncLinkedinAccount(p,{accountId:id,requestId:body?.requestId}));
  if(action==='reconnect')return json(await confirmLinkedinConnection(p,p.sessionId,{...body,accountId:id}));
  return json(await revokeLinkedinAccount(p,id,body));
 }catch(e){return errorResponse(e);}
}
// Browser return from the hosted login; the account itself only binds through the vendor notify.
export async function linkedinCallbackRequest(request:Request){
 const destination=new URL('/linkedin/dashboard',process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210');
 try{if(request.method!=='GET')throw new AppError(405,'Método não permitido.');const p=await requirePrincipal(request.headers);
  destination.searchParams.set('linkedin',await finishLinkedinReturn(p,p.sessionId,new URL(request.url)));}
 catch{destination.searchParams.set('linkedin','failed');}
 return new Response(null,{status:303,headers:{location:destination.toString(),'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
// Vendor-to-server. No session: the per-attempt token in the URL is the only authority, and it is single-purpose.
export async function linkedinNotifyRequest(request:Request){
 try{
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  if(Number(request.headers.get('content-length'))>8192)throw new AppError(422,'Aviso muito grande.');
  const text=await request.text();if(new TextEncoder().encode(text).byteLength>8192)throw new AppError(422,'Aviso muito grande.');
  let body:unknown;try{body=JSON.parse(text);}catch{throw new AppError(422,'Aviso inválido.');}
  return json(await receiveLinkedinNotify(new URL(request.url).searchParams.get('token')??'',body));
 }catch(e){return errorResponse(e);}
}
