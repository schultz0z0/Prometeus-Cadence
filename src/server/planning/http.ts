import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {errorResponse,AppError} from '../errors.ts';
import {preparePlanning,confirmPlanning,getPlanning} from './service.ts';
import {preparePlanningSelection,confirmPlanningSelection} from './confirmation.ts';
export async function planningRequest(request:Request,action:'prepare'|'confirm'|'get'|'prepare-selection'|'confirm-selection',id?:string){
 try{
  const p=await authorizeProspectingRequest(request);
  if(id&&(!id.length||id.length>120))throw new AppError(422,'Análise inválida.');
  const result=action==='prepare'?await preparePlanning(p,await readProspectingBody(request)):action==='confirm'?await confirmPlanning(p,await readProspectingBody(request)):action==='prepare-selection'?await preparePlanningSelection(p,id!,await readProspectingBody(request)):action==='confirm-selection'?await confirmPlanningSelection(p,id!,await readProspectingBody(request)):await getPlanning(p,id!);
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
