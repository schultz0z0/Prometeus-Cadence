import {identityAction,identitySnapshot} from './service.ts';
import {AppError,checkOrigin,errorResponse} from '../errors.ts';
import {z} from 'zod';
export async function identityRequest(request:Request){
 try{
  if(request.method==='GET')return Response.json(await identitySnapshot(request.headers),{headers:{'cache-control':'no-store'}});
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  checkOrigin(request);const text=await request.text();if(text.length>8192)throw new AppError(422,'Requisição muito grande.');
  let input;try{input=JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}
  if(['rename','invite','remove','role'].includes(input?.type)&&!request.headers.get('x-cadence-workspace'))throw new AppError(422,'Informe o workspace exibido antes de administrar.');
  if(['invite','remove','role'].includes(input?.type)&&!z.uuid().safeParse(input.requestId).success)throw new AppError(422,'Identifique a operação antes de administrar.');
  if(['remove','role'].includes(input?.type)&&!z.number().int().min(1).safeParse(input.expectedRevision).success)throw new AppError(422,'Atualize os membros antes de administrar.');
  return Response.json(await identityAction(request.headers,input),{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
