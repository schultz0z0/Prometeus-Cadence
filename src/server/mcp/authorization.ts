import 'server-only';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import {MCP_SCOPE_LABELS,normalizeMcpScopes,pkceChallenge,validMcpRedirectUri,type McpScope} from '../../domain/mcp-authorization.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {getPools} from '../db/pool.ts';
import {AppError} from '../errors.ts';
// 07C.3a: the OAuth side of the MCP endpoint (RFC 7591 registration, authorization code with PKCE S256, rotating refresh).
const digest=(t:string)=>createHash('sha256').update(t).digest('hex');
const secret=(prefix:string)=>prefix+randomBytes(32).toString('base64url');
export const mcpBase=()=>new URL(process.env.BETTER_AUTH_URL??'http://127.0.0.1:3210').origin;
export const mcpResource=()=>mcpBase()+'/api/mcp';
/** An OAuth error answered as JSON (RFC 6749 §5.2), never with internals. */
export class OAuthError extends Error{status:number;error:string;description?:string;constructor(status:number,error:string,description?:string){super(error);this.status=status;this.error=error;this.description=description;}}
const failures:Record<string,[number,string]>={
 MCP_ACCESS:[403,'Somente proprietário ou administrador revoga a conexão de outra pessoa.'],
 MCP_REQUEST_NOT_FOUND:[404,'Este pedido de acesso não existe mais. Volte ao Claude ou ao ChatGPT e conecte de novo.'],
 MCP_REQUEST_USED:[409,'Este pedido de acesso já foi respondido. Volte ao Claude ou ao ChatGPT e conecte de novo.'],
 MCP_REQUEST_EXPIRED:[409,'Este pedido de acesso venceu (10 minutos). Volte ao Claude ou ao ChatGPT e conecte de novo.'],
 MCP_CONNECTION_NOT_FOUND:[404,'Conexão não encontrada.'],
};
const sqlError=(e:unknown)=>{const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const tx=<T,>(p:Principal,fn:(c:import('pg').PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{throw sqlError(e);});
const app=()=>getPools().appPool;

const registration=z.object({client_name:z.string().trim().min(1).max(100).optional(),redirect_uris:z.array(z.string()).min(1).max(5),
 token_endpoint_auth_method:z.string().optional(),grant_types:z.array(z.string()).optional(),response_types:z.array(z.string()).optional()});
export async function registerMcpClient(raw:unknown){
 const r=registration.safeParse(raw);if(!r.success)throw new OAuthError(400,'invalid_client_metadata','Informe redirect_uris.');
 if(!r.data.redirect_uris.every(validMcpRedirectUri))throw new OAuthError(400,'invalid_redirect_uri','Use https, ou http só em localhost.');
 if(r.data.token_endpoint_auth_method&&r.data.token_endpoint_auth_method!=='none')throw new OAuthError(400,'invalid_client_metadata','Somente clientes públicos (PKCE).');
 const id='mcp_'+randomUUID(),name=r.data.client_name??'Cliente MCP';
 if(!(await app().query('SELECT app.mcp_register_client($1,$2,$3) ok',[id,name,r.data.redirect_uris])).rows[0].ok)throw new OAuthError(429,'temporarily_unavailable');
 return {client_id:id,client_name:name,redirect_uris:r.data.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_id_issued_at:Math.floor(Date.now()/1000)};
}
/**
 * GET authorize: an unknown client or redirect is shown, never redirected to; other errors go back to the client.
 * A valid request is kept 10 minutes and continues on the consent screen.
 */
export async function startMcpAuthorization(q:URLSearchParams):Promise<{location:string}>{
 const client=q.get('client_id')??'',redirect=q.get('redirect_uri')??'';
 const check=(await app().query('SELECT app.mcp_start_request(NULL,$1,$2,NULL,NULL,NULL,NULL) v',[client,redirect])).rows[0].v as string;
 if(check!=='ok')throw new OAuthError(400,check==='unknown_client'?'invalid_client':'invalid_redirect_uri');
 const back=(error:string)=>{const u=new URL(redirect);u.searchParams.set('error',error);const st=q.get('state');if(st)u.searchParams.set('state',st);return {location:u.toString()};};
 const challenge=q.get('code_challenge')??'';
 if(q.get('response_type')!=='code')return back('unsupported_response_type');
 if(q.get('code_challenge_method')!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(challenge))return back('invalid_request');
 if((q.get('resource')??mcpResource())!==mcpResource())return back('invalid_target');
 const scopes=normalizeMcpScopes(q.get('scope'));if(!scopes.length)return back('invalid_scope');
 const id=randomUUID(),state=q.get('state');if(state&&state.length>500)return back('invalid_request');
 await app().query('SELECT app.mcp_start_request($1,$2,$3,$4,$5,$6,$7)',[id,client,redirect,challenge,scopes,state,mcpResource()]);
 return {location:mcpBase()+'/mcp/authorize?request='+id};
}
export async function readMcpAuthorizationRequest(p:Principal,id:string){
 if(!z.uuid().safeParse(id).success)throw new AppError(404,failures.MCP_REQUEST_NOT_FOUND[1]);
 const r=await tx(p,async c=>(await c.query('SELECT app.mcp_read_request($1) v',[id])).rows[0].v as {client:string;redirectUri:string;scopes:McpScope[];used:boolean;expired:boolean}|null);
 if(!r)throw new AppError(404,failures.MCP_REQUEST_NOT_FOUND[1],'MCP_REQUEST_NOT_FOUND');
 if(r.used)throw new AppError(409,failures.MCP_REQUEST_USED[1],'MCP_REQUEST_USED');
 if(r.expired)throw new AppError(409,failures.MCP_REQUEST_EXPIRED[1],'MCP_REQUEST_EXPIRED');
 const who=(await getPools().authPool.query('SELECT o.name workspace,u.email,u.name FROM organization o,"user" u WHERE o.id=$1 AND u.id=$2',[p.workspaceId,p.userId])).rows[0];
 return {client:{name:r.client},redirectHost:new URL(r.redirectUri).host,scopes:r.scopes.map(s=>({id:s,label:MCP_SCOPE_LABELS[s]})),
  workspace:{id:p.workspaceId,name:who?.workspace??''},user:{name:who?.name??'',email:who?.email??''}};
}
const decision=z.strictObject({requestId:z.uuid(),workspaceId:z.string().min(1).max(200),decision:z.enum(['allow','deny'])});
/** The member's answer, for the workspace of their session only. */
export async function decideMcpAuthorization(p:Principal,raw:unknown):Promise<{redirectTo:string}>{
 const d=decision.safeParse(raw);if(!d.success)throw new AppError(422,'Pedido de acesso inválido.');
 if(d.data.workspaceId!==p.workspaceId)throw new AppError(409,'O workspace mudou. Recarregue antes de continuar.','WORKSPACE_CHANGED');
 const code=secret('pcmc_'),allow=d.data.decision==='allow';
 const r=await tx(p,async c=>(await c.query('SELECT app.mcp_decide($1,$2,$3,$4) v',[d.data.requestId,allow,randomUUID(),digest(code)])).rows[0].v as {redirectUri:string;state:string|null});
 const u=new URL(r.redirectUri);
 if(allow)u.searchParams.set('code',code);else u.searchParams.set('error','access_denied');
 if(r.state)u.searchParams.set('state',r.state);
 u.searchParams.set('iss',mcpBase());
 return {redirectTo:u.toString()};
}
const ACCESS_TTL=900;
const tokenResponse=(access:string,refresh:string,scopes:string[])=>({access_token:access,token_type:'Bearer',expires_in:ACCESS_TTL,refresh_token:refresh,scope:scopes.join(' ')});
export async function exchangeMcpToken(f:URLSearchParams){
 const grant=f.get('grant_type'),client=f.get('client_id')??'',resource=f.get('resource'),access=secret('pcma_'),refresh=secret('pcmr_');
 let r:{error?:string;scopes?:string[]};
 if(grant==='authorization_code'){
  const verifier=f.get('code_verifier')??'';
  if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier))throw new OAuthError(400,'invalid_grant');
  r=(await app().query('SELECT app.mcp_exchange_code($1,$2,$3,$4,$5,$6,$7) v',[digest(f.get('code')??''),client,f.get('redirect_uri')??'',pkceChallenge(verifier),resource,digest(access),digest(refresh)])).rows[0].v;
 }else if(grant==='refresh_token'){
  r=(await app().query('SELECT app.mcp_refresh($1,$2,$3,$4,$5) v',[digest(f.get('refresh_token')??''),client,resource,digest(access),digest(refresh)])).rows[0].v;
 }else throw new OAuthError(400,'unsupported_grant_type');
 if(r.error)throw new OAuthError(400,r.error);
 return tokenResponse(access,refresh,r.scopes!);
}
/** RFC 7009: always 200; a known token revokes its grant. */
export async function revokeMcpToken(f:URLSearchParams){const t=f.get('token');if(t)await app().query('SELECT app.mcp_revoke_token($1)',[digest(t)]);return {};}
export class McpAuthFailure extends Error{status:401|403|429;retryAfter?:number;constructor(status:401|403|429,retryAfter?:number){super('MCP_AUTH');this.status=status;this.retryAfter=retryAfter;}}
/** A bearer token acts as its user while still a member; there is no browser session (like the 07C.1 API keys). */
export async function resolveMcpToken(token:string):Promise<{principal:Principal;scopes:string[];grantId:string}>{
 const r=(await app().query('SELECT * FROM app.mcp_resolve_token($1,$2)',[digest(token),mcpResource()])).rows[0];
 if(!r)throw new McpAuthFailure(401);
 if(!r.role)throw new McpAuthFailure(403);
 if(r.retry_after>0)throw new McpAuthFailure(429,r.retry_after);
 return {principal:{userId:r.user_id,workspaceId:r.workspace_id,role:r.role,sessionId:''},scopes:r.scopes,grantId:r.grant_id};
}
export interface McpConnectionView{id:string;clientName:string;userName:string|null;mine:boolean;scopes:{id:string;label:string}[];createdAt:string;lastUsedAt:string|null}
export async function listMcpConnections(p:Principal):Promise<McpConnectionView[]>{
 return tx(p,async c=>(await c.query('SELECT * FROM app.list_mcp_connections()')).rows.map(r=>({id:r.id,clientName:r.client_name,userName:r.user_name,mine:r.user_id===p.userId,
  scopes:(r.scopes as McpScope[]).map(s=>({id:s,label:MCP_SCOPE_LABELS[s]??s})),createdAt:r.created_at.toISOString(),lastUsedAt:r.last_used_at?.toISOString()??null})));
}
export async function revokeMcpConnection(p:Principal,id:string):Promise<{revoked:true}>{
 if(!z.uuid().safeParse(id).success)throw new AppError(404,failures.MCP_CONNECTION_NOT_FOUND[1]);
 return tx(p,async c=>{await c.query('SELECT app.revoke_mcp_connection($1)',[id]);return {revoked:true as const};});
}
