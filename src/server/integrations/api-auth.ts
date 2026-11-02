import 'server-only';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {apiKeyInputSchema,MAX_API_KEYS,tokenPrefix,type ApiKeyView,type ApiScope} from '../../domain/api-credentials.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {getPools} from '../db/pool.ts';
import {AppError} from '../errors.ts';
const failures:Record<string,[number,string]>={
 WEBHOOK_ACCESS:[403,'Somente proprietário ou administrador gerencia chaves de API.'],
 API_KEY_NOT_FOUND:[404,'Chave não encontrada.'],
 API_KEY_CONFLICT:[409,'A chave mudou em outra aba. Recarregue antes de continuar.'],
 API_KEY_LIMIT:[409,`O limite é de ${MAX_API_KEYS} chaves ativas por workspace.`],
};
const keyError=(e:unknown)=>{const k=e instanceof Error?failures[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const digest=(token:string)=>createHash('sha256').update(token).digest('hex');
const newToken=()=>'pcak_'+randomBytes(32).toString('base64url');
type Row={id:string;name:string;prefix:string;scopes:ApiScope[];created_at:Date;last_used_at:Date|null;revision:string|number};
const view=(r:Row):ApiKeyView=>({id:r.id,name:r.name,prefix:r.prefix,scopes:r.scopes,createdAt:r.created_at.toISOString(),lastUsedAt:r.last_used_at?.toISOString()??null,revision:Number(r.revision)});
async function admin(c:PoolClient){const role=(await c.query('SELECT app.current_role() AS role')).rows[0].role;if(!['owner','admin'].includes(role))throw new AppError(403,failures.WEBHOOK_ACCESS[1],'WEBHOOK_ACCESS');}
const cols='id,name,prefix,scopes,created_at,last_used_at,revision';
export async function listApiKeys(p:Principal):Promise<ApiKeyView[]>{
 return withWorkspaceTransaction(p,async c=>{await admin(c);return(await c.query(`SELECT ${cols} FROM app.api_credential WHERE revoked_at IS NULL ORDER BY created_at,id`)).rows.map(view);});
}
// The token exists only in this response; the database keeps its SHA-256 digest.
export async function createApiKey(p:Principal,raw:unknown):Promise<{key:ApiKeyView;token:string}>{
 const parsed=apiKeyInputSchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Dê um nome e escolha pelo menos um escopo.');
 const token=newToken();
 try{return await withWorkspaceTransaction(p,async c=>{await admin(c);
  const r=(await c.query(`SELECT ${cols} FROM app.api_key_command('create',$1,0,$2,$3,$4,$5)`,[randomUUID(),parsed.data.name,parsed.data.scopes,digest(token),tokenPrefix(token)])).rows[0];
  return{key:view(r),token};});}catch(e){throw keyError(e);}
}
const actionSchema=z.strictObject({expectedRevision:z.number().int().min(1)});
export async function rotateApiKey(p:Principal,id:string,raw:unknown):Promise<{key:ApiKeyView;token:string}>{
 const parsed=actionSchema.safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 const token=newToken();
 try{return await withWorkspaceTransaction(p,async c=>{await admin(c);
  const r=(await c.query(`SELECT ${cols} FROM app.api_key_command('rotate',$1,$2,NULL,NULL,$3,$4)`,[id,parsed.data.expectedRevision,digest(token),tokenPrefix(token)])).rows[0];
  return{key:view(r),token};});}catch(e){throw keyError(e);}
}
export async function revokeApiKey(p:Principal,id:string,raw:unknown):Promise<{revoked:true}>{
 const parsed=actionSchema.safeParse(raw);if(!parsed.success||!z.uuid().safeParse(id).success)throw new AppError(422,'Operação inválida.');
 try{return await withWorkspaceTransaction(p,async c=>{await admin(c);await c.query(`SELECT id FROM app.api_key_command('revoke',$1,$2,NULL,NULL,NULL,NULL)`,[id,parsed.data.expectedRevision]);return{revoked:true as const};});}
 catch(e){throw keyError(e);}
}
// A bearer key acts as its creator, who must still be an owner or admin; there is no session and no cookie.
export async function resolveApiPrincipal(token:string,scope:ApiScope):Promise<Principal>{return(await resolveApiCredential(token,scope)).principal;}
export async function resolveApiCredential(token:string,scope:ApiScope):Promise<{principal:Principal;credentialId:string}>{
 const r=(await getPools().appPool.query('SELECT * FROM app.resolve_api_key($1,$2)',[digest(token),scope])).rows[0];
 if(!r)throw new AppError(401,'Chave de API inválida, revogada ou sem dono ativo.','API_KEY_INVALID');
 if(r.retry_after>0)throw Object.assign(new AppError(429,'Limite de requisições por minuto atingido.','API_RATE_LIMIT'),{retryAfter:r.retry_after});
 if(!r.allowed)throw new AppError(403,'Esta chave não tem o escopo '+scope+'.','API_SCOPE');
 return{principal:{userId:r.user_id,workspaceId:r.workspace_id,role:r.role,sessionId:''},credentialId:r.credential_id};
}
