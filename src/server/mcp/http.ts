import 'server-only';
import {MCP_SCOPES,MCP_VERSIONS,type McpRequest} from '../../domain/mcp-authorization.ts';
import {requirePrincipal} from '../auth/principal.ts';
import {AppError,checkOrigin} from '../errors.ts';
import {decideMcpAuthorization,exchangeMcpToken,listMcpConnections,mcpBase,mcpResource,McpAuthFailure,OAuthError,readMcpAuthorizationRequest,
 registerMcpClient,resolveMcpToken,revokeMcpConnection,revokeMcpToken,startMcpAuthorization} from './authorization.ts';
import {handleMcp,McpScopeError,rpcError} from './service.ts';
// 07C.3a: HTTP of the MCP endpoint (Streamable HTTP, JSON responses), its OAuth endpoints and the settings connections.
const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type, mcp-protocol-version, mcp-session-id','access-control-expose-headers':'www-authenticate'};
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'cache-control':'no-store',...cors,...headers}});
const metadataUrl=()=>mcpBase()+'/.well-known/oauth-protected-resource/api/mcp';
const challenge=(extra='')=>`Bearer resource_metadata="${metadataUrl()}"${extra}`;
// Bearer tokens make cross-site requests harmless, but a browser Origin must still be ours, a known client or the loopback.
const ORIGINS=['https://claude.ai','https://chatgpt.com'];
function originAllowed(o:string|null){if(!o)return true;if(o===mcpBase()||ORIGINS.includes(o))return true;try{const u=new URL(o);return ['localhost','127.0.0.1'].includes(u.hostname);}catch{return false;}}
const appError=(e:unknown)=>e instanceof AppError?json({error:e.message,message:e.message,code:e.code},e.status):json({error:'Não foi possível concluir agora.',message:'Não foi possível concluir agora.'},500);

export async function mcpRequest(request:Request){
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-methods':'POST, GET, DELETE, OPTIONS'}});
 if(!originAllowed(request.headers.get('origin')))return json({error:'Origem não permitida.'},403);
 const auth=request.headers.get('authorization')??'',token=/^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(auth)?.[1];
 if(!token)return json({error:'invalid_token'},401,{'www-authenticate':challenge()});
 let ctx;
 try{const r=await resolveMcpToken(token);ctx={principal:r.principal,scopes:r.scopes,grantId:r.grantId};}
 catch(e){if(!(e instanceof McpAuthFailure))return json(rpcError(null,-32603,'Erro interno.'),500);return e.status===429?json({error:'rate_limited'},429,{'retry-after':String(e.retryAfter??60)}):json({error:e.status===401?'invalid_token':'Você não tem mais acesso a este workspace.'},e.status,e.status===401?{'www-authenticate':challenge(', error="invalid_token"')}:{});}
 if(request.method!=='POST')return json({error:'Este endpoint não oferece fluxo SSE.'},405,{allow:'POST'});
 const version=request.headers.get('mcp-protocol-version');
 if(version&&!(MCP_VERSIONS as readonly string[]).includes(version))return json(rpcError(null,-32600,'Versão do protocolo não suportada.'),400);
 let m:unknown;try{m=await request.json();}catch{return json(rpcError(null,-32700,'JSON inválido.'),400);}
 if(Array.isArray(m)||!m||typeof m!=='object'||(m as McpRequest).jsonrpc!=='2.0')return json(rpcError(null,-32600,'Envie uma única mensagem JSON-RPC 2.0.'),400);
 if(typeof (m as McpRequest).method!=='string')return new Response(null,{status:202,headers:cors});// a response from the client
 try{const reply=await handleMcp(ctx,m as McpRequest);return reply?json(reply):new Response(null,{status:202,headers:cors});}
 catch(e){
  if(e instanceof McpScopeError)return json(rpcError((m as McpRequest).id??null,-32001,'Esta conexão não tem a permissão '+e.scope+'.'),403,{'www-authenticate':challenge(`, error="insufficient_scope", scope="${e.scope}"`)});
  if(e instanceof AppError&&(e.status===401||e.status===403))return json(rpcError((m as McpRequest).id??null,-32001,e.message),403);
  return json(rpcError((m as McpRequest).id??null,-32603,'Erro interno.'),500);
 }
}
export async function mcpMetadataRequest(_request:Request,kind:'resource'|'server'){
 const base=mcpBase();
 if(kind==='resource')return json({resource:mcpResource(),authorization_servers:[base],scopes_supported:[...MCP_SCOPES],bearer_methods_supported:['header'],resource_name:'Prometeus Cadence'});
 return json({issuer:base,authorization_endpoint:base+'/api/mcp/oauth/authorize',token_endpoint:base+'/api/mcp/oauth/token',registration_endpoint:base+'/api/mcp/oauth/register',
  revocation_endpoint:base+'/api/mcp/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
  token_endpoint_auth_methods_supported:['none'],revocation_endpoint_auth_methods_supported:['none'],scopes_supported:[...MCP_SCOPES],authorization_response_iss_parameter_supported:true});
}
const oauthFailure=(e:unknown)=>e instanceof OAuthError?json({error:e.error,...(e.description?{error_description:e.description}:{})},e.status):json({error:'server_error'},500);
export async function mcpOauthRequest(request:Request,action:string){
 try{
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'access-control-allow-methods':'GET, POST, OPTIONS'}});
  if(action==='authorize'&&request.method==='GET'){
   try{const r=await startMcpAuthorization(new URL(request.url).searchParams);return new Response(null,{status:302,headers:{location:r.location,'cache-control':'no-store'}});}
   catch(e){if(e instanceof OAuthError)return new Response('Pedido de autorização inválido: '+e.error+'. Volte ao aplicativo e conecte de novo.',{status:400,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});throw e;}
  }
  if(request.method!=='POST')return json({error:'invalid_request'},405);
  if(action==='register')return json(await registerMcpClient(await request.json().catch(()=>null),request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||null),201);
  const f=new URLSearchParams(await request.text());
  if(action==='token')return json(await exchangeMcpToken(f));
  if(action==='revoke')return json(await revokeMcpToken(f));
  return json({error:'invalid_request'},404);
 }catch(e){return oauthFailure(e);}
}
/** The consent screen's API: the app session, its Origin and its workspace. */
export async function mcpConsentRequest(request:Request){
 try{
  checkOrigin(request);const p=await requirePrincipal(request.headers);
  if(request.method==='GET')return json(await readMcpAuthorizationRequest(p,new URL(request.url).searchParams.get('request')??''));
  return json(await decideMcpAuthorization(p,await request.json().catch(()=>null)));
 }catch(e){return appError(e);}
}
async function sessionPrincipal(request:Request){
 checkOrigin(request);const p=await requirePrincipal(request.headers),expected=request.headers.get('x-cadence-workspace');
 if(expected!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');return p;
}
export async function mcpConnectionsRequest(request:Request){try{return json({connections:await listMcpConnections(await sessionPrincipal(request)),url:mcpResource()});}catch(e){return appError(e);}}
export async function mcpConnectionRevokeRequest(request:Request,id:string){try{return json(await revokeMcpConnection(await sessionPrincipal(request),id));}catch(e){return appError(e);}}
