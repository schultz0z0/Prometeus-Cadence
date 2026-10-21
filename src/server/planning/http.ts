import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {errorResponse,AppError} from '../errors.ts';
import {preparePlanning,confirmPlanning,getPlanning} from './service.ts';
export async function planningRequest(request:Request,action:'prepare'|'confirm'|'get',id?:string){
 try{
  const p=await authorizeProspectingRequest(request);
  if(id&&(!id.length||id.length>120))throw new AppError(422,'Análise inválida.');
  const result=action==='prepare'?await preparePlanning(p,await readProspectingBody(request)):action==='confirm'?await confirmPlanning(p,await readProspectingBody(request)):await getPlanning(p,id!);
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
