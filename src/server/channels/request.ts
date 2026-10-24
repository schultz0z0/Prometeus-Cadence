import {requirePrincipal} from '../auth/principal.ts';
import {AppError,checkOrigin,errorResponse} from '../errors.ts';
import {readBoundedBody} from './providers/http.ts';
import type {Principal} from '../../domain/workspace.ts';
import {ChannelProviderError} from './providers/contracts.ts';
import {channelProviderAppError} from './provider-errors.ts';
export async function channelHttp(request:Request,action:(p:Principal,body:unknown)=>Promise<unknown>):Promise<Response>{
 try{
  checkOrigin(request);const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');
  if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');
  let body:unknown=undefined;
  if(request.method!=='GET'){
   if(Number(request.headers.get('content-length'))>2097152)throw new AppError(413,'Requisição limitada a 2 MiB.');
   let bytes:Uint8Array;try{bytes=await readBoundedBody(new Response(request.body),2097152);}catch{throw new AppError(413,'Requisição limitada a 2 MiB.');}
   try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new AppError(422,'Requisição JSON inválida.');}
  }
  const result=await action(p,body);return Response.json(result??{ok:true},{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e instanceof ChannelProviderError?channelProviderAppError(e):e);}
}
