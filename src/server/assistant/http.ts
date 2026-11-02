import'server-only';
import{requirePrincipal}from'../auth/principal.ts';
import{AppError,checkOrigin,errorResponse}from'../errors.ts';
import{answerAssistant,readAssistant}from'./service.ts';
import{searchWorkspace}from'../search/service.ts';
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store'}});
// A reply computed for one workspace is refused when the client already switched to another.
async function principal(request:Request){const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');return p;}
export async function assistantRequest(request:Request){
 try{
  const p=await principal(request);
  if(request.method==='GET')return json(await readAssistant(p));
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  checkOrigin(request);const text=await request.text();if(new TextEncoder().encode(text).byteLength>16384)throw new AppError(422,'Pergunta muito grande.');
  let input:unknown;try{input=JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}
  return json(await answerAssistant(p,input,{signal:request.signal}));
 }catch(e){return errorResponse(e);}
}
export async function searchRequest(request:Request){
 try{
  const p=await principal(request),u=new URL(request.url),kinds=u.searchParams.get('kinds');
  return json(await searchWorkspace(p,{q:u.searchParams.get('q')??'',...(kinds?{kinds:kinds.split(',')}:{}),...(u.searchParams.get('cursor')?{cursor:u.searchParams.get('cursor')}:{})}));
 }catch(e){return errorResponse(e);}
}
