import {z} from 'zod';
// Read-only scopes; writes need their own reviewed contract and are not part of the public API yet.
export const apiScopes=['leads:read','events:read'] as const;
export type ApiScope=(typeof apiScopes)[number];
export const apiScopeLabels:Record<ApiScope,string>={'leads:read':'Ler leads','events:read':'Ler eventos'};
export const MAX_API_KEYS=10,API_RATE_PER_MINUTE=120;
export interface ApiKeyView{id:string;name:string;prefix:string;scopes:ApiScope[];createdAt:string;lastUsedAt:string|null;revision:number}
export const apiKeyInputSchema=z.strictObject({name:z.string().trim().min(1).max(60),scopes:z.array(z.enum(apiScopes)).min(1).max(apiScopes.length).refine(v=>new Set(v).size===v.length)});
const tokenPattern=/^pcak_[A-Za-z0-9_-]{43}$/;
export function parseBearer(header:string|null):string|null{
 const m=/^Bearer ([^\s]+)$/i.exec(header??'');return m&&tokenPattern.test(m[1])?m[1]:null;
}
export const tokenPrefix=(token:string)=>token.slice(0,12);
