import'server-only';
import{requirePrincipal}from'../auth/principal.ts';
import{AppError,checkOrigin,errorResponse}from'../errors.ts';
import{scanDuplicates,prepareMerge,confirmMerge,listMerges,undoMerge}from'./merge.ts';
import{readPrivacy,savePrivacy}from'./service.ts';
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store'}});
async function principal(request:Request){const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');return p;}
async function body(request:Request){checkOrigin(request);const text=await request.text();if(new TextEncoder().encode(text).byteLength>65536)throw new AppError(422,'Requisição muito grande.');try{return JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}}
export async function dataLifecycleRequest(request:Request){
 try{
  const p=await principal(request);
  if(request.method==='GET'){const view=new URL(request.url).searchParams.get('view');if(view==='merges')return json({merges:await listMerges(p)});if(view==='privacy')return json(await readPrivacy(p));throw new AppError(404,'Consulta não encontrada.');}
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  const input=await body(request),action=input?.action,payload=input?.input;
  if(action==='scan')return json(await scanDuplicates(p));
  if(action==='prepare-merge')return json(await prepareMerge(p,payload));
  if(action==='confirm-merge')return json(await confirmMerge(p,payload));
  if(action==='retention')return json(await savePrivacy(p,payload));
  throw new AppError(422,'Operação desconhecida.');
 }catch(e){return errorResponse(e);}
}
export async function dataLifecycleItemRequest(request:Request,id:string,action:string){
 try{
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  if(action!=='undo')throw new AppError(404,'Operação não encontrada.');
  const p=await principal(request);return json(await undoMerge(p,id,await body(request)));
 }catch(e){return errorResponse(e);}
}
