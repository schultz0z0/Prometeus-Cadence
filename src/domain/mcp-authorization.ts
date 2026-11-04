import {createHash} from 'node:crypto';
// 07C.3a: scopes, redirect rules, PKCE and protocol versions of the product's MCP endpoint.
export const MCP_READ_SCOPES=['contacts.read','jobs.read','metrics.read'] as const;
// 07C.3b: writes go through reviewed proposals; confirming from the client is a separate, opt-in scope.
export const MCP_SCOPES=[...MCP_READ_SCOPES,'messages.read','actions.prepare','actions.confirm'] as const;
export type McpScope=(typeof MCP_SCOPES)[number];
export const MCP_SCOPE_LABELS:Record<McpScope,string>={
 'contacts.read':'Ler seus contatos e listas',
 'jobs.read':'Ver o andamento das execuções',
 'metrics.read':'Ler as métricas de envio e resposta',
 'messages.read':'Ler as conversas recentes, incluindo o texto que os contatos escreveram',
 'actions.prepare':'Preparar cadências, qualificações, públicos com automações pausadas e rascunhos de resposta para você revisar',
 'actions.confirm':'Confirmar as ações que ele preparou sem você abrir o Prometeus Cadence (pode gastar créditos)',
};
/** Unchecked on the consent screen until the person ticks it. */
export const MCP_OPT_IN:readonly McpScope[]=['actions.confirm'];
export const MCP_VERSIONS=['2025-11-25','2025-06-18','2025-03-26'] as const;
export const MCP_LATEST=MCP_VERSIONS[0];
export type McpRequest={jsonrpc:'2.0';id?:string|number;method:string;params?:Record<string,unknown>};
export type McpResult={content:{type:'text';text:string}[];isError?:boolean};
export type McpToolCall={name:string;arguments:Record<string,unknown>};
export function mcpScopeAllowed(i:{required:string;granted:string[];membershipActive:boolean}):boolean{return i.membershipActive&&i.granted.includes(i.required);}
/** Known scopes only, in a fixed order; nothing requested means every scope (the person still picks on the consent screen). */
export function normalizeMcpScopes(raw:string|null|undefined):McpScope[]{
 if(raw==null||!raw.trim())return [...MCP_SCOPES];
 const asked=new Set(raw.split(/\s+/));return MCP_SCOPES.filter(s=>asked.has(s));
}
/** What the person ticked, within what the client asked; confirming is useless without preparing, so it is dropped alone. */
export function chooseMcpScopes(requested:readonly string[],chosen:readonly string[]|undefined):McpScope[]{
 // Without an explicit choice, the opt-in scopes stay out (old consent screens, non-UI callers).
 const picked=MCP_SCOPES.filter(s=>requested.includes(s)&&(chosen===undefined?!MCP_OPT_IN.includes(s):chosen.includes(s)));
 return picked.includes('actions.prepare')?picked:picked.filter(s=>s!=='actions.confirm');
}
/** Repeating a confirmation with the same reviewed token is the same request (RFC 4122 v4 shape). */
export function mcpConfirmRequestId(proposalId:string,token:string):string{
 const h=createHash('sha256').update(proposalId+':'+token).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${((parseInt(h[16],16)&3)|8).toString(16)}${h.slice(17,20)}-${h.slice(20,32)}`;
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
