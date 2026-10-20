import {requirePrincipal} from '../auth/principal.ts';
import {AppError,checkOrigin,errorResponse} from '../errors.ts';
import {prepareJob,confirmJob,listJobs,getJob,listJobItems,cancelJob,providerCapabilities} from './service.ts';
export type ProspectingAction='capabilities'|'prepare'|'confirm'|'list'|'get'|'items'|'cancel'|'apply'|'reconcile';
async function body(request:Request){
  const text=await request.text();if(Buffer.byteLength(text)>2097152)throw new AppError(422,'Requisição limitada a 2 MB.');
  try{return JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}
}
export async function prospectingRequest(request:Request,action:ProspectingAction,id?:string){
  try{
    checkOrigin(request);const p=await requirePrincipal(request.headers);
    const expected=request.headers.get('x-cadence-workspace');
    if(!expected)throw new AppError(422,'Informe o workspace exibido.');
    if(expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');
    if(id&&(!id.length||id.length>120))throw new AppError(422,'Execução inválida.');
    const url=new URL(request.url),page=Object.fromEntries(url.searchParams);
    let result:unknown;
    switch(action){
      case 'capabilities':result=providerCapabilities(p);break;
      case 'prepare':result=await prepareJob(p,await body(request));break;
      case 'confirm':result=await confirmJob(p,await body(request));break;
      case 'list':result=await listJobs(p,page);break;
      case 'get':result=await getJob(p,id!);break;
      case 'items':result=await listJobItems(p,id!,page);break;
      case 'cancel':result=await cancelJob(p,id!);break;
      case 'apply':case 'reconcile':await getJob(p,id!);throw new AppError(409,'A execução ainda não oferece esta ação.');
    }
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  }catch(e){return errorResponse(e);}
}
