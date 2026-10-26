import {requirePrincipal} from '../auth/principal.ts';
import {AppError,errorResponse} from '../errors.ts';
import {readOperationEvents} from './repository.ts';
export async function operationEventsRequest(request:Request){
 if(request.method!=='GET')return new Response(null,{status:405,headers:{allow:'GET','cache-control':'no-store'}});
 try{
  const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');
  if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');
  const q=new URL(request.url).searchParams;
  if([...q.keys()].some(k=>!['cursor','limit'].includes(k))||q.getAll('limit').length>1||q.getAll('cursor').length>1)throw new AppError(422,'Consulta de eventos inválida.');
  return Response.json(await readOperationEvents(p,{...(q.has('cursor')?{cursor:q.get('cursor')!}:{}),...(q.has('limit')?{limit:Number(q.get('limit'))}:{})}),{headers:{'cache-control':'no-store'}});
 }catch(e){return errorResponse(e);}
}
