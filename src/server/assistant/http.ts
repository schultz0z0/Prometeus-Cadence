import'server-only';
import{requirePrincipal}from'../auth/principal.ts';
import{AppError,checkOrigin,errorResponse}from'../errors.ts';
import{answerAssistant,readAssistant}from'./service.ts';
import{searchWorkspace}from'../search/service.ts';
import{prepareAssistantAction,confirmAssistantAction,cancelAssistantAction,readAssistantDraft}from'./commands.ts';
import{readOnboarding,markOnboarding}from'./onboarding.ts';
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store'}});
// A reply computed for one workspace is refused when the client already switched to another.
async function principal(request:Request){const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');return p;}
async function body(request:Request){checkOrigin(request);const text=await request.text();if(new TextEncoder().encode(text).byteLength>16384)throw new AppError(422,'Requisição muito grande.');if(!text)return{};try{return JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}}
export async function assistantRequest(request:Request){
 try{
  const p=await principal(request);
  if(request.method==='GET')return json(await readAssistant(p));
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  return json(await answerAssistant(p,await body(request),{signal:request.signal}));
 }catch(e){return errorResponse(e);}
}
export async function searchRequest(request:Request){
 try{
  const p=await principal(request),u=new URL(request.url),kinds=u.searchParams.get('kinds');
  return json(await searchWorkspace(p,{q:u.searchParams.get('q')??'',...(kinds?{kinds:kinds.split(',')}:{}),...(u.searchParams.get('cursor')?{cursor:u.searchParams.get('cursor')}:{})}));
 }catch(e){return errorResponse(e);}
}
export async function assistantItemRequest(request:Request,id:string,action:string){
 try{
  const p=await principal(request);
  if(request.method==='GET'&&action==='draft')return json(await readAssistantDraft(p,id));
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  const input=await body(request);
  if(action==='prepare')return json(await prepareAssistantAction(p,id));
  if(action==='confirm')return json(await confirmAssistantAction(p,id,input));
  if(action==='cancel')return json(await cancelAssistantAction(p,id));
  throw new AppError(404,'Operação não encontrada.');
 }catch(e){return errorResponse(e);}
}
export async function onboardingRequest(request:Request){
 try{
  const p=await principal(request);
  if(request.method==='GET')return json(await readOnboarding(p));
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  return json(await markOnboarding(p,await body(request)));
 }catch(e){return errorResponse(e);}
}
