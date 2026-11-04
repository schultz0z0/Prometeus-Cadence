import 'server-only';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Principal} from '../../domain/workspace.ts';
import {PIPELINE_COLUMNS,pipelineStage,type LinkedinPersonView,type PipelineStage} from '../../domain/linkedin-message-action.ts';
import {withWorkspaceTransaction} from '../db/transaction.ts';
import {AppError} from '../errors.ts';
// 07A.3a: the people of LinkedIn campaigns and their pipeline. LinkedIn ids never leave the server.
const failures:Record<string,[number,string]>={
 LINKEDIN_CAMPAIGN_ACCESS:[403,'Somente proprietário, administrador ou operador acessa as pessoas do LinkedIn.'],
 LINKEDIN_PERSON_NOT_FOUND:[404,'Pessoa não encontrada.'],
 LINKEDIN_STAGE_LOCKED:[409,'Só quem já aceitou o convite muda de etapa à mão.'],
 REVISION_CONFLICT:[409,'Esta pessoa mudou em outra aba. Recarregue antes de continuar.'],
};
export const linkedinSqlError=(table:Record<string,[number,string]>)=>(e:unknown)=>{const k=e instanceof Error?table[e.message]:undefined;return k?new AppError(k[0],k[1],e instanceof Error?e.message:undefined):e;};
const sqlError=linkedinSqlError(failures);
const tx=<T,>(p:Principal,fn:(c:PoolClient)=>Promise<T>)=>withWorkspaceTransaction(p,fn).catch(e=>{throw sqlError(e);});
const stageSql=`CASE WHEN p.state IN('queued','sending') THEN 'queued' WHEN p.state IN('invited','uncertain') THEN 'invited'
 WHEN p.state='accepted' AND (p.replied_at IS NOT NULL OR p.stage_override='replied') THEN 'replied' WHEN p.state='accepted' THEN 'accepted' END`;
const select=`SELECT p.id,p.name,p.headline,p.company,p.location,p.state,p.replied_at,p.invited_at,p.accepted_at,p.stage_override,p.stage_revision,p.opted_out_at,p.updated_at,c.id campaign_id,c.name campaign_name,
 (SELECT t.id FROM app.linkedin_thread t WHERE t.workspace_id=p.workspace_id AND t.person_id=p.id ORDER BY t.last_message_at DESC NULLS LAST LIMIT 1) thread_id,
 (SELECT max(t.last_message_at) FROM app.linkedin_thread t WHERE t.workspace_id=p.workspace_id AND t.person_id=p.id) last_message_at
 FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id`;
function view(r:any):LinkedinPersonView{
 // The latest real fact: invited, accepted, replied or the last message; the row's own update when none happened yet.
 const last=([r.invited_at,r.accepted_at,r.replied_at,r.last_message_at].filter(Boolean).sort((a:Date,b:Date)=>b.getTime()-a.getTime())[0]??r.updated_at) as Date;
 return {id:r.id,name:r.name,headline:r.headline,company:r.company,location:r.location,campaign:{id:r.campaign_id,name:r.campaign_name},
  stage:pipelineStage({state:r.state,repliedAt:r.replied_at?.toISOString()??null,stageOverride:r.stage_override}),state:r.state,stageRevision:Number(r.stage_revision),manualReply:r.stage_override==='replied'&&!r.replied_at,
  threadId:r.thread_id,lastActivityAt:last.toISOString(),optedOut:!!r.opted_out_at};
}
const query=z.object({stage:z.enum(['queued','warming','invited','accepted','replied']).optional(),campaignId:z.uuid().optional(),search:z.string().trim().max(100).optional(),page:z.coerce.number().int().min(1).max(1000).default(1)});
export async function listLinkedinPeople(p:Principal,raw:unknown):Promise<{people:LinkedinPersonView[];total:number;page:number}>{
 const parsed=query.safeParse(raw);if(!parsed.success)throw new AppError(422,'Filtro inválido.');const q=parsed.data;
 return tx(p,async c=>{
  await c.query('SELECT app.linkedin_campaign_actor(false)');
  const where=`WHERE ($1::text IS NULL OR (${stageSql})=$1) AND ($2::text IS NULL OR c.id=$2) AND ($3::text IS NULL OR p.name ILIKE '%'||$3||'%' OR p.company ILIKE '%'||$3||'%')`;
  const args=[q.stage??null,q.campaignId??null,q.search?q.search.replace(/[\\%_]/g,m=>'\\'+m):null];
  const total=Number((await c.query(`SELECT count(*) n FROM app.linkedin_campaign_person p JOIN app.linkedin_campaign c ON c.workspace_id=p.workspace_id AND c.id=p.campaign_id ${where}`,args)).rows[0].n);
  const rows=(await c.query(`${select} ${where} ORDER BY p.updated_at DESC,p.id LIMIT 50 OFFSET $4`,[...args,(q.page-1)*50])).rows;
  return {people:rows.map(view),total,page:q.page};
 });
}
/** The reference's five columns, up to 50 people each. */
export async function linkedinPipeline(p:Principal):Promise<{columns:{id:PipelineStage;label:string;total:number;people:LinkedinPersonView[]}[]}>{
 return tx(p,async c=>{
  await c.query('SELECT app.linkedin_campaign_actor(false)');
  const rows=(await c.query(`SELECT * FROM (SELECT x.*,row_number() OVER(PARTITION BY stage ORDER BY updated_at DESC) rn,count(*) OVER(PARTITION BY stage) total FROM (${select.replace('SELECT p.id',`SELECT ${stageSql} stage,p.id`)}) x) y WHERE stage IS NOT NULL AND rn<=50`)).rows;
  return {columns:PIPELINE_COLUMNS.map(([id,label])=>{const mine=rows.filter(r=>r.stage===id);return {id,label,total:Number(mine[0]?.total??0),people:mine.map(view)};})};
 });
}
const moveInput=z.strictObject({personId:z.uuid(),stage:z.enum(['accepted','replied']),expectedRevision:z.number().int().min(1),requestId:z.uuid()});
export async function moveLinkedinPerson(p:Principal,raw:unknown):Promise<{stage:'accepted'|'replied';revision:number}>{
 const parsed=moveInput.safeParse(raw);if(!parsed.success)throw new AppError(422,'Movimento inválido.');const i=parsed.data;
 return tx(p,async c=>{const r=(await c.query('SELECT app.move_linkedin_person($1,$2,$3,$4) v',[i.personId,i.stage,i.expectedRevision,i.requestId])).rows[0].v;return {stage:r.stage,revision:Number(r.revision)};});
}
export async function optOutLinkedinPerson(p:Principal,personId:string):Promise<{optedOut:true}>{
 if(!z.uuid().safeParse(personId).success)throw new AppError(404,failures.LINKEDIN_PERSON_NOT_FOUND[1],'LINKEDIN_PERSON_NOT_FOUND');
 return tx(p,async c=>{await c.query('SELECT app.opt_out_linkedin_person($1)',[personId]);return {optedOut:true as const};});
}
