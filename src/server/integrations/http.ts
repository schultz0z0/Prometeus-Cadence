import'server-only';
import{requirePrincipal}from'../auth/principal.ts';
import{AppError,checkOrigin,errorResponse}from'../errors.ts';
import{listWebhooks,listDeliveries,prepareWebhook,confirmWebhook,webhookAction}from'./webhooks.ts';
import{listApiKeys,createApiKey,rotateApiKey,revokeApiKey}from'./api-auth.ts';
import{storeConnectorSecret,connectIntegration,listConnections,disconnectIntegration}from'./connections.ts';
import{startSheetsAuthorization,configureSheets,sheetsAction}from'./sheets.ts';
const json=(value:unknown)=>Response.json(value,{headers:{'cache-control':'no-store'}});
async function principal(request:Request){const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');if(expected&&expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');return p;}
async function body(request:Request){checkOrigin(request);const text=await request.text();if(new TextEncoder().encode(text).byteLength>32768)throw new AppError(422,'Requisição muito grande.');if(!text)return{};try{return JSON.parse(text);}catch{throw new AppError(422,'Requisição inválida.');}}
export async function integrationsRequest(request:Request){
 try{
  const p=await principal(request);
  if(request.method==='GET'&&new URL(request.url).searchParams.get('view')==='connections')return json(await listConnections(p));
  if(request.method==='GET'){const [webhooks,keys]=await Promise.all([listWebhooks(p),listApiKeys(p)]);return json({webhooks,keys});}
  if(request.method!=='POST')throw new AppError(405,'Método não permitido.');
  const b=await body(request);
  if(b?.action==='prepare')return json(await prepareWebhook(p,{id:b.id??null,input:b.input}));
  if(b?.action==='connect')return json(await connectIntegration(p,b.input));
  if(b?.action==='sheets-authorize')return json(await startSheetsAuthorization(p,p.sessionId));
  if(b?.action==='sheets-configure')return json(await configureSheets(p,b.input));
  if(b?.action==='create-key')return json(await createApiKey(p,b.input));
  if(b?.action==='confirm')return json(await confirmWebhook(p,{id:b.id??null,input:b.input,token:b.token,requestId:b.requestId}));
  throw new AppError(422,'Operação desconhecida.');
 }catch(e){return errorResponse(e);}
}
export async function integrationItemRequest(request:Request,id:string,action:string){
 try{
  const p=await principal(request);
  if(request.method==='GET'&&action==='deliveries')return json({deliveries:await listDeliveries(p,id)});
  if(request.method!=='POST')throw new AppError(404,'Operação não encontrada.');
  if(action==='action')return json(await webhookAction(p,id,await body(request)));
  if(action==='key-rotate')return json(await rotateApiKey(p,id,await body(request)));
  if(action==='disconnect')return json(await disconnectIntegration(p,id,await body(request)));
  if(action==='sheets')return json(await sheetsAction(p,id,await body(request)));
  if(action==='key-revoke')return json(await revokeApiKey(p,id,await body(request)));
  throw new AppError(404,'Operação não encontrada.');
 }catch(e){return errorResponse(e);}
}
// The only entry for a pasted key: same-origin POST; the response carries an opaque reference, never the key.
export async function credentialsRequest(request:Request){
 try{const p=await principal(request);if(request.method!=='POST')throw new AppError(405,'Método não permitido.');return json(await storeConnectorSecret(p,await body(request)));}
 catch(e){return errorResponse(e);}
}
