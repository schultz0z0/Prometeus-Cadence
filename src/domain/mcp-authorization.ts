import {createHash} from 'node:crypto';
// 07C.3a: scopes, redirect rules, PKCE and protocol versions of the product's MCP endpoint.
export const MCP_READ_SCOPES=['contacts.read','jobs.read','metrics.read'] as const;
export type McpScope=(typeof MCP_READ_SCOPES)[number];
export const MCP_SCOPE_LABELS:Record<McpScope,string>={
 'contacts.read':'Ler seus contatos e listas',
 'jobs.read':'Ver o andamento das execuções',
 'metrics.read':'Ler as métricas de envio e resposta',
};
export const MCP_VERSIONS=['2025-11-25','2025-06-18','2025-03-26'] as const;
export const MCP_LATEST=MCP_VERSIONS[0];
export type McpRequest={jsonrpc:'2.0';id?:string|number;method:string;params?:Record<string,unknown>};
export type McpResult={content:{type:'text';text:string}[];isError?:boolean};
export type McpToolCall={name:string;arguments:Record<string,unknown>};
export function mcpScopeAllowed(i:{required:string;granted:string[];membershipActive:boolean}):boolean{return i.membershipActive&&i.granted.includes(i.required);}
/** Known scopes only, in a fixed order; nothing requested means every read scope. */
export function normalizeMcpScopes(raw:string|null|undefined):McpScope[]{
 if(raw==null||!raw.trim())return [...MCP_READ_SCOPES];
 const asked=new Set(raw.split(/\s+/));return MCP_READ_SCOPES.filter(s=>asked.has(s));
}
/** https anywhere, or http on the loopback (native and local clients); no fragment, no credentials. */
export function validMcpRedirectUri(raw:string):boolean{
 if(typeof raw!=='string'||raw.length>500)return false;
 let u:URL;try{u=new URL(raw);}catch{return false;}
 if(u.hash||u.username||u.password)return false;
 return u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname));
}
export const pkceChallenge=(verifier:string)=>createHash('sha256').update(verifier).digest('base64url');
export function pkceS256Matches(verifier:string,challenge:string):boolean{
 return typeof verifier==='string'&&/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)&&pkceChallenge(verifier)===challenge;
}
export function negotiateMcpVersion(asked:unknown):string{return (MCP_VERSIONS as readonly string[]).includes(String(asked))?String(asked):MCP_LATEST;}
