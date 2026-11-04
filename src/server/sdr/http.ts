import 'server-only';
import {requirePrincipal} from '../auth/principal.ts';
import {AppError,checkOrigin,errorResponse} from '../errors.ts';
import {confirmSdrActivation,pauseSdrAgent,prepareSdrActivation,readSdr,saveSdrAgent,saveSdrKnowledge,setSdrKnowledgeState,simulateSdr} from './configuration.ts';
// 07B.1: /api/sdr/{agents,knowledge} and /api/sdr/agents/:id/{prepare-activate,confirm-activate,pause,simulate}, /api/sdr/knowledge/:id/state.
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store'}});
async function principal(request:Request){const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');return p;}
async function body(request:Request){checkOrigin(request);const text=await request.text();if(new TextEncoder().encode(text).byteLength>131072)throw new AppError(422,'Requisição muito grande.');if(!text)return{};try{return JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}}
export async function sdrRequest(request:Request,resource:string){
 try{
  const p=await principal(request);
  if(request.method==='GET'&&resource==='agents')return json(await readSdr(p));
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  if(resource==='agents')return json(await saveSdrAgent(p,await body(request)));
  if(resource==='knowledge')return json(await saveSdrKnowledge(p,await body(request)));
  throw new AppError(404,'Recurso não encontrado.');
 }catch(e){return errorResponse(e);}
}
export async function sdrItemRequest(request:Request,resource:string,id:string,action:string){
 try{
  const p=await principal(request);
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  const input={...await body(request)};
  if(resource==='agents'){
   if(action==='prepare-activate')return json(await prepareSdrActivation(p,{...input,agentId:id}));
   if(action==='confirm-activate')return json(await confirmSdrActivation(p,{...input,agentId:id}));
   if(action==='pause')return json(await pauseSdrAgent(p,{...input,agentId:id}));
   if(action==='simulate')return json(await simulateSdr(p,{...input,agentId:id},{signal:request.signal}));
  }
  if(resource==='knowledge'&&action==='state')return json(await setSdrKnowledgeState(p,{...input,id}));
  throw new AppError(404,'Operação não encontrada.');
 }catch(e){return errorResponse(e);}
}
