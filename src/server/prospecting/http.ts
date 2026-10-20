import {requirePrincipal} from '../auth/principal.ts';
import {AppError,checkOrigin,errorResponse} from '../errors.ts';
import {prepareJob,confirmJob,listJobs,getJob,listJobItems,cancelJob,providerCapabilities} from './service.ts';
import {applyJobResults} from './application.ts';
import {reconcileJob} from './reconciliation.ts';
export type ProspectingAction='capabilities'|'prepare'|'confirm'|'list'|'get'|'items'|'cancel'|'apply'|'reconcile';
async function body(request:Request){
  if(Number(request.headers.get('content-length'))>2097152)throw new AppError(422,'Requisição limitada a 2 MB.');
  const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let size=0;
  if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2097152){await reader.cancel();throw new AppError(422,'Requisição limitada a 2 MB.');}chunks.push(value);}
  const text=Buffer.concat(chunks).toString('utf8');
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
      case 'apply':result=await applyJobResults(p,id!,await body(request));break;
      case 'reconcile':result=await reconcileJob(p,id!,await body(request));break;
    }
    return Response.json(result,{headers:{'cache-control':'no-store'}});
  }catch(e){return errorResponse(e);}
}
