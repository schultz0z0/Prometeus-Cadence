import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import {parseBearer,type ApiScope} from '../../domain/api-credentials.ts';
import type {Principal} from '../../domain/workspace.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {resolveApiCredential} from './api-auth.ts';
const headers={'cache-control':'no-store','content-type':'application/json'};
// Events become visible once older than this lag, so a transaction that commits late (an import) is not skipped by a polling cursor.
const COMMIT_LAG='60 seconds';
function fail(e:unknown){
 const err=e instanceof AppError?e:new AppError(500,'Erro interno.');
 const extra:Record<string,string>={};
 if(err.status===401)extra['www-authenticate']=err.code==='API_KEY_MISSING'?'Bearer':'Bearer error="invalid_token"';
 const retry=(e as {retryAfter?:number}).retryAfter;if(retry)extra['retry-after']=String(retry);
 return new Response(JSON.stringify({error:{code:err.code??'ERROR',message:err.status===500?'Erro interno.':err.message}}),{status:err.status,headers:{...headers,...extra}});
}
// Only the Authorization header counts: a browser session cookie never authenticates the public API.
async function authenticate(request:Request,scope:ApiScope){
 const token=parseBearer(request.headers.get('authorization'));
 if(!token)throw new AppError(401,'Envie Authorization: Bearer com uma chave de API.','API_KEY_MISSING');
 return resolveApiCredential(token,scope);
}
// The key is re-checked inside the read transaction: a revoke or a demotion committed after resolving still stops this request.
async function read<T>(auth:{principal:Principal;credentialId:string},fn:(c:PoolClient)=>Promise<T>){
 return withWorkspaceTransaction(auth.principal,async c=>{
  if(!(await c.query('SELECT 1 FROM app.api_credential WHERE id=$1 AND revoked_at IS NULL',[auth.credentialId])).rowCount)throw new AppError(401,'Chave de API inválida, revogada ou sem dono ativo.','API_KEY_INVALID');
  return fn(c);
 });
}
const base={limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().max(300).optional()};
const leadsQuery=z.strictObject({...base,list:z.string().min(1).max(120).optional()}),eventsQuery=z.strictObject(base);
function params<T>(request:Request,schema:z.ZodType<T>){const parsed=schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new AppError(422,'Parâmetros inválidos.','API_INVALID');return parsed.data;}
const decode=(raw:string|undefined)=>{if(!raw)return null;try{const v=JSON.parse(Buffer.from(raw,'base64url').toString());if(Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='string'))return v as [string,string];}catch{}throw new AppError(422,'Cursor inválido.','API_INVALID');};
const encode=(v:[string,string])=>Buffer.from(JSON.stringify(v)).toString('base64url');
// The last page still returns a cursor, so a poller can store it and resume from there.
const page=<R,>(rows:R[],limit:number,cursor:string|undefined,key:(r:R)=>[string,string])=>{const items=rows.slice(0,limit),last=items.at(-1);return{items,nextCursor:last?encode(key(last)):cursor??null,hasMore:rows.length>limit};};
// Leads are a snapshot list ordered by their creation date, not a change feed: use /events to follow changes.
export async function apiLeadsRequest(request:Request){
 try{
  const auth=await authenticate(request,'leads:read'),q=params(request,leadsQuery),cursor=decode(q.cursor);
  const rows=await read(auth,async c=>(await c.query(`SELECT id,list_id,payload,coalesce(payload->>'createdAt','') created FROM app.lead WHERE ($1::text IS NULL OR list_id=$1) AND ($2::text IS NULL OR (coalesce(payload->>'createdAt',''),id)>($2,$3)) ORDER BY coalesce(payload->>'createdAt',''),id LIMIT $4`,[q.list??null,cursor?.[0]??null,cursor?.[1]??null,q.limit+1])).rows);
  const p=page(rows,q.limit,q.cursor,r=>[r.created,r.id]);
  return new Response(JSON.stringify({data:p.items.map(r=>({...r.payload,id:r.id,listId:r.list_id})),nextCursor:p.nextCursor,hasMore:p.hasMore}),{headers});
 }catch(e){return fail(e);}
}
export async function apiEventsRequest(request:Request){
 try{
  const auth=await authenticate(request,'events:read'),q=params(request,eventsQuery),cursor=decode(q.cursor);
  const rows=await read(auth,async c=>(await c.query(`SELECT id,type,entity_kind,entity_id,list_id,channel,occurred_at,occurred_at::text at_text,data FROM app.integration_event WHERE type<>'webhook.test' AND occurred_at<clock_timestamp()-interval '${COMMIT_LAG}' AND ($1::text IS NULL OR (occurred_at,id)>($1::timestamptz,$2)) ORDER BY occurred_at,id LIMIT $3`,[cursor?.[0]??null,cursor?.[1]??null,q.limit+1])).rows);
  const p=page(rows,q.limit,q.cursor,r=>[r.at_text,r.id]);
  return new Response(JSON.stringify({data:p.items.map(r=>({id:r.id,idempotencyKey:r.id,type:r.type,version:1,occurredAt:r.occurred_at.toISOString(),entity:{kind:r.entity_kind,id:r.entity_id},listId:r.list_id,channel:r.channel,data:r.data})),nextCursor:p.nextCursor,hasMore:p.hasMore}),{headers});
 }catch(e){return fail(e);}
}
