import 'server-only';
import {z} from 'zod';
import {parseBearer,type ApiScope} from '../../domain/api-credentials.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
import {resolveApiPrincipal} from './api-auth.ts';
const headers={'cache-control':'no-store','content-type':'application/json'};
function fail(e:unknown){
 const err=e instanceof AppError?e:new AppError(500,'Erro interno.');
 const extra:Record<string,string>={};
 if(err.status===401)extra['www-authenticate']='Bearer';
 const retry=(e as {retryAfter?:number}).retryAfter;if(retry)extra['retry-after']=String(retry);
 return new Response(JSON.stringify({error:{code:err.code??'ERROR',message:err.status===500?'Erro interno.':err.message}}),{status:err.status,headers:{...headers,...extra}});
}
// Only the Authorization header counts: a browser session cookie never authenticates the public API.
async function principal(request:Request,scope:ApiScope){
 const token=parseBearer(request.headers.get('authorization'));
 if(!token)throw new AppError(401,'Envie Authorization: Bearer com uma chave de API.','API_KEY_INVALID');
 return resolveApiPrincipal(token,scope);
}
const pageSchema=z.strictObject({limit:z.coerce.number().int().min(1).max(100).default(50),cursor:z.string().max(300).optional(),list:z.string().min(1).max(120).optional()});
function query(request:Request){
 if(request.method!=='GET')throw new AppError(405,'Método não permitido.');
 const parsed=pageSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new AppError(422,'Parâmetros inválidos.','API_INVALID');return parsed.data;
}
const decode=(raw:string|undefined)=>{if(!raw)return null;try{const v=JSON.parse(Buffer.from(raw,'base64url').toString());if(Array.isArray(v)&&v.length===2&&v.every(x=>typeof x==='string'))return v as [string,string];}catch{}throw new AppError(422,'Cursor inválido.','API_INVALID');};
const encode=(v:[string,string])=>Buffer.from(JSON.stringify(v)).toString('base64url');
export async function apiLeadsRequest(request:Request){
 try{
  const q=query(request),p=await principal(request,'leads:read'),cursor=decode(q.cursor);
  const rows=await withWorkspaceTransaction(p,async c=>(await c.query(`SELECT id,list_id,payload,payload->>'createdAt' created FROM app.lead WHERE ($1::text IS NULL OR list_id=$1) AND ($2::text IS NULL OR (coalesce(payload->>'createdAt',''),id)>($2,$3)) ORDER BY coalesce(payload->>'createdAt',''),id LIMIT $4`,[q.list??null,cursor?.[0]??null,cursor?.[1]??null,q.limit+1])).rows);
  const page=rows.slice(0,q.limit),last=page.at(-1);
  return new Response(JSON.stringify({data:page.map(r=>({...r.payload,id:r.id,listId:r.list_id})),nextCursor:rows.length>q.limit&&last?encode([last.created??'',last.id]):null}),{headers});
 }catch(e){return fail(e);}
}
export async function apiEventsRequest(request:Request){
 try{
  const q=query(request),p=await principal(request,'events:read'),cursor=decode(q.cursor);
  const rows=await withWorkspaceTransaction(p,async c=>(await c.query(`SELECT id,type,entity_kind,entity_id,occurred_at,occurred_at::text at_text,data FROM app.integration_event WHERE type<>'webhook.test' AND ($1::text IS NULL OR (occurred_at,id)>($1::timestamptz,$2)) ORDER BY occurred_at,id LIMIT $3`,[cursor?.[0]??null,cursor?.[1]??null,q.limit+1])).rows);
  const page=rows.slice(0,q.limit),last=page.at(-1);
  return new Response(JSON.stringify({data:page.map(r=>({id:r.id,idempotencyKey:r.id,type:r.type,version:1,occurredAt:r.occurred_at.toISOString(),entity:{kind:r.entity_kind,id:r.entity_id},data:r.data})),nextCursor:rows.length>q.limit&&last?encode([last.at_text,last.id]):null}),{headers});
 }catch(e){return fail(e);}
}
