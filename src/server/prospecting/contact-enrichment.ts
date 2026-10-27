import 'server-only';
import type {PoolClient} from 'pg';import type {Principal} from '../../domain/workspace.ts';import type {Decisor,ContactEnrichment} from '../../domain/enrichment.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';import {AppError} from '../errors.ts';
// SQL fragments use only internal aliases, never user-supplied identifiers. A
// user-editable custom field is not evidence that the current contact was found.
const samePerson=`NOT EXISTS(SELECT 1 FROM unnest(ARRAY['name','companyName','email','phone']) k WHERE COALESCE(d.payload->k,'null'::jsonb) IS DISTINCT FROM COALESCE(l.payload->k,'null'::jsonb))`;
const sameCompany=`NOT EXISTS(SELECT 1 FROM unnest(ARRAY['name','companyName','cnpj','site','email','phone','city','state']) k WHERE COALESCE(j.checkpoint->'bases'->l.id->k,'null'::jsonb) IS DISTINCT FROM COALESCE(l.payload->k,'null'::jsonb))`;
export const enrichedContactSql=`(EXISTS(SELECT 1 FROM app.enrichment_delivery d WHERE d.workspace_id=l.workspace_id AND d.lead_id=l.id AND ${samePerson}) OR EXISTS(SELECT 1 FROM app.enrichment_resolution r JOIN app.prospecting_job j ON j.workspace_id=r.workspace_id AND j.id=r.job_id WHERE r.workspace_id=l.workspace_id AND r.lead_id=l.id AND jsonb_array_length(r.people)>0 AND ${sameCompany}))`;
export async function contactEnrichment(c:PoolClient,leadId:string):Promise<ContactEnrichment|null>{
 const delivered=(await c.query(`SELECT r.*,d.payload FROM app.lead l JOIN app.enrichment_delivery d ON d.workspace_id=l.workspace_id AND d.lead_id=l.id JOIN app.enrichment_resolution r ON r.workspace_id=d.workspace_id AND r.id=d.cache_id WHERE l.id=$1 AND ${samePerson} ORDER BY r.resolved_at DESC LIMIT 1`,[leadId])).rows[0];
 if(delivered)return{people:delivered.people.filter((p:Decisor)=>p.name===delivered.payload.name&&(p.email??null)===(delivered.payload.email??null)&&(p.phone??null)===(delivered.payload.phone??null)),jobId:delivered.job_id,resolvedAt:new Date(delivered.resolved_at).toISOString(),delivered:true};
 const row=(await c.query(`SELECT r.* FROM app.lead l JOIN app.enrichment_resolution r ON r.workspace_id=l.workspace_id AND r.lead_id=l.id JOIN app.prospecting_job j ON j.workspace_id=r.workspace_id AND j.id=r.job_id WHERE l.id=$1 AND jsonb_array_length(r.people)>0 AND ${sameCompany} ORDER BY r.resolved_at DESC LIMIT 1`,[leadId])).rows[0];
 return row?{people:row.people,jobId:row.job_id,resolvedAt:new Date(row.resolved_at).toISOString(),delivered:false}:null;
}
export async function readContactEnrichment(p:Principal,leadId:string){return withWorkspaceTransaction(p,async c=>{if(!(await c.query('SELECT 1 FROM app.lead WHERE id=$1',[leadId])).rowCount)throw new AppError(404,'Contato não encontrado.');return contactEnrichment(c,leadId);});}
