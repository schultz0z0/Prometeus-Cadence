import 'server-only';
import type {Principal} from '../../domain/workspace.ts';
import {parseContactsQuery,type ContactsQuery,type ContactsPage} from '../../domain/contacts-query.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
export async function readContacts(p:Principal,input:ContactsQuery):Promise<ContactsPage>{
 let q:ContactsQuery;try{q=parseContactsQuery(new URLSearchParams(Object.entries(input).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)])));}catch{throw new AppError(422,'Consulta de contatos inválida.');}
 return withWorkspaceTransaction(p,async c=>{
  const values:unknown[]=[p.workspaceId],clauses=['l.workspace_id=$1'],bind=(v:unknown)=>{values.push(v);return '$'+values.length;};
  if(q.search)clauses.push(`strpos(lower(concat_ws(' ',l.payload->>'name',l.payload->>'companyName',l.payload->>'email',l.payload->>'phone',l.payload->>'city',l.payload->>'state',l.payload->>'site')),lower(${bind(q.search)}))>0`);
  if(q.listId)clauses.push('l.list_id='+bind(q.listId));
  for(const [field,value]of [['qualification',q.qualification],['source',q.source]] as const)if(value)clauses.push(`l.payload->>'${field}'=${bind(value)}`);
  if(q.state)clauses.push(`upper(l.payload->>'state')=upper(${bind(q.state)})`);
  if(q.onlyFavorites)clauses.push("l.payload->>'favorite'='true'");
  const email="nullif(btrim(l.payload->>'email'),'') IS NOT NULL",phone="nullif(btrim(l.payload->>'phone'),'') IS NOT NULL";
  if(q.contact)clauses.push(q.contact==='email'?email:q.contact==='phone'?phone:`NOT(${email}) AND NOT(${phone})`);
  if(q.summary)clauses.push((q.summary==='no'?'NOT ':'')+"(nullif(btrim(l.payload->>'summary'),'') IS NOT NULL)");
  if(q.createdFrom)clauses.push(`(l.payload->>'createdAt')::timestamptz>=${bind(q.createdFrom+'T00:00:00Z')}::timestamptz`);
  if(q.createdTo)clauses.push(`(l.payload->>'createdAt')::timestamptz<${bind(q.createdTo+'T00:00:00Z')}::timestamptz+interval '1 day'`);
  const enrolled=`SELECT 1 FROM app.cadence_enrollment e JOIN app.cadence_publication p ON p.workspace_id=e.workspace_id AND p.id=e.publication_id WHERE e.workspace_id=l.workspace_id AND e.lead_id=l.id`;
  if(q.cadenceId)clauses.push(q.cadenceId==='none'?`NOT EXISTS(${enrolled})`:q.cadenceId==='any'?`EXISTS(${enrolled})`:`EXISTS(${enrolled} AND p.cadence_id=${bind(q.cadenceId)})`);
  const linked=`FROM app.channel_conversation cv JOIN app.channel_identity ci ON ci.workspace_id=cv.workspace_id AND ci.id=cv.identity_id WHERE cv.workspace_id=l.workspace_id AND cv.lead_id=l.id`;
  if(q.reply)clauses.push(`${q.reply==='no'?'NOT ':''}EXISTS(SELECT 1 ${linked} AND ci.last_reply_at IS NOT NULL)`);
  if(q.optOut)clauses.push(`${q.optOut==='no'?'NOT ':''}EXISTS(SELECT 1 FROM app.channel_identity ci JOIN app.contact_suppression cs ON cs.workspace_id=ci.workspace_id AND cs.identity_id=ci.id WHERE ci.workspace_id=l.workspace_id AND (
   (ci.scope='email' AND nullif(btrim(l.payload->>'email'),'') IS NOT NULL AND lower(ci.external_id)=lower(btrim(l.payload->>'email')))
   OR (ci.scope<>'email' AND nullif(regexp_replace(l.payload->>'phone','[^0-9]','','g'),'') IS NOT NULL AND regexp_replace(ci.phone,'[^0-9]','','g')=regexp_replace(l.payload->>'phone','[^0-9]','','g'))))`);
  const where=clauses.join(' AND '),order=q.sort==='name'?"lower(l.payload->>'name'),l.id":q.sort==='city'?"lower(coalesce(l.payload->>'city','')),l.id":"(l.payload->>'createdAt')::timestamptz DESC,l.id";
  // Single statement: count and page share one database snapshot, including an empty page.
  const limit=bind(q.pageSize),offset=bind((q.page-1)*q.pageSize);
  const result=(await c.query(`WITH matched AS MATERIALIZED(SELECT l.id,l.payload FROM app.lead l WHERE ${where}),
   page AS(SELECT l.* FROM matched l ORDER BY ${order} LIMIT ${limit} OFFSET ${offset})
   SELECT (SELECT count(*) FROM matched)::integer AS total,(SELECT revision::integer FROM app.workspace_meta WHERE workspace_id=$1) AS revision,
    coalesce((SELECT jsonb_agg(jsonb_build_object('lead',l.payload,'cadence',(SELECT e.state FROM app.cadence_enrollment e JOIN app.cadence_publication p ON p.workspace_id=e.workspace_id AND p.id=e.publication_id WHERE e.workspace_id=$1 AND e.lead_id=l.id ORDER BY p.created_at DESC,p.id DESC LIMIT 1)) ORDER BY ${order}) FROM page l),'[]'::jsonb) AS rows`,values)).rows[0];
  return {items:result.rows.map((r:any)=>r.lead),cadences:Object.fromEntries(result.rows.filter((r:any)=>r.cadence).map((r:any)=>[r.lead.id,r.cadence])),total:result.total,revision:result.revision??0,page:q.page,pageSize:q.pageSize};
 });
}
