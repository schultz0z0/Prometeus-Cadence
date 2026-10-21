import {authorizeProspectingRequest,readProspectingBody} from '../prospecting/http.ts';
import {errorResponse,AppError} from '../errors.ts';
import {listAutomationRuntime,listAutomationOccurrences} from './repository.ts';
import {prepareAutomationAction,confirmAutomationAction,pauseAutomation} from './authorization.ts';
export async function automationRequest(request:Request,id?:string,action='list'){
 try{
  if(!['list','prepare','confirm','pause','occurrences'].includes(action))throw new AppError(404,'Ação não encontrada.');
  if(request.method!==(['list','occurrences'].includes(action)?'GET':'POST'))throw new AppError(405,'Método inválido.');
  const p=await authorizeProspectingRequest(request);
  if(action!=='list'&&(!id||id.length>120))throw new AppError(422,'Automação inválida.');
  const result=action==='list'?await listAutomationRuntime(p):action==='occurrences'?await listAutomationOccurrences(p,id!,new URL(request.url).searchParams.get('cursor')??undefined):action==='prepare'?await prepareAutomationAction(p,id!,await readProspectingBody(request)):action==='confirm'?await confirmAutomationAction(p,id!,await readProspectingBody(request)):await pauseAutomation(p,id!,await readProspectingBody(request));
  return Response.json(result,{headers:{'cache-control':'no-store'}});
 }catch(error){return errorResponse(error);}
}
