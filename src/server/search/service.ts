import 'server-only';
import {z} from 'zod';
import type {Principal} from '../../domain/workspace.ts';
import type {SearchHit,SearchPage} from '../../domain/assistant-actions.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
const kinds=['lead','list','cadence'] as const;
const querySchema=z.strictObject({q:z.string().trim().min(2).max(100),kinds:z.array(z.enum(kinds)).min(1).max(3).default([...kinds]),cursor:z.string().max(400).optional()});
type Cursor={r:number;l:string;i:string};
const encode=(c:Cursor)=>Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(raw:string|undefined):Cursor|null{
 if(!raw)return null;
 try{const c=JSON.parse(Buffer.from(raw,'base64url').toString());if(Number.isInteger(c.r)&&typeof c.l==='string'&&typeof c.i==='string')return c;}catch{}
 throw new AppError(422,'Cursor de busca inválido.');
}
// Every row comes from RLS-scoped tables of the active workspace; deleted or merged contacts no longer exist to be found.
export async function searchWorkspace(p:Principal,raw:unknown,limit=20):Promise<SearchPage>{
 const parsed=querySchema.safeParse(raw);if(!parsed.success)throw new AppError(422,'Digite ao menos 2 caracteres para buscar.');
 const {q,kinds:wanted}=parsed.data,cursor=decode(parsed.data.cursor);
 const like='%'+q.toLowerCase().replace(/[\\%_]/g,m=>'\\'+m)+'%',digits=q.replace(/\D/g,'');
 return withWorkspaceTransaction(p,async c=>{
  const rows=(await c.query(`WITH hits AS(
   SELECT 0 r,'lead' kind,l.id,coalesce(nullif(l.payload->>'name',''),l.payload->>'companyName','Contato') label,concat_ws(' · ',nullif(l.payload->>'email',''),nullif(l.payload->>'phone',''),li.name) detail
    FROM app.lead l LEFT JOIN app.list li ON li.workspace_id=l.workspace_id AND li.id=l.list_id
    WHERE 'lead'=ANY($1) AND(lower(coalesce(l.payload->>'name','')) LIKE $2 OR lower(coalesce(l.payload->>'companyName','')) LIKE $2 OR lower(coalesce(l.payload->>'email','')) LIKE $2
     OR(length($3)>=4 AND regexp_replace(coalesce(l.payload->>'phone',''),'\\D','','g') LIKE '%'||$3||'%'))
   UNION ALL SELECT 1,'cadence',id,coalesce(payload->>'name','Cadência'),CASE payload->>'status' WHEN 'active' THEN 'Ligada' ELSE 'Rascunho ou pausada' END FROM app.cadence
    WHERE 'cadence'=ANY($1) AND coalesce((payload->>'archived')::boolean,false)=false AND lower(coalesce(payload->>'name','')) LIKE $2
   UNION ALL SELECT 2,'list',id,name,'Lista' FROM app.list WHERE 'list'=ANY($1) AND lower(name) LIKE $2)
  SELECT *,lower(label) k FROM hits WHERE $4::int IS NULL OR(r,lower(label),id)>($4::int,$5::text,$6::text) ORDER BY r,lower(label),id LIMIT $7`,
   [wanted,like,digits,cursor?.r??null,cursor?.l??null,cursor?.i??null,limit+1])).rows;
  const items:SearchHit[]=rows.slice(0,limit).map(r=>({kind:r.kind,id:r.id,label:r.label,detail:r.detail??'',href:r.kind==='lead'?'/leads/'+encodeURIComponent(r.id):r.kind==='cadence'?'/cadences/'+encodeURIComponent(r.id):'/contacts?list='+encodeURIComponent(r.id)}));
  const last=rows[limit-1];
  return{items,nextCursor:rows.length>limit?encode({r:last.r,l:last.k,i:last.id}):null};
 });
}
